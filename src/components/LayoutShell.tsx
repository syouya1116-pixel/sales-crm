'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import KpiAlertBar from './KpiAlertBar'
import { IS_DEMO } from '@/lib/demo'
import { useSiteSettings } from './SiteSettingsProvider'

const TONE_CLASS = {
  info: 'bg-sky-50 text-sky-800 border-sky-200',
  warning: 'bg-rose-50 text-rose-800 border-rose-200',
  success: 'bg-emerald-50 text-emerald-800 border-emerald-200',
} as const

// 設定画面で入れた「お知らせ」。空なら出さない
function Announcement() {
  const { settings } = useSiteSettings()
  const a = settings.announcement
  if (!a.enabled || !a.text) return null
  return <div className={`text-xs text-center px-3 py-1.5 border-b ${TONE_CLASS[a.tone]}`}>{a.text}</div>
}

// デモ環境のお知らせ。どの画面でも上に出す
function DemoBanner() {
  if (!IS_DEMO) return null
  return (
    <div className="bg-amber-100 text-amber-900 text-xs text-center px-3 py-1.5 border-b border-amber-200">
      デモ環境です。データは架空で、毎日初期化されます（メール送信・カレンダー登録は実際には行われません）
    </div>
  )
}

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { settings } = useSiteSettings()

  const isStaff = session?.user?.role === 'staff'
  // ログイン画面・スタッフ（マイページ）は CRM サイドバーを出さない
  const noSidebar = pathname === '/login' || isStaff || pathname.startsWith('/staff')

  if (noSidebar) return <>{pathname !== '/login' && <><DemoBanner /><Announcement /></>}{children}</>

  return (
    <div className="flex min-h-screen dot-grid">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* モバイル用ヘッダー */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-12 bg-[#0f172a] z-30 flex items-center px-4 border-b border-white/[0.06]">
        <button onClick={() => setSidebarOpen(true)} className="text-slate-300 hover:text-white p-1">
          <Menu size={22} />
        </button>
        <p className="text-slate-100 font-bold text-sm ml-3 truncate">{settings.companyName} {settings.systemName}</p>
      </div>
      <div className="flex-1 min-w-0 md:ml-56 min-h-screen pt-12 md:pt-0">
        {/* KPI未達の警告バー。スクロールしても残るように sticky。
            モバイルは固定ヘッダー（h-12）の下に貼り付ける。
            通常フローの高さを持つので、下のページ内容は自然に押し下がる */}
        <div className="sticky top-12 md:top-0 z-20">
          <DemoBanner />
          <Announcement />
          <KpiAlertBar />
        </div>
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>
  )
}
