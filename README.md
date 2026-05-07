# RSS AI Reader

个人 RSS 阅读器，部署目标是 Vercel。前端提供阅读与操作界面，Next.js Route Handlers 负责 RSS 代理解析、AI 总结/翻译，以及 Azure Speech 朗读音频生成。

## 功能

- 输入 RSS 链接并读取文章列表
- 在服务端抓取原文页面并尽量提取全文
- 在浏览器本地保存最近读取过的 RSS 订阅
- 对当前文章生成总结或译文
- 使用 Azure Speech 生成正文朗读音频
- 可选用 `APP_TOKEN` 保护 API 访问

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

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/deanxizian/rss_web&project-name=rss-web)

## 项目截图

![RSS AI Reader 界面截图](docs/screenshot.png)
