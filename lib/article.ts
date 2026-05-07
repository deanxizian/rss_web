import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { stripHtml, truncateText, validateRssUrl } from "@/lib/rss";

const articleSelectors = [
  "article",
  "main",
  "[role='main']",
  ".post-content",
  ".entry-content",
  ".article-content",
  ".article-body",
  ".post-body",
  ".content",
];

const noisySelectors = [
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "[aria-hidden='true']",
  ".comments",
  ".comment",
  ".related",
  ".recommend",
  ".share",
  ".social",
  ".subscribe",
  ".newsletter",
  ".advertisement",
  ".ads",
  ".ad",
];

function normalizeText(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeMarkdown(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getMarkdownBlock($: cheerio.CheerioAPI, element: Element) {
  const tagName = element.tagName.toLowerCase();
  const text = normalizeText($(element).text());

  if (!text) {
    return "";
  }

  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName.slice(1));
    return `${"#".repeat(level)} ${text}`;
  }

  if (tagName === "li") {
    return `- ${text.replace(/\n+/g, " ")}`;
  }

  if (tagName === "blockquote") {
    return text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (tagName === "pre") {
    return `\`\`\`\n${$(element).text().trim()}\n\`\`\``;
  }

  return text;
}

function getNodeText($: cheerio.CheerioAPI, element: Element) {
  const clone = $(element).clone();
  clone.find(noisySelectors.join(",")).remove();

  const paragraphs = clone
    .find("h1,h2,h3,p,li,blockquote,pre")
    .map((_, node) => normalizeText($(node).text()))
    .get()
    .filter((text) => text.length > 20);

  if (paragraphs.length) {
    return normalizeText(paragraphs.join("\n\n"));
  }

  return normalizeText(clone.text());
}

export function htmlToMarkdown(html: string) {
  const $ = cheerio.load(html);
  $(noisySelectors.join(",")).remove();

  const blockSelector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre";
  const blocks = $(blockSelector)
    .filter((_, node) => $(node).parents(blockSelector).length === 0)
    .map((_, node) => getMarkdownBlock($, node as Element))
    .get()
    .filter((text) => text.length > 0);

  if (blocks.length) {
    return normalizeMarkdown(blocks.join("\n\n"));
  }

  return normalizeMarkdown(stripHtml(html));
}

function getNodeMarkdown($: cheerio.CheerioAPI, element: Element) {
  const clone = $(element).clone();
  clone.find(noisySelectors.join(",")).remove();

  return htmlToMarkdown(clone.html() ?? clone.text());
}

function scoreText(text: string) {
  const punctuation = (text.match(/[。！？.!?]/g) ?? []).length;
  const paragraphBreaks = (text.match(/\n\n/g) ?? []).length;

  return text.length + punctuation * 30 + paragraphBreaks * 80;
}

export function extractArticleContent(html: string) {
  const $ = cheerio.load(html);
  $(noisySelectors.join(",")).remove();

  const candidates: Array<{ text: string; markdown: string }> = [];

  for (const selector of articleSelectors) {
    $(selector).each((_, element) => {
      const text = getNodeText($, element as Element);

      if (text.length > 200) {
        candidates.push({
          text,
          markdown: getNodeMarkdown($, element as Element),
        });
      }
    });
  }

  $("body").each((_, element) => {
    const text = getNodeText($, element as Element);

    if (text.length > 200) {
      candidates.push({
        text,
        markdown: getNodeMarkdown($, element as Element),
      });
    }
  });

  const best = candidates.sort((a, b) => scoreText(b.text) - scoreText(a.text))[0];
  const text = truncateText(stripHtml(best?.text ?? ""), 80_000);
  const markdown = truncateText(best?.markdown || text, 100_000);

  return { text, markdown };
}

export function extractArticleText(html: string) {
  return extractArticleContent(html).text;
}

export async function fetchArticleContent(link: string) {
  let articleUrl: string;

  try {
    articleUrl = validateRssUrl(link);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(articleUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Personal RSS AI Reader/1.0",
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (
      contentType &&
      !contentType.includes("html") &&
      !contentType.includes("xml") &&
      !contentType.includes("text")
    ) {
      return null;
    }

    const html = await response.text();

    if (!html || html.length > 5_000_000) {
      return null;
    }

    const content = extractArticleContent(html);

    if (content.text.length < 300) {
      return null;
    }

    return content;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchArticleText(link: string) {
  return (await fetchArticleContent(link))?.text ?? null;
}
