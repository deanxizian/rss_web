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
    return `用中文简要总结这篇文章，不要添加原文没有的信息。输出必须是 Markdown。

输出格式：
## 一句话总结
用一句话概括文章。

## 要点
- 最多 5 个要点

原文：
${text}`;
  }

  return `请把下面 Markdown 内容翻译成${targetLanguage}。

要求：
1. 保留原意。
2. 标题、术语、人名、产品名尽量准确。
3. 输出自然流畅。
4. 保留原文 Markdown 结构，包括标题层级、列表、引用、代码块、链接格式和段落分隔。
5. 只翻译可读文本，不要改写 URL、代码块内容或 Markdown 语法。
6. 不要添加原文没有的信息。

Markdown 原文：
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
