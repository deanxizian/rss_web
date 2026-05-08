import https from "node:https";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 45;

const azureOutputFormat = "audio-24khz-48kbitrate-mono-mp3";
const azureSpeechRequestTimeoutMs = 30_000;
const maxSpeechTextLength = 900;

function escapeSsml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeSpeechRate(value: unknown) {
  const rate = Number(value);

  if (!Number.isFinite(rate)) {
    return "+0%";
  }

  const clamped = Math.min(1.5, Math.max(0.7, rate));
  const percent = Math.round((clamped - 1) * 100);

  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

function getSpeechEndpoint(baseUrl: string | undefined, region: string | undefined) {
  if (baseUrl) {
    const normalized = baseUrl.replace(/\/$/, "");
    return normalized.endsWith("/cognitiveservices/v1")
      ? normalized
      : `${normalized}/cognitiveservices/v1`;
  }

  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function getRegionSpeechEndpoint(region: string | undefined) {
  if (!region) {
    return null;
  }

  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

async function requestAzureSpeech({
  endpoint,
  key,
  outputFormat,
  ssml,
}: {
  endpoint: string;
  key: string;
  outputFormat: string;
  ssml: string;
}) {
  const body = Buffer.from(ssml, "utf8");
  const url = new URL(endpoint);

  return new Promise<{
    body: Buffer;
    contentType: string;
    ok: boolean;
    status: number;
  }>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function finish(callback: () => void) {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      callback();
    }

    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/ssml+xml",
          "content-length": String(body.byteLength),
          "ocp-apim-subscription-key": key,
          "x-microsoft-outputformat": outputFormat,
          "user-agent": "Personal RSS AI Reader/1.0",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const status = response.statusCode ?? 0;

          finish(() => {
            resolve({
              body: Buffer.concat(chunks),
              contentType: String(response.headers["content-type"] ?? ""),
              ok: status >= 200 && status < 300,
              status,
            });
          });
        });
        response.on("error", (error) => {
          finish(() => reject(error));
        });
      },
    );

    timeout = setTimeout(() => {
      request.destroy(new Error("Azure Speech 请求超时。"));
    }, azureSpeechRequestTimeoutMs);
    request.setTimeout(azureSpeechRequestTimeoutMs, () => {
      request.destroy(new Error("Azure Speech 请求超时。"));
    });
    request.on("error", (error) => {
      finish(() => reject(error));
    });
    request.write(body);
    request.end();
  });
}

export async function POST(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "请求内容不是有效 JSON。" }, { status: 400 });
  }

  const payload = body as {
    text?: string;
    voice?: string;
    language?: string;
    speechRate?: number;
  };

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const baseUrl = process.env.AZURE_SPEECH_BASE_URL?.trim();
  const voice = String(payload.voice ?? "").trim();
  const language = String(payload.language ?? "zh-CN").trim();
  const text = String(payload.text ?? "").trim();
  const speechRate = normalizeSpeechRate(payload.speechRate);

  if (!key || (!region && !baseUrl)) {
    return Response.json(
      { error: "Azure Speech 密钥和区域或 Base URL 未配置。" },
      { status: 500 },
    );
  }

  if (!text) {
    return Response.json({ error: "缺少可朗读文本。" }, { status: 400 });
  }

  if (text.length > maxSpeechTextLength) {
    return Response.json(
      { error: "朗读文本过长，请拆分后重试。" },
      { status: 413 },
    );
  }

  if (!voice) {
    return Response.json({ error: "缺少 Azure Speech 音色。" }, { status: 400 });
  }

  const ssml = `<speak version="1.0" xml:lang="${language}"><voice xml:lang="${language}" name="${voice}"><prosody rate="${speechRate}">${escapeSsml(text)}</prosody></voice></speak>`;

  const endpoint = getSpeechEndpoint(baseUrl, region);

  try {
    let response = await requestAzureSpeech({
      endpoint,
      key,
      outputFormat: azureOutputFormat,
      ssml,
    });
    const fallbackEndpoint = getRegionSpeechEndpoint(region);
    let audioBuffer = response.ok ? response.body : null;

    if (
      (!response.ok || audioBuffer?.byteLength === 0) &&
      baseUrl &&
      fallbackEndpoint &&
      fallbackEndpoint !== endpoint
    ) {
      response = await requestAzureSpeech({
        endpoint: fallbackEndpoint,
        key,
        outputFormat: azureOutputFormat,
        ssml,
      });
      audioBuffer = response.ok ? response.body : null;
    }

    if (!response.ok) {
      const errorText = response.body.toString("utf8");

      return Response.json(
        {
          error:
            errorText ||
            `Azure Speech 请求失败，状态码 ${response.status}。`,
        },
        { status: 502 },
      );
    }

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return Response.json(
        { error: "Azure Speech 返回了空音频。" },
        { status: 502 },
      );
    }

    const responseBody = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ) as ArrayBuffer;

    return new Response(responseBody, {
      headers: {
        "cache-control": "no-store",
        "content-type":
          response.contentType ||
          (azureOutputFormat.includes("mp3")
            ? "audio/mpeg"
            : "application/octet-stream"),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Azure Speech 请求失败。" },
      { status: 500 },
    );
  }
}
