'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import KpiAlertBar from './KpiAlertBar'

export default function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const isStaff = session?.user?.role === 'staff'
  // ログイン画面・スタッフ（マイページ）は CRM サイドバーを出さない
  const noSidebar = pathname === '/login' || isStaff || pathname.startsWith('/staff')

  if (noSidebar) return <>{children}</>

  return (
    <div className="flex min-h-screen dot-grid">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {/* モバイル用ヘッダー */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-12 bg-[#0f172a] z-30 flex items-center px-4 border-b border-white/[0.06]">
        <button onClick={() => setSidebarOpen(true)} className="text-slate-300 hover:text-white p-1">
          <Menu size={22} />
        </button>
        <p className="text-slate-100 font-bold text-sm ml-3">さんぷる CRM</p>
      </div>
      <div className="flex-1 md:ml-56 min-h-screen pt-12 md:pt-0">
        {/* KPI未達の警告バー。スクロールしても残るように sticky。
            モバイルは固定ヘッダー（h-12）の下に貼り付ける。
            通常フローの高さを持つので、下のページ内容は自然に押し下がる */}
        <div className="sticky top-12 md:top-0 z-20">
          <KpiAlertBar />
        </div>
        <div className="relative z-10">
          {children}
        </div>
      </div>
    </div>
  )
}
