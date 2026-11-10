import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";
import SessionWrapper from "@/components/SessionWrapper";
import LayoutShell from "@/components/LayoutShell";
import SiteSettingsProvider from "@/components/SiteSettingsProvider";
import { IS_DEMO } from "@/lib/demo";
import { loadSiteSettings } from "@/lib/siteSettingsServer";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

const icons = { icon: '/logo.svg' };

export async function generateMetadata(): Promise<Metadata> {
  if (!IS_DEMO) {
    return { title: "さんぷるメール管理", description: "さんぷるメール管理システム", icons };
  }
  await connection();
  const { settings } = await loadSiteSettings();
  return {
    title: `${settings.companyName} ${settings.systemName}（デモ）`,
    description: "営業CRMのデモ環境（架空データ）",
    icons,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // デモでは設定画面の変更をすぐ反映したいので、毎回読み込む（ビルド時に固定しない）
  if (IS_DEMO) await connection();
  const { settings, reps } = await loadSiteSettings();
  return (
    <html lang="ja">
      <body className={`${geist.variable} antialiased`}>
        <SessionWrapper>
          <SiteSettingsProvider initial={settings} initialReps={reps}>
            <LayoutShell>{children}</LayoutShell>
          </SiteSettingsProvider>
        </SessionWrapper>
      </body>
    </html>
  );
}
