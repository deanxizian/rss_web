import Parser from "rss-parser";
import { fetchArticleContent, htmlToMarkdown } from "@/lib/article";
import { requireAuth } from "@/lib/auth";
import { stripHtml, validateRssUrl } from "@/lib/rss";

export const runtime = "nodejs";
export const maxDuration = 45;

type ParserItem = Parser.Item & {
  "content:encoded"?: string;
  author?: string;
  contentEncoded?: string;
  creator?: string;
  summary?: string;
};

const parser = new Parser<object, ParserItem>({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["dc:creator", "creator"],
    ],
  },
});

type NormalizedItem = {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  author: string;
  summary: string;
  content: string;
  contentMarkdown: string;
  contentSource: "article" | "rss";
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );

  return results;
}

export async function GET(request: Request) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const rawUrl = searchParams.get("url");

  if (!rawUrl) {
    return Response.json({ error: "缺少 RSS 链接。" }, { status: 400 });
  }

  let rssUrl: string;

  try {
    rssUrl = validateRssUrl(rawUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "RSS 链接无效。" },
      { status: 400 },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(rssUrl, {
      signal: controller.signal,
      headers: {
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "user-agent": "Personal RSS AI Reader/1.0",
      },
      next: { revalidate: 600 },
    });

    if (!response.ok) {
      return Response.json(
        { error: `RSS 请求失败，状态码 ${response.status}。` },
        { status: 502 },
      );
    }

    const xml = await response.text();

    if (xml.length > 2_000_000) {
      return Response.json({ error: "RSS 内容过大。" }, { status: 413 });
    }

    const feed = await parser.parseString(xml);

    const rssItems: NormalizedItem[] = feed.items.slice(0, 30).map((item, index) => {
      const rawContent =
        item.contentEncoded ?? item.content ?? item["content:encoded"] ?? "";
      const summary = stripHtml(item.contentSnippet ?? item.summary ?? rawContent);
      const content = stripHtml(rawContent || summary);
      const contentMarkdown = htmlToMarkdown(rawContent || summary || content);

      return {
        id: item.guid ?? item.link ?? `${rssUrl}-${index}`,
        title: stripHtml(item.title ?? "未命名文章"),
        link: item.link ?? "",
        pubDate: item.isoDate ?? item.pubDate ?? "",
        author: item.creator ?? item.author ?? "",
        summary,
        content,
        contentMarkdown,
        contentSource: "rss",
      };
    });

    const items = await mapWithConcurrency(rssItems, 4, async (item) => {
      if (!item.link) {
        return item;
      }

      const articleContent = await fetchArticleContent(item.link);

      if (!articleContent) {
        return item;
      }

      return {
        ...item,
        content: articleContent.text,
        contentMarkdown: articleContent.markdown,
        contentSource: "article" as const,
      };
    });

    return Response.json({
      title: feed.title ?? "",
      description: stripHtml(feed.description ?? ""),
      link: feed.link ?? rssUrl,
      items,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "RSS 请求超时。"
        : error instanceof Error
          ? error.message
          : "RSS 解析失败。";

    return Response.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
