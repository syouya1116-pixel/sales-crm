'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { SendHorizonal, Upload, LogOut, User, LayoutDashboard, BarChart2, CheckSquare, Calendar, Settings, TrendingUp, NotebookPen } from 'lucide-react'
import { emailToName } from '@/lib/emailToName'
import { supabase } from '@/lib/supabase'
import { useSiteSettings } from './SiteSettingsProvider'

const navItems = [
  { href: '/', label: '顧客一覧', icon: LayoutDashboard },
  { href: '/bulk-send', label: '一斉送信', icon: SendHorizonal },
  { href: '/tasks', label: 'タスク管理', icon: CheckSquare },
  { href: '/appointments', label: 'アポ一覧', icon: Calendar },
  { href: '/analytics', label: '集計', icon: BarChart2 },
  { href: '/sales-board', label: '売上ボード', icon: TrendingUp },
  { href: '/import', label: 'CSVインポート', icon: Upload },
  { href: '/memos', label: 'メモ', icon: NotebookPen },
]

export default function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [isAdmin, setIsAdmin] = useState(false)
  const { settings } = useSiteSettings()
  const visibleNav = navItems.filter(n => !settings.hiddenMenus.includes(n.href))

  useEffect(() => {
    if (!session?.user?.email) return
    supabase.from('admin_users').select('id').eq('email', session.user.email).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data))
  }, [session?.user?.email])

  return (
    <>
      {/* モバイル用バックドロップ */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={onClose}
        />
      )}
    <aside className={`fixed left-0 top-0 h-screen w-56 flex flex-col z-40 bg-[#0f172a] transition-transform duration-300 md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      {/* ロゴ */}
      <div className="px-5 py-5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 ring-1 ring-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={settings.logoDataUrl || '/logo.svg'} alt="ロゴ" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-slate-100 font-bold text-xs leading-tight tracking-wide truncate">{settings.companyName}</p>
            <p className="text-indigo-400 text-[10px] leading-tight font-medium tracking-widest uppercase truncate">{settings.systemName}</p>
          </div>
        </div>
      </div>

      {/* ナビ */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visibleNav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
                active
                  ? 'active bg-indigo-600/90 text-white'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'
              }`}
            >
              <Icon size={15} className={active ? 'text-indigo-200' : ''} />
              {label}
            </Link>
          )
        })}
        {isAdmin && (
          <Link
            href="/settings"
            onClick={onClose}
            className={`nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
              pathname === '/settings'
                ? 'active bg-indigo-600/90 text-white'
                : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'
            }`}
          >
            <Settings size={15} />
            設定
          </Link>
        )}
      </nav>

      {/* ユーザー */}
      <div className="px-3 py-4 border-t border-white/[0.06]">
        {session ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 ring-1 ring-white/10">
              {session.user?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt="アバター"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full bg-indigo-600 flex items-center justify-center">
                  <User size={14} className="text-white" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-200 text-xs font-medium truncate">{emailToName(session.user?.email)}</p>
            </div>
            <button
              onClick={() => signOut()}
              className="text-slate-600 hover:text-slate-300 transition-colors shrink-0"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </aside>
    </>
  )
}
