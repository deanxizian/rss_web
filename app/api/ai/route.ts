import { requireAuth } from "@/lib/auth";
import { generateText } from "@/lib/openai";
import { truncateText } from "@/lib/rss";

export const runtime = "nodejs";
export const maxDuration = 45;

type Action = "summary" | "translate";

function buildPrompt({
  action,
  text,
  targetLanguage,
}: {
  action: Action;
  text: string;
  targetLanguage: string;
}) {
  if (action === "summary") {
    return `用中文简要总结这篇文章，不要添加原文没有的信息。

输出：
- 一句话总结
- 最多 5 个要点

原文：
${text}`;
  }

  return `请把下面内容翻译成${targetLanguage}。

要求：
1. 保留原意。
2. 标题、术语、人名、产品名尽量准确。
3. 输出自然流畅。
4. 不要添加原文没有的信息。

原文：
${text}`;
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
    action?: string;
    text?: string;
    targetLanguage?: string;
    model?: string;
  };

  const action = payload.action as Action;
  const text = String(payload.text ?? "").trim();
  const targetLanguage = String(payload.targetLanguage ?? "中文").trim() || "中文";
  const model = payload.model?.trim();

  if (!["summary", "translate"].includes(action)) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }

  if (!text) {
    return Response.json({ error: "Missing text." }, { status: 400 });
  }

  if (!model) {
    return Response.json({ error: "Missing AI model." }, { status: 400 });
  }

  try {
    const resultText = await generateText({
      model,
      prompt: buildPrompt({
        action,
        text: truncateText(text, 40_000),
        targetLanguage,
      }),
    });

    return Response.json({ text: resultText });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "OpenAI request failed." },
      { status: 500 },
    );
  }
}
