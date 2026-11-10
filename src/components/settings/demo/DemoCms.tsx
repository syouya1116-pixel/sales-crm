'use client'

import { SiteInfoCard, AnnouncementCard, MenuCard, ListColumnsCard } from './LookCards'
import { TeamCard, StatusCard, KpiCard } from './DataCards'

// デモ環境の設定画面に足す「サイトのカスタマイズ」。
// 見た目（会社名・色・メニュー・列・お知らせ）は demo_settings に、
// チーム・ステータス・KPI はそれぞれの表に保存する。データは毎日の初期化で元に戻る。

const SECTIONS = [
  ['cms-site', 'サイト情報'],
  ['cms-banner', 'お知らせ'],
  ['cms-menu', 'メニュー'],
  ['cms-columns', '一覧の列'],
  ['cms-team', 'チーム'],
  ['cms-status', 'ステータス'],
  ['cms-kpi', 'KPI'],
  ['cms-master', '商材・ジャンル'],
  ['cms-templates', 'テンプレート'],
] as const

export function DemoCmsNav() {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="設定の項目">
      {SECTIONS.map(([id, label]) => (
        <a key={id} href={`#${id}`} className="text-xs text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1.5 hover:border-slate-300 hover:text-slate-800">
          {label}
        </a>
      ))}
    </nav>
  )
}

export default function DemoCms() {
  return (
    <>
      <SiteInfoCard />
      <AnnouncementCard />
      <MenuCard />
      <ListColumnsCard />
      <TeamCard />
      <StatusCard />
      <KpiCard />
    </>
  )
}
