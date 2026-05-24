import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "寰宇KTV — 在海外，把家变回 KTV 包厢",
  description:
    "为海外华人做的桌面 KTV 应用。有真 MV、不用国内 IP、买断不订阅。Mac + Windows 双平台，7 天免费试用。",
  openGraph: {
    title: "寰宇KTV — 在海外，把家变回 KTV 包厢",
    description:
      "有真 MV、不用国内 IP、买断不订阅。Mac + Windows 双平台，7 天免费试用。",
    type: "website",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "寰宇KTV",
    description: "在海外，把家变回 KTV 包厢。",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-ink-900 antialiased">{children}</body>
    </html>
  );
}
