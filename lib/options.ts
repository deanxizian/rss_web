export const openAIModelOptions = [
  { value: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  { value: "gpt-5.5", label: "gpt-5.5" },
  {
    value: "gemini-3.1-flash-lite-preview",
    label: "gemini-3.1-flash-lite-preview",
  },
  { value: "deepseek-v4-flash", label: "deepseek-v4-flash" },
] as const;

export const translationLanguageOptions = [
  { value: "中文", label: "中文" },
  { value: "英文", label: "英文" },
] as const;

export const azureVoiceOptions = [
  { value: "zh-CN-XiaoxiaoNeural", label: "晓晓（中文女声）", language: "zh-CN" },
  { value: "zh-CN-XiaoyiNeural", label: "晓伊（中文女声）", language: "zh-CN" },
  { value: "zh-CN-YunxiNeural", label: "云希（中文男声）", language: "zh-CN" },
  { value: "zh-CN-YunjianNeural", label: "云健（中文男声）", language: "zh-CN" },
  { value: "zh-CN-YunyangNeural", label: "云扬（中文男声）", language: "zh-CN" },
  {
    value: "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural",
    label: "晓晓 Dragon HD Flash（中文女声）",
    language: "zh-CN",
  },
  {
    value: "zh-CN-Xiaoxiao2:DragonHDFlashLatestNeural",
    label: "晓晓 2 Dragon HD Flash（中文女声）",
    language: "zh-CN",
  },
  {
    value: "zh-CN-Yunxiao:DragonHDFlashLatestNeural",
    label: "云霄 Dragon HD Flash（中文男声）",
    language: "zh-CN",
  },
  {
    value: "zh-CN-Yunyi:DragonHDFlashLatestNeural",
    label: "云逸 Dragon HD Flash（中文男声）",
    language: "zh-CN",
  },
  { value: "en-US-JennyNeural", label: "Jenny（英文女声）", language: "en-US" },
  { value: "en-US-GuyNeural", label: "Guy（英文男声）", language: "en-US" },
] as const;

export const speechLanguageOptions = [
  { value: "zh-CN", label: "中文" },
  { value: "en-US", label: "英文" },
] as const;

export const speechRateOptions = [
  { value: 0.85, label: "稍慢 0.85x" },
  { value: 1, label: "正常 1.00x" },
  { value: 1.15, label: "稍快 1.15x" },
  { value: 1.3, label: "快速 1.30x" },
  { value: 1.5, label: "很快 1.50x" },
] as const;
