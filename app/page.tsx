"use client";

import {
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  FileText,
  Headphones,
  Languages,
  Loader2,
  Rss,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  Fragment,
  type ReactNode,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  azureVoiceOptions,
  openAIModelOptions,
  speechLanguageOptions,
  translationLanguageOptions,
} from "@/lib/options";

type FeedItem = {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  author: string;
  summary: string;
  content: string;
  contentMarkdown?: string;
  contentSource: "article" | "rss";
};

type Feed = {
  title: string;
  description: string;
  link: string;
  items: FeedItem[];
};

type SavedSource = {
  url: string;
  title: string;
  lastFetchedAt: string;
};

type SettingsState = {
  appToken: string;
  openaiModel: string;
  targetLanguage: string;
  azureVoice: string;
  speechLanguage: string;
  speechRate: number;
};

type StatusState = {
  kind: "idle" | "ok" | "error";
  message: string;
};

type ImportResult = {
  sources: SavedSource[];
  added: number;
  duplicates: number;
};

type ParsedOpmlSources = {
  sources: SavedSource[];
  duplicates: number;
};

const settingsKey = "rss-ai-reader:settings";
const sourcesKey = "rss-ai-reader:sources";

const defaultSettings: SettingsState = {
  appToken: "",
  openaiModel: "gpt-5.4-mini",
  targetLanguage: translationLanguageOptions[0].value,
  azureVoice: azureVoiceOptions[0].value,
  speechLanguage: azureVoiceOptions[0].language,
  speechRate: 1,
};

function getDefaultVoiceForLanguage(language: string) {
  return (
    azureVoiceOptions.find((option) => option.language === language) ??
    azureVoiceOptions[0]
  );
}

function normalizeSettings(settings: Partial<SettingsState>): SettingsState {
  const requestedLanguage = settings.speechLanguage;
  const speechLanguage =
    requestedLanguage &&
    speechLanguageOptions.some((option) => option.value === requestedLanguage)
      ? requestedLanguage
      : defaultSettings.speechLanguage;
  const voiceMatchesLanguage = azureVoiceOptions.some(
    (option) =>
      option.value === settings.azureVoice && option.language === speechLanguage,
  );
  const speechRate = Number(settings.speechRate);

  return {
    ...defaultSettings,
    ...settings,
    openaiModel: openAIModelOptions.some(
      (option) => option.value === settings.openaiModel,
    )
      ? (settings.openaiModel ?? defaultSettings.openaiModel)
      : defaultSettings.openaiModel,
    speechLanguage,
    speechRate: Number.isFinite(speechRate)
      ? Math.min(1.5, Math.max(0.7, speechRate))
      : defaultSettings.speechRate,
    azureVoice: voiceMatchesLanguage
      ? (settings.azureVoice ?? getDefaultVoiceForLanguage(speechLanguage).value)
      : getDefaultVoiceForLanguage(speechLanguage).value,
  };
}

