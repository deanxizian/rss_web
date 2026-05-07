"use client";

import {
  ExternalLink,
  FileText,
  Headphones,
  Languages,
  Loader2,
  Rss,
  Save,
  Send,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
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
};

type StatusState = {
  kind: "idle" | "ok" | "error";
  message: string;
};

const settingsKey = "rss-ai-reader:settings";
const sourcesKey = "rss-ai-reader:sources";

const defaultSettings: SettingsState = {
  appToken: "",
  openaiModel: "gpt-5.4-mini",
  targetLanguage: translationLanguageOptions[0].value,
  azureVoice: azureVoiceOptions[0].value,
  speechLanguage: azureVoiceOptions[0].language,
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

  return {
    ...defaultSettings,
    ...settings,
    speechLanguage,
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

function compactDate(value: string) {
  if (!value) return "时间未知";

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

const speechChunkMaxLength = 2_500;

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
  const [currentAudioSegmentIndex, setCurrentAudioSegmentIndex] = useState(0);
  const [shouldAutoPlayAudio, setShouldAutoPlayAudio] = useState(false);
  const [isFetchingRss, setIsFetchingRss] = useState(false);
  const [aiAction, setAiAction] = useState<"summary" | "translate" | null>(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(true);
  const audioSegmentsRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
    if (!shouldAutoPlayAudio || !audioRef.current) {
      return;
    }

    audioRef.current.play().catch(() => undefined);
    setShouldAutoPlayAudio(false);
  }, [currentAudioSegmentIndex, shouldAutoPlayAudio]);

  const selectedItem = useMemo(() => {
    if (!feed) return null;
    return feed.items.find((item) => item.id === selectedId) ?? feed.items[0] ?? null;
  }, [feed, selectedId]);

  const selectedText = selectedItem ? firstUsefulText(selectedItem) : "";
  const selectedMarkdown = selectedItem?.contentMarkdown?.trim() || selectedText;
  const filteredVoiceOptions = azureVoiceOptions.filter(
    (option) => option.language === settings.speechLanguage,
  );
  const selectedVoiceOption =
    filteredVoiceOptions.find((option) => option.value === settings.azureVoice) ??
    filteredVoiceOptions[0] ??
    azureVoiceOptions[0];
  const currentAudioUrl = audioSegments[currentAudioSegmentIndex] ?? "";

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
    setAudioSegments(nextSegments);
    setCurrentAudioSegmentIndex(0);
    setShouldAutoPlayAudio(false);
  }

  function clearAudioSegments() {
    replaceAudioSegments([]);
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
    ].slice(0, 12);

    updateSources(merged);
  }

  async function fetchFeed(url: string) {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      setStatus({ kind: "error", message: "请输入 RSS 源链接。" });
      return;
    }

    setIsFetchingRss(true);
    setStatus({ kind: "idle", message: "正在载入 RSS，并获取文章全文..." });
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
        message: `已载入 ${nextFeed.items.length} 篇，${fullTextCount} 篇获取到全文。`,
      });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "RSS 载入失败。",
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
      setStatus({ kind: "error", message: "这篇文章没有可处理的正文。" });
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
      message: action === "summary" ? "正在生成总结..." : "正在翻译原文...",
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
          text: `${selectedItem.title}\n\n${selectedText}`,
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
      setStatus({ kind: "ok", message: "已完成。" });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "处理失败。",
      });
    } finally {
      setAiAction(null);
    }
  }

  async function generateAzureAudio() {
    const text = selectedText;

    if (!text.trim()) {
      setStatus({ kind: "error", message: "这篇文章没有可生成音频的正文。" });
      return;
    }

    const chunks = splitTextForSpeech(text);
    const nextAudioSegments: string[] = [];

    setIsGeneratingAudio(true);
    clearAudioSegments();
    setStatus({
      kind: "idle",
      message: `正在生成原文音频，共 ${chunks.length} 段...`,
    });

    try {
      for (const [index, chunk] of chunks.entries()) {
        setStatus({
          kind: "idle",
          message: `正在生成原文音频 ${index + 1}/${chunks.length}...`,
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
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiError(response));
        }

        nextAudioSegments.push(URL.createObjectURL(await response.blob()));
      }

      replaceAudioSegments(nextAudioSegments);
      setStatus({
        kind: "ok",
        message: `音频已生成，共 ${chunks.length} 段，播放时会自动衔接。`,
      });
    } catch (error) {
      nextAudioSegments.forEach((url) => URL.revokeObjectURL(url));
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "音频生成失败。",
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
            <p className="brand-subtitle">个人 RSS 阅读与 AI 处理</p>
          </div>

          <form className="rss-form" onSubmit={handleRssSubmit}>
            <input
              className="input"
              value={rssUrl}
              onChange={(event) => setRssUrl(event.target.value)}
              placeholder="输入 RSS 源 URL"
              aria-label="RSS 源链接"
            />
            <button
              className="button primary"
              type="submit"
              disabled={isFetchingRss}
              title="载入 RSS"
            >
              {isFetchingRss ? <Loader2 className="spin" /> : <Send />}
              载入
            </button>
          </form>

          <div className={`status-line ${status.kind}`}>
            {status.message || "准备就绪"}
          </div>
        </div>
      </header>

      <div className="main-grid">
        <div className="navigation-stack">
          <aside className="side-stack">
            <section className="panel settings-panel" aria-labelledby="settings-title">
            <div className="panel-header">
              <div>
                <h2 className="panel-title" id="settings-title">
                  偏好
                </h2>
                <p className="panel-note">访问口令 / 模型 / 翻译 / 音色</p>
              </div>
              <button
                aria-expanded={isSettingsOpen}
                className="button icon-only ghost"
                onClick={() => setIsSettingsOpen((current) => !current)}
                title={isSettingsOpen ? "收起偏好" : "展开偏好"}
                type="button"
              >
                <Settings />
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
                    placeholder="可留空"
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
                  <span className="label">翻译为</span>
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

                <div className="divider" />

                <label className="setting-row">
                  <span className="label">音频语言</span>
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
                  <span className="label">音色</span>
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

                <p className="hint">
                  密钥与 Base URL 来自环境变量；访问口令为空时不校验。
                </p>
              </div>
            ) : null}
            </section>

            <section className="panel" aria-labelledby="sources-title">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title" id="sources-title">
                    RSS 源
                  </h2>
                  <p className="panel-note">最近使用</p>
                </div>
                <button
                  className="button icon-only ghost"
                  type="button"
                  onClick={clearSources}
                  disabled={!sources.length}
                  title="清空记录"
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
                  <p className="hint">暂无记录</p>
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
                <p className="panel-note">Feed 内容</p>
              </div>
              <Rss aria-hidden="true" />
            </div>

            {feed ? (
              <>
                <div className="feed-meta">
                  <h2>{feed.title || "未命名 RSS"}</h2>
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
              <div className="empty">暂无文章</div>
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
                <p className="panel-note">当前文章</p>
              </div>
              <FileText aria-hidden="true" />
            </div>

            <div className="panel-body">
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
                    <MarkdownText value={selectedMarkdown || "暂无正文"} />
                  </div>
                </article>
              ) : (
                <div className="empty">未选择文章</div>
              )}
            </div>
          </section>

          <section className="panel workbench-panel" aria-labelledby="workbench-title">
            <div className="panel-header">
              <div>
                <h2 className="panel-title" id="workbench-title">
                  工作台
                </h2>
                <p className="panel-note">总结 / 翻译 / 音频</p>
              </div>
              <Save aria-hidden="true" />
            </div>

            <div className="panel-body">
              {selectedItem ? (
                <div className="window-grid">
                  <section className="tool-window" aria-label="总结模块">
                    <div className="tool-window-header">
                      <div className="window-title">
                        <Sparkles />
                        <span>总结</span>
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
                      <p className="result-text">
                        {summaryResult ||
                          (aiAction === "summary"
                            ? "正在生成总结..."
                            : "暂无总结")}
                      </p>
                    </div>
                  </section>

                  <section className="tool-window" aria-label="翻译模块">
                    <div className="tool-window-header">
                      <div className="window-title">
                        <Languages />
                        <span>翻译</span>
                      </div>
                      <button
                        className="button primary module-action"
                        type="button"
                        onClick={() => runAiAction("translate")}
                        disabled={Boolean(aiAction)}
                        title="翻译原文"
                      >
                        {aiAction === "translate" ? <Loader2 /> : <Languages />}
                        翻译原文
                      </button>
                    </div>
                    <div className="tool-window-body">
                      <p className="result-text">
                        {translationResult ||
                          (aiAction === "translate"
                            ? "正在翻译原文..."
                            : "暂无译文")}
                      </p>
                    </div>
                  </section>

                  <section className="tool-window" aria-label="音频模块">
                    <div className="tool-window-header">
                      <div className="window-title">
                        <Headphones />
                        <span>原文音频</span>
                      </div>
                      <button
                        className="button primary module-action"
                        type="button"
                        onClick={generateAzureAudio}
                        disabled={isGeneratingAudio}
                        title="生成原文音频"
                      >
                        {isGeneratingAudio ? <Loader2 /> : <Headphones />}
                        生成音频
                      </button>
                    </div>
                    <div className="tool-window-body">
                      {currentAudioUrl ? (
                        <div className="audio-stack">
                          <audio
                            className="audio-player"
                            controls
                            key={currentAudioUrl}
                            onEnded={() => {
                              if (currentAudioSegmentIndex < audioSegments.length - 1) {
                                setCurrentAudioSegmentIndex((current) => current + 1);
                                setShouldAutoPlayAudio(true);
                              }
                            }}
                            ref={audioRef}
                            src={currentAudioUrl}
                          />
                          {audioSegments.length > 1 ? (
                            <div className="audio-meta">
                              <span>
                                第 {currentAudioSegmentIndex + 1} / {audioSegments.length} 段
                              </span>
                              <div className="audio-nav">
                                <button
                                  className="button module-action"
                                  disabled={currentAudioSegmentIndex === 0}
                                  onClick={() => {
                                    setCurrentAudioSegmentIndex((current) =>
                                      Math.max(0, current - 1),
                                    );
                                    setShouldAutoPlayAudio(false);
                                  }}
                                  type="button"
                                >
                                  上一段
                                </button>
                                <button
                                  className="button module-action"
                                  disabled={
                                    currentAudioSegmentIndex >= audioSegments.length - 1
                                  }
                                  onClick={() => {
                                    setCurrentAudioSegmentIndex((current) =>
                                      Math.min(audioSegments.length - 1, current + 1),
                                    );
                                    setShouldAutoPlayAudio(false);
                                  }}
                                  type="button"
                                >
                                  下一段
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="result-text">
                          {isGeneratingAudio ? "正在生成音频..." : "暂无音频"}
                        </p>
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                <div className="empty">未选择文章</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
