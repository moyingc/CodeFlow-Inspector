import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ProductPresentationBoundary } from "@/app/components/ProductPresentationBoundary";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const productLocale = process.env.NEXT_PUBLIC_CODEFLOW_LOCALE === "en-US" ? "en-US" : "zh-CN";

export const metadata: Metadata = {
  title: "CodeFlow Inspector",
  description: productLocale === "en-US"
    ? "A local-first workspace for code data-flow diagnostics, function graphs, security checks, and optimization assessment."
    : "本地优先的代码数据流诊断、函数图谱、安全检查、环境检查与优化评估工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={productLocale}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ProductPresentationBoundary locale={productLocale}>{children}</ProductPresentationBoundary>
      </body>
    </html>
  );
}