function safeJsonParse<T>(value: string | null, fallback: T) {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function sourceUrlKey(url: string) {
  return url.trim().toLowerCase();
}

function normalizeSourceUrl(value: string) {
  try {
    const url = new URL(value.trim());

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function parseOpmlSources(opmlText: string): ParsedOpmlSources {
  const document = new DOMParser().parseFromString(opmlText, "text/xml");
  const parserError = document.querySelector("parsererror");

  if (parserError) {
    throw new Error("OPML 格式有误。");
  }

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const sources: SavedSource[] = [];
  let duplicates = 0;

  for (const outline of Array.from(document.querySelectorAll("outline"))) {
    const rawUrl =
      outline.getAttribute("xmlUrl") ??
      outline.getAttribute("xmlurl") ??
      outline.getAttribute("XMLURL") ??
      "";
    const url = normalizeSourceUrl(rawUrl);

    if (!url) continue;

    const key = sourceUrlKey(url);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);

    const title =
      outline.getAttribute("title")?.trim() ||
      outline.getAttribute("text")?.trim() ||
      url;

    sources.push({
      url,
      title,
      lastFetchedAt: now,
    });
  }

  return { sources, duplicates };
}

function mergeImportedSources(
  currentSources: SavedSource[],
  importedSources: SavedSource[],
): ImportResult {
  const existingByUrl = new Map(
    currentSources.map((source) => [sourceUrlKey(source.url), source]),
  );
  const importedKeys = new Set<string>();
  const sources: SavedSource[] = [];
  let added = 0;
  let duplicates = 0;

  for (const source of importedSources) {
    const key = sourceUrlKey(source.url);
    const existing = existingByUrl.get(key);

    if (existing) {
      duplicates += 1;
      sources.push({
        ...existing,
        title: source.title || existing.title,
      });
    } else {
      added += 1;
      sources.push(source);
    }

    importedKeys.add(key);
  }

  for (const source of currentSources) {
    if (!importedKeys.has(sourceUrlKey(source.url))) {
      sources.push(source);
    }
  }

  return { sources, added, duplicates };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createOpmlDocument(sources: SavedSource[]) {
  const outlines = sources
    .map((source) => {
      const title = escapeXml(source.title || source.url);
      const url = escapeXml(source.url);

      return `    <outline text="${title}" title="${title}" type="rss" xmlUrl="${url}" />`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    "    <title>RSS AI Reader Subscriptions</title>",
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    "  </head>",
    "  <body>",
    outlines,
    "  </body>",
    "</opml>",
    "",
  ].join("\n");
}

function compactDate(value: string) {
  if (!value) return "无时间";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function firstUsefulText(item: FeedItem) {
  return [item.content, item.summary, item.title].find((value) => value.trim()) ?? "";
}

const speechChunkMaxLength = 700;

function splitTextForSpeech(text: string) {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) return [];

  const tokens =
    normalized.match(/[^。！？.!?\n]+[。！？.!?]?|\n+/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";

  function pushCurrent() {
    const next = current.trim();
    if (next) chunks.push(next);
    current = "";
  }

  for (const token of tokens) {
    let piece = token.trim();
    if (!piece) continue;

    while (piece.length > speechChunkMaxLength) {
      if (current) pushCurrent();
      chunks.push(piece.slice(0, speechChunkMaxLength));
      piece = piece.slice(speechChunkMaxLength).trim();
    }

    if (!piece) continue;

    const separator = current ? "\n" : "";
    if (current.length + separator.length + piece.length > speechChunkMaxLength) {
      pushCurrent();
    }

    current = current ? `${current}\n${piece}` : piece;
  }

  pushCurrent();

  return chunks;
}

async function readApiError(response: Response) {
  if (response.status === 401) {
    return "访问口令未填写或不正确。";
  }

  const text = await response.text();

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text;
  }
}

function renderMarkdownInline(text: string) {
  const parts: ReactNode[] = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(
      <a href={match[2]} key={`${match[2]}-${match.index}`} rel="noreferrer" target="_blank">
        {match[1]}
      </a>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length ? parts : text;
}

function MarkdownText({ value }: { value: string }) {
  const lines = value.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let quoteLines: string[] = [];
  let listItems: string[] = [];
  let listType: "ol" | "ul" | null = null;
  let codeLines: string[] = [];
  let inCode = false;

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    if (text) {
      blocks.push(
        <p className="markdown-paragraph" key={`p-${blocks.length}`}>
          {renderMarkdownInline(text)}
        </p>,
      );
    }
    paragraph = [];
  }

  function flushQuote() {
    if (!quoteLines.length) return;
    blocks.push(
      <blockquote className="markdown-quote" key={`q-${blocks.length}`}>
        {quoteLines.map((line, index) => (
          <Fragment key={`${line}-${index}`}>
            {renderMarkdownInline(line)}
            {index < quoteLines.length - 1 ? <br /> : null}
          </Fragment>
        ))}
      </blockquote>,
    );
    quoteLines = [];
  }

  function flushList() {
    if (!listItems.length || !listType) return;
    const Tag = listType;
    blocks.push(
      <Tag className="markdown-list" key={`l-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`${item}-${index}`}>{renderMarkdownInline(item)}</li>
        ))}
      </Tag>,
    );
    listItems = [];
    listType = null;
  }

  function flushCode() {
    if (!codeLines.length) return;
    blocks.push(
      <pre className="markdown-code" key={`c-${blocks.length}`}>
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
    codeLines = [];
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        inCode = false;
        flushCode();
      } else {
        flushParagraph();
        flushQuote();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushQuote();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushQuote();
      flushList();
      blocks.push(
        <p className={`markdown-heading level-${heading[1].length}`} key={`h-${blocks.length}`}>
          {renderMarkdownInline(heading[2])}
        </p>,
      );
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      quoteLines.push(quote[1]);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const nextListType = ordered ? "ol" : "ul";

      if (listType && listType !== nextListType) {
        flushList();
      }

      listType = nextListType;
      listItems.push((unordered ?? ordered)?.[1] ?? trimmed);
      continue;
    }

    flushQuote();
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushQuote();
  flushList();
  flushCode();

  return <>{blocks}</>;
}

export default function Home() {
  const [settings, setSettings] = useState(defaultSettings);
  const [rssUrl, setRssUrl] = useState("");
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState<StatusState>({ kind: "idle", message: "" });
  const [summaryResult, setSummaryResult] = useState("");
  const [translationResult, setTranslationResult] = useState("");
  const [audioSegments, setAudioSegments] = useState<string[]>([]);
  const [audioSegmentTotal, setAudioSegmentTotal] = useState(0);
  const [pendingAudioSegmentIndex, setPendingAudioSegmentIndex] = useState<
    number | null
  >(null);
  const [isFetchingRss, setIsFetchingRss] = useState(false);
  const [aiAction, setAiAction] = useState<"summary" | "translate" | null>(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const [isOpmlDragActive, setIsOpmlDragActive] = useState(false);
  const audioSegmentsRef = useRef<string[]>([]);
  const audioPlayersRef = useRef<Array<HTMLAudioElement | null>>([]);
  const opmlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSettings(
      normalizeSettings(
        safeJsonParse<Partial<SettingsState>>(
          window.localStorage.getItem(settingsKey),
          {},
        ),
      ),
    );
    setSources(
      safeJsonParse<SavedSource[]>(window.localStorage.getItem(sourcesKey), []),
    );
  }, []);

  useEffect(() => {
    window.localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    return () => {
      audioSegmentsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (pendingAudioSegmentIndex === null || !audioSegments[pendingAudioSegmentIndex]) {
      return;
    }

    const nextAudio = audioPlayersRef.current[pendingAudioSegmentIndex];
    if (!nextAudio) return;

    nextAudio.currentTime = 0;
    nextAudio.play().catch(() => undefined);
    setPendingAudioSegmentIndex(null);
  }, [audioSegments, pendingAudioSegmentIndex]);

  const selectedItem = useMemo(() => {
    if (!feed) return null;
    return feed.items.find((item) => item.id === selectedId) ?? feed.items[0] ?? null;
  }, [feed, selectedId]);

  const selectedText = selectedItem ? firstUsefulText(selectedItem) : "";
  const selectedMarkdown = selectedItem?.contentMarkdown?.trim() || selectedText;
  const selectedAiMarkdown = selectedItem
    ? [selectedItem.title ? `# ${selectedItem.title}` : "", selectedMarkdown]
        .filter((value) => value.trim())
        .join("\n\n")
    : "";
  const filteredVoiceOptions = azureVoiceOptions.filter(
    (option) => option.language === settings.speechLanguage,
  );
  const selectedVoiceOption =
    filteredVoiceOptions.find((option) => option.value === settings.azureVoice) ??
    filteredVoiceOptions[0] ??
    azureVoiceOptions[0];

  const authHeaders = useMemo<Record<string, string>>(() => {
    const token = settings.appToken.trim();
    const headers: Record<string, string> = {};

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    return headers;
  }, [settings.appToken]);

  function replaceAudioSegments(nextSegments: string[]) {
    audioSegmentsRef.current.forEach((url) => URL.revokeObjectURL(url));
    audioSegmentsRef.current = nextSegments;
    audioPlayersRef.current = [];
    setAudioSegments(nextSegments);
    setAudioSegmentTotal(nextSegments.length);
    setPendingAudioSegmentIndex(null);
  }

  function appendAudioSegment(nextSegment: string) {
    const nextSegments = [...audioSegmentsRef.current, nextSegment];
    audioSegmentsRef.current = nextSegments;
    setAudioSegments(nextSegments);
  }

  function clearAudioSegments() {
    replaceAudioSegments([]);
  }

  function playAudioSegment(index: number) {
    const audio = audioPlayersRef.current[index];
    if (!audio) {
      setPendingAudioSegmentIndex(index);
      return;
    }

    audio.currentTime = 0;
    audio.play().catch(() => undefined);
  }

  function handleAudioEnded(index: number) {
    const nextIndex = index + 1;
    const total = audioSegmentTotal || audioSegmentsRef.current.length;

    if (nextIndex >= total) {
      return;
    }

    if (audioSegmentsRef.current[nextIndex]) {
      playAudioSegment(nextIndex);
    } else {
      setPendingAudioSegmentIndex(nextIndex);
    }
  }

  function updateSources(nextSources: SavedSource[]) {
    setSources(nextSources);
    window.localStorage.setItem(sourcesKey, JSON.stringify(nextSources));
  }

  function rememberSource(nextFeed: Feed, url: string) {
    const nextSource = {
      url,
      title: nextFeed.title || url,
      lastFetchedAt: new Date().toISOString(),
    };
    const merged = [
      nextSource,
      ...sources.filter((source) => source.url !== url),
    ];

    updateSources(merged);
  }

  async function importOpmlFile(file: File) {
    if (file.size > 2_000_000) {
      setStatus({ kind: "error", message: "OPML 文件超过 2MB。" });
      return;
    }

    try {
      const parsedOpml = parseOpmlSources(await file.text());

      if (!parsedOpml.sources.length) {
        setStatus({
          kind: "error",
          message: "OPML 中没有找到 RSS 链接。",
        });
        return;
      }

      const result = mergeImportedSources(sources, parsedOpml.sources);
      updateSources(result.sources);
      setStatus({
        kind: "ok",
        message: `已导入 ${result.added} 个订阅，跳过 ${
          result.duplicates + parsedOpml.duplicates
        } 个重复项。`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "导入 OPML 失败。",
      });
    }
  }

  function handleOpmlInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (file) {
      void importOpmlFile(file);
    }
  }

  function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    return (
      event.dataTransfer.files.length > 0 ||
      Array.from(event.dataTransfer.types).includes("Files")
    );
  }

  function findOpmlDropFile(files: FileList) {
    const allFiles = Array.from(files);

    return (
      allFiles.find((file) => {
        const name = file.name.toLowerCase();
        return (
          name.endsWith(".opml") ||
          name.endsWith(".xml") ||
          file.type === "text/xml" ||
          file.type === "application/xml"
        );
      }) ?? null
    );
  }

  function handleOpmlDragEnter(event: DragEvent<HTMLFormElement>) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();
    setIsOpmlDragActive(true);
  }

  function handleOpmlDragOver(event: DragEvent<HTMLFormElement>) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsOpmlDragActive(true);
  }

  function handleOpmlDragLeave(event: DragEvent<HTMLFormElement>) {
    const nextTarget = event.relatedTarget;

    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setIsOpmlDragActive(false);
    }
  }

  function handleOpmlDrop(event: DragEvent<HTMLFormElement>) {
    if (!hasDraggedFiles(event)) return;

    event.preventDefault();
    setIsOpmlDragActive(false);

    const file = findOpmlDropFile(event.dataTransfer.files);

    if (!file) {
      setStatus({ kind: "error", message: "请拖入 .opml 或 .xml 文件。" });
      return;
    }

    void importOpmlFile(file);
  }

  function exportOpml() {
    if (!sources.length) {
      setStatus({ kind: "error", message: "暂无可导出的订阅。" });
      return;
    }

    const blob = new Blob([createOpmlDocument(sources)], {
      type: "text/xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);

    link.href = url;
    link.download = `rss-subscriptions-${date}.opml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    setStatus({ kind: "ok", message: `已导出 ${sources.length} 个订阅。` });
  }

  async function fetchFeed(url: string) {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setStatus({ kind: "error", message: "请输入 RSS 链接。" });
      return;
    }

    setIsFetchingRss(true);
    setStatus({ kind: "idle", message: "正在读取 RSS，并抓取正文…" });
    setSummaryResult("");
    setTranslationResult("");
    clearAudioSegments();

    try {
      const response = await fetch(`/api/rss?url=${encodeURIComponent(trimmedUrl)}`, {
        headers: authHeaders,
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const nextFeed = (await response.json()) as Feed;
      setFeed(nextFeed);
      setSelectedId(nextFeed.items[0]?.id ?? "");
      setRssUrl(trimmedUrl);
      rememberSource(nextFeed, trimmedUrl);
      const fullTextCount = nextFeed.items.filter(
        (item) => item.contentSource === "article",
      ).length;
      setStatus({
        kind: "ok",
        message: `已读取 ${nextFeed.items.length} 篇文章，${fullTextCount} 篇抓取到全文。`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "RSS 读取失败。",
      });
    } finally {
      setIsFetchingRss(false);
    }
  }

  async function handleRssSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await fetchFeed(rssUrl);
  }

  async function runAiAction(action: "summary" | "translate") {
    if (!selectedItem || !selectedText.trim()) {
      setStatus({ kind: "error", message: "当前文章没有可处理的正文。" });
      return;
    }

    setAiAction(action);
    if (action === "summary") {
      setSummaryResult("");
    } else {
      setTranslationResult("");
    }
    setStatus({
      kind: "idle",
      message: action === "summary" ? "正在总结正文…" : "正在翻译正文…",
    });

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders,
        },
        body: JSON.stringify({
          action,
          text: selectedAiMarkdown,
          targetLanguage: settings.targetLanguage,
          model: settings.openaiModel,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const data = (await response.json()) as { text: string };
      if (action === "summary") {
        setSummaryResult(data.text);
      } else {
        setTranslationResult(data.text);
      }
      setStatus({
        kind: "ok",
        message: action === "summary" ? "总结已生成。" : "译文已生成。",
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "处理失败，请稍后重试。",
      });
    } finally {
      setAiAction(null);
    }
  }

  async function generateAzureAudio() {
    const text = selectedText;

    if (!text.trim()) {
      setStatus({ kind: "error", message: "当前文章没有可朗读的正文。" });
      return;
    }

    const chunks = splitTextForSpeech(text);

    setIsGeneratingAudio(true);
    clearAudioSegments();
    setAudioSegmentTotal(chunks.length);
    setStatus({
      kind: "idle",
      message: `准备生成全文朗读，共 ${chunks.length} 段…`,
    });

    try {
      for (const [index, chunk] of chunks.entries()) {
        setStatus({
          kind: "idle",
          message: `正在生成音频 ${index + 1}/${chunks.length}…`,
        });

        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...authHeaders,
          },
          body: JSON.stringify({
            text: chunk,
            voice: settings.azureVoice,
            language: selectedVoiceOption.language,
            speechRate: settings.speechRate,
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        appendAudioSegment(URL.createObjectURL(await response.blob()));

        const generatedCount = index + 1;
        if (generatedCount < chunks.length) {
          setStatus({
            kind: "idle",
            message: `已生成 ${generatedCount}/${chunks.length} 段，继续下一段…`,
          });
        }
      }

      setStatus({
        kind: "ok",
        message: `全文朗读音频已生成，共 ${chunks.length} 段。`,
      });
    } catch (error) {
      const generatedCount = audioSegmentsRef.current.length;
      const errorMessage =
        error instanceof Error ? error.message : "生成音频失败，请稍后重试。";
      setStatus({
        kind: "error",
        message: generatedCount
          ? `已保留 ${generatedCount}/${chunks.length} 段；第 ${
              generatedCount + 1
            } 段失败：${errorMessage}`
          : errorMessage,
      });
    } finally {
      setIsGeneratingAudio(false);
    }
  }

  function clearSources() {
    updateSources([]);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
            <div className="brand">
              <h1 className="brand-title">RSS AI Reader</h1>
            <p className="brand-subtitle">RSS 阅读与 AI 内容处理</p>
          </div>

          <form
            className={`rss-form ${isOpmlDragActive ? "drag-active" : ""}`}
            onSubmit={handleRssSubmit}
            onDragEnter={handleOpmlDragEnter}
            onDragOver={handleOpmlDragOver}
            onDragLeave={handleOpmlDragLeave}
            onDrop={handleOpmlDrop}
          >
            <input
              className="input"
              value={rssUrl}
              onChange={(event) => setRssUrl(event.target.value)}
              placeholder="RSS 链接，或拖入 OPML"
              aria-label="RSS 链接"
            />
            <button
              className="button primary rss-read-button"
              type="submit"
              disabled={isFetchingRss}
              title="读取 RSS"
            >
              {isFetchingRss ? <Loader2 className="spin" /> : <Send />}
              读取
            </button>
            <div className="rss-secondary-actions">
              <button
                className="button primary"
                type="button"
                onClick={() => opmlInputRef.current?.click()}
                title="导入 OPML"
                aria-label="导入 OPML"
              >
                <Upload />
                导入
              </button>
              <button
                className="button primary"
                type="button"
                onClick={exportOpml}
                disabled={!sources.length}
                title="导出 OPML"
                aria-label="导出 OPML"
              >
                <Download />
                导出
              </button>
            </div>
            <input
              ref={opmlInputRef}
              className="hidden-file-input"
              type="file"
              accept=".opml,application/xml,text/xml"
              onChange={handleOpmlInputChange}
            />
          </form>

          <div className={`status-line ${status.kind}`}>
            {status.message || "输入 RSS 链接，或导入 OPML 订阅"}
          </div>
        </div>
      </header>

      <div className="main-grid">
        <div
          className={`navigation-stack ${
            isSettingsOpen ? "settings-open" : "settings-closed"
          }`}
        >
          <aside className="side-stack">
            <section
              className={`panel settings-panel ${isSettingsOpen ? "expanded" : ""}`}
              aria-labelledby="settings-title"
            >
            <div className="panel-header">
              <div>
                <h2 className="panel-title" id="settings-title">
                  偏好
                </h2>
                <p className="panel-note">模型、翻译和朗读设置</p>
              </div>
              <button
                aria-expanded={isSettingsOpen}
                className="button icon-only ghost"
                onClick={() => setIsSettingsOpen((current) => !current)}
                title={isSettingsOpen ? "收起偏好" : "展开偏好"}
                type="button"
              >
                {isSettingsOpen ? <ChevronUp /> : <ChevronDown />}
              </button>
            </div>

            {isSettingsOpen ? (
              <div className="panel-body stack">
                <label className="setting-row">
                  <span className="label">访问口令</span>
                  <input
                    className="input"
                    type="password"
                    value={settings.appToken}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        appToken: event.target.value,
                      }))
                    }
                    placeholder="留空则不启用"
                  />
                </label>

                <label className="setting-row">
                  <span className="label">AI 模型</span>
                  <select
                    className="select"
                    value={settings.openaiModel}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        openaiModel: event.target.value,
                      }))
                    }
                  >
                    {openAIModelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="setting-row">
                  <span className="label">目标语言</span>
                  <select
                    className="select"
                    value={settings.targetLanguage}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        targetLanguage: event.target.value,
                      }))
                    }
                  >
                    {translationLanguageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="setting-row">
                  <span className="label">朗读语言</span>
                  <select
                    className="select"
                    value={settings.speechLanguage}
                    onChange={(event) => {
                      const language = event.target.value;
                      const voice = getDefaultVoiceForLanguage(language);

                      setSettings((current) => ({
                        ...current,
                        speechLanguage: voice.language,
                        azureVoice: voice.value,
                      }));
                    }}
                  >
                    {speechLanguageOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="setting-row">
                  <span className="label">朗读音色</span>
                  <select
                    className="select"
                    value={selectedVoiceOption.value}
                    onChange={(event) => {
                      const voice =
                        filteredVoiceOptions.find(
                          (option) => option.value === event.target.value,
                        ) ?? getDefaultVoiceForLanguage(settings.speechLanguage);

                      setSettings((current) => ({
                        ...current,
                        azureVoice: voice.value,
                        speechLanguage: voice.language,
                      }));
                    }}
                  >
                    {filteredVoiceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="setting-row">
                  <span className="label">朗读速度</span>
                  <div className="range-row">
                    <input
                      className="range-input"
                      type="range"
                      min="0.7"
                      max="1.5"
                      step="0.05"
                      value={settings.speechRate}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          speechRate: Number(event.target.value),
                        }))
                      }
                    />
                    <span className="range-value">
                      {settings.speechRate.toFixed(2)}x
                    </span>
                  </div>
                </label>

                <p className="hint">
                  密钥读自环境变量；口令留空不校验。
                </p>
              </div>
            ) : null}
            </section>

            <section className="panel" aria-labelledby="sources-title">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title" id="sources-title">
                    RSS 订阅
                  </h2>
                  <p className="panel-note">本地保存，可导入或导出</p>
                </div>
                <button
                  className="button icon-only ghost"
                  type="button"
                  onClick={clearSources}
                  disabled={!sources.length}
                  title="清空订阅"
                  aria-label="清空订阅"
                >
                  <Trash2 />
                </button>
              </div>

              <div className="panel-body source-list">
                {sources.length ? (
                  sources.map((source) => (
                    <button
                      className={`source-item ${source.url === rssUrl ? "active" : ""}`}
                      key={source.url}
                      type="button"
                      onClick={() => fetchFeed(source.url)}
                    >
                      <p className="item-title">{source.title}</p>
                      <div className="item-meta">
                        <span>{compactDate(source.lastFetchedAt)}</span>
                        <span>{source.url}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="hint">暂无订阅记录</p>
                )}
              </div>
            </section>
          </aside>

          <section className="panel feed-panel" aria-labelledby="feed-title">
            <div className="panel-header">
              <div>
                  <h2 className="panel-title" id="feed-title">
                    文章
                  </h2>
                <p className="panel-note">当前订阅的文章</p>
              </div>
              <Rss aria-hidden="true" />
            </div>

            {feed ? (
              <>
                <div className="feed-meta">
                  <h2>{feed.title || "未命名订阅"}</h2>
                  {feed.description ? <p>{feed.description}</p> : null}
                </div>
                <div className="article-list-wrap article-list">
                  {feed.items.map((item) => (
                    <button
                      className={`article-item ${
                        item.id === selectedItem?.id ? "active" : ""
                      }`}
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(item.id);
                        setSummaryResult("");
                        setTranslationResult("");
                        clearAudioSegments();
                      }}
                    >
                      <p className="item-title">{item.title || "未命名文章"}</p>
                      <div className="item-meta">
                        <span>{compactDate(item.pubDate)}</span>
                        {item.author ? <span>{item.author}</span> : null}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty">读取 RSS 后显示文章</div>
            )}
          </section>
        </div>

        <div className="workspace-stack">
          <section className="panel original-panel" aria-labelledby="original-title">
            <div className="panel-header">
              <div>
                  <h2 className="panel-title" id="original-title">
                    原文
                  </h2>
                <p className="panel-note">提取到的正文</p>
              </div>
              <FileText aria-hidden="true" />
            </div>

            <div className={`panel-body ${selectedItem ? "" : "empty-panel-body"}`}>
              {selectedItem ? (
                <article className="article-detail">
                  <div>
                    <h2 className="detail-title">{selectedItem.title}</h2>
                    {selectedItem.link ? (
                      <a
                        className="detail-link"
                        href={selectedItem.link}
                        rel="noreferrer"
                        target="_blank"
                      >
                        查看原文 <ExternalLink size={13} />
                      </a>
                    ) : null}
                    <div className="item-meta">
                      <span>{compactDate(selectedItem.pubDate)}</span>
                      {selectedItem.author ? <span>{selectedItem.author}</span> : null}
                    </div>
                  </div>

                  <div className="original-window-body markdown-content">
                    <MarkdownText value={selectedMarkdown || "暂无正文内容"} />
                  </div>
                </article>
              ) : (
                <div className="empty">选择一篇文章查看正文</div>
              )}
            </div>
          </section>

          <section className="panel workbench-panel" aria-labelledby="workbench-title">
            <div className="panel-header">
              <div>
                  <h2 className="panel-title" id="workbench-title">
                    工作台
                  </h2>
                <p className="panel-note">对当前文章生成结果</p>
              </div>
              <Wrench aria-hidden="true" />
            </div>

            <div className={`panel-body ${selectedItem ? "" : "empty-panel-body"}`}>
              {selectedItem ? (
                <div className="window-grid">
                  <section className="tool-window" aria-label="总结模块">
                    <div className="tool-window-header">
                      <div className="window-title">
                        <Sparkles />
                        <span>文章总结</span>
                      </div>
                      <button
                        className="button primary module-action"
                        type="button"
                        onClick={() => runAiAction("summary")}
                        disabled={Boolean(aiAction)}
                        title="生成总结"
                      >
                        {aiAction === "summary" ? <Loader2 /> : <Sparkles />}
                        生成总结
                      </button>
                    </div>
                    <div className="tool-window-body">
                      <div className="result-text markdown-content">
                        {summaryResult ? (
                          <MarkdownText value={summaryResult} />
                        ) : aiAction === "summary" ? (
                          "正在总结正文…"
                        ) : (
                          "点击按钮生成总结"
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="tool-window" aria-label="翻译模块">
                    <div className="tool-window-header">
                      <div className="window-title">
                        <Languages />
                        <span>全文翻译</span>
                      </div>
                      <button
                        className="button primary module-action"
                        type="button"
                        onClick={() => runAiAction("translate")}
                        disabled={Boolean(aiAction)}
                        title="翻译全文"
                      >
                        {aiAction === "translate" ? <Loader2 /> : <Languages />}
                        翻译全文
                      </button>
                    </div>
                    <div className="tool-window-body">
                      <div className="result-text markdown-content">
                        {translationResult ? (
                          <MarkdownText value={translationResult} />
                        ) : aiAction === "translate" ? (
                          "正在翻译正文…"
                        ) : (
                          "点击按钮生成译文"
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="tool-window" aria-label="音频模块">
                    <div className="tool-window-header">
                      <div className="window-title">
                        <Headphones />
                        <span>全文朗读</span>
                      </div>
                      <button
                        className="button primary module-action"
                        type="button"
                        onClick={generateAzureAudio}
                        disabled={isGeneratingAudio}
                        title="生成全文音频"
                      >
                        {isGeneratingAudio ? <Loader2 /> : <Headphones />}
                        {isGeneratingAudio ? "生成中" : "生成音频"}
                      </button>
                    </div>
                    <div className="tool-window-body">
                      {audioSegments.length ? (
                        <div className="audio-stack">
                          {isGeneratingAudio && audioSegmentTotal > 1 ? (
                            <div className="audio-progress">
                              已生成 {audioSegments.length}/{audioSegmentTotal} 段，剩余段落继续处理中…
                            </div>
                          ) : null}
                          {audioSegments.map((url, index) => (
                            <div className="audio-segment" key={url}>
                              {(audioSegmentTotal || audioSegments.length) > 1 ? (
                                <div className="audio-meta">
                                  第 {index + 1} /{" "}
                                  {audioSegmentTotal || audioSegments.length} 段
                                </div>
                              ) : null}
                              <audio
                                className="audio-player"
                                controls
                                onEnded={() => handleAudioEnded(index)}
                                ref={(element) => {
                                  audioPlayersRef.current[index] = element;
                                }}
                                src={url}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="result-text">
                          {isGeneratingAudio ? "正在生成音频…" : "点击按钮生成全文音频"}
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="empty">选择一篇文章后开始处理</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
