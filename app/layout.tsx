import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RSS AI Reader",
  description: "Personal RSS reader with translation, summaries, and speech.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
