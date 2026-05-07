import OpenAI from "openai";

const clients = new Map<string, OpenAI>();

export function getOpenAIClient(baseURL: string | undefined, apiKey: string) {
  const normalizedBaseURL = baseURL?.trim() || process.env.OPENAI_BASE_URL?.trim();

  const clientKey = `${normalizedBaseURL || "default"}:${apiKey.slice(0, 8)}`;
  const cached = clients.get(clientKey);

  if (cached) {
    return cached;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: normalizedBaseURL || undefined,
  });

  clients.set(clientKey, client);

  return client;
}

export function getBaseURLForModel(model: string) {
  if (model.startsWith("gemini-")) {
    return process.env.GEMINI_BASE_URL?.trim() || "https://hk.uniapi.io/gemini";
  }

  if (model.startsWith("deepseek-")) {
    return process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
  }

  return process.env.OPENAI_BASE_URL?.trim();
}

function getApiKeyForModel(model: string) {
  if (model.startsWith("gemini-")) {
    return process.env.GEMINI_API_KEY?.trim();
  }

  if (model.startsWith("deepseek-")) {
    return process.env.DEEPSEEK_API_KEY?.trim();
  }

  return process.env.OPENAI_API_KEY?.trim();
}

function getProviderName(model: string) {
  if (model.startsWith("gemini-")) return "GEMINI";
  if (model.startsWith("deepseek-")) return "DEEPSEEK";
  return "OPENAI";
}

export async function generateText({
  model,
  prompt,
}: {
  model: string;
  prompt: string;
}) {
  if (model.startsWith("gemini-")) {
    return generateGeminiText({ model, prompt });
  }

  const apiKey = getApiKeyForModel(model);

  if (!apiKey) {
    throw new Error(`${getProviderName(model)}_API_KEY is not configured.`);
  }

  const openai = getOpenAIClient(getBaseURLForModel(model), apiKey);

  try {
    const response = await openai.responses.create({
      model,
      input: prompt,
    });

    if (response.output_text) {
      return response.output_text;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!/404|not found|unsupported|responses/i.test(message)) {
      throw error;
    }
  }

  const response = await openai.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content;

  if (typeof content !== "string" || !content) {
    throw new Error("Model returned an empty response.");
  }

  return content;
}

async function generateGeminiText({
  model,
  prompt,
}: {
  model: string;
  prompt: string;
}) {
  const apiKey = getApiKeyForModel(model);
  const baseURL = getBaseURLForModel(model)?.replace(/\/$/, "");

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  if (!baseURL) {
    throw new Error("GEMINI_BASE_URL is not configured.");
  }

  const endpointBase = baseURL.endsWith("/v1beta") ? baseURL : `${baseURL}/v1beta`;
  const response = await fetch(
    `${endpointBase}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    },
  );

  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(rawText || `Gemini request failed with ${response.status}.`);
  }

  try {
    const data = JSON.parse(rawText) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: unknown }> };
      }>;
      choices?: Array<{ message?: { content?: unknown } }>;
      output_text?: unknown;
      text?: unknown;
    };
    const geminiContent =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text)
        .filter((part): part is string => typeof part === "string")
        .join("") || undefined;
    const content =
      geminiContent ??
      data.output_text ??
      data.text ??
      data.choices?.[0]?.message?.content;

    if (typeof content === "string" && content.trim()) {
      return content;
    }
  } catch {
    // This Gemini-compatible endpoint can return plain text.
  }

  if (!rawText.trim()) {
    throw new Error("Gemini returned an empty response.");
  }

  return rawText;
}
