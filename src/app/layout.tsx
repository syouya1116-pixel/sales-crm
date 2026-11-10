import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import SessionWrapper from "@/components/SessionWrapper";
import LayoutShell from "@/components/LayoutShell";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "さんぷるメール管理",
  description: "さんぷるメール管理システム",
  icons: { icon: '/logo.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${geist.variable} antialiased`}>
        <SessionWrapper>
          <LayoutShell>{children}</LayoutShell>
        </SessionWrapper>
      </body>
    </html>
  );
}
