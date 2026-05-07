# RSS AI Reader

个人 RSS 阅读器，部署目标是 Vercel。前端负责阅读和操作界面，Next.js Route Handlers 负责 RSS 代理解析、AI 总结/翻译、Azure Speech 音频生成。

## 功能

- 粘贴 RSS 链接并解析文章列表
- 服务端抓取文章原文页面并尽量提取全文
- 保存最近使用过的 RSS 源到浏览器本地
- 对当前文章进行总结或翻译
- Azure Speech 生成原文全文音频
- 可选用 `APP_TOKEN` 保护 API

## 环境变量

```bash
# 可选
APP_TOKEN=

# 按需填写
OPENAI_API_KEY=
OPENAI_BASE_URL=
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=
GEMINI_API_KEY=
GEMINI_BASE_URL=

# 音频
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
AZURE_SPEECH_BASE_URL=
```

## Vercel 部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/deanxizian/rss_web&project-name=rss-web&env=APP_TOKEN,OPENAI_API_KEY,OPENAI_BASE_URL,DEEPSEEK_API_KEY,DEEPSEEK_BASE_URL,GEMINI_API_KEY,GEMINI_BASE_URL,AZURE_SPEECH_KEY,AZURE_SPEECH_REGION,AZURE_SPEECH_BASE_URL)
