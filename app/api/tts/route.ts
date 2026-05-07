import https from "node:https";
import { requireAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 45;

const azureOutputFormat = "audio-24khz-48kbitrate-mono-mp3";
const maxSpeechTextLength = 3_000;

function escapeSsml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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

          resolve({
            body: Buffer.concat(chunks),
            contentType: String(response.headers["content-type"] ?? ""),
            ok: status >= 200 && status < 300,
            status,
          });
        });
      },
    );

    request.setTimeout(30_000, () => {
      request.destroy(new Error("Azure Speech request timed out."));
    });
    request.on("error", reject);
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
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const payload = body as {
    text?: string;
    voice?: string;
    language?: string;
  };

  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const baseUrl = process.env.AZURE_SPEECH_BASE_URL?.trim();
  const voice = String(payload.voice ?? "").trim();
  const language = String(payload.language ?? "zh-CN").trim();
  const text = String(payload.text ?? "").trim();

  if (!key || (!region && !baseUrl)) {
    return Response.json(
      { error: "Azure Speech key and region or base URL are not configured." },
      { status: 500 },
    );
  }

  if (!text) {
    return Response.json({ error: "Missing text." }, { status: 400 });
  }

  if (text.length > maxSpeechTextLength) {
    return Response.json(
      { error: "TTS text is too long. Please split it into smaller chunks." },
      { status: 413 },
    );
  }

  if (!voice) {
    return Response.json({ error: "Missing Azure Speech voice." }, { status: 400 });
  }

  const ssml = `<speak version="1.0" xml:lang="${language}"><voice xml:lang="${language}" name="${voice}">${escapeSsml(text)}</voice></speak>`;

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
            `Azure Speech request failed with ${response.status}.`,
        },
        { status: 502 },
      );
    }

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      return Response.json(
        { error: "Azure Speech returned an empty audio response." },
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
      { error: error instanceof Error ? error.message : "Azure Speech failed." },
      { status: 500 },
    );
  }
}
