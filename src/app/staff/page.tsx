'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import StaffFormMode from '@/components/staff/StaffFormMode'
import { Plus, LogOut, RefreshCw, Mail, FileText, ClipboardList, ChevronRight } from 'lucide-react'

type EmailLog = { sent_at: string; subject: string | null; send_type: string | null }
type StaffCompany = {
  id: string
  name: string
  created_at: string
  statuses: { name: string } | null
  company_emails: { email: string }[]
  email_logs: EmailLog[]
}

function fmt(d: string) {
  const dt = new Date(d)
  return `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
}

export default function StaffPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const email = session?.user?.email
  const [companies, setCompanies] = useState<StaffCompany[]>([])
  const [formSentCount, setFormSentCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [formMode, setFormMode] = useState(false)

  const load = useCallback(async () => {
    if (!email) return
    setLoading(true)
    const [{ data }, { count }] = await Promise.all([
      supabase
        .from('companies')
        .select('id, name, created_at, statuses(name), company_emails(email), email_logs(sent_at, subject, send_type)')
        .eq('created_by', email)
        .order('created_at', { ascending: false }),
      // 自分が送ったフォーム送信の件数（他人が作ったリストへの送信も含む）
      supabase
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('sent_by', email)
        .eq('send_type', 'form'),
    ])
    setCompanies((data as unknown as StaffCompany[]) ?? [])
    setFormSentCount(count ?? 0)
    setLoading(false)
  }, [email])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ログイン確認後にDBから取得する
    if (status === 'authenticated') load()
  }, [status, load])

  const total = companies.length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-slate-800">マイページ</h1>
            <p className="text-xs text-slate-400">{session?.user?.name || email}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="p-2 text-slate-400 hover:text-slate-700 transition"
              title="更新"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5 transition"
            >
              <LogOut size={13} />ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {formMode ? (
          <StaffFormMode
            onExit={() => { setFormMode(false); load() }}
            onRecorded={() => setFormSentCount(c => c + 1)}
          />
        ) : (
          <>
            {/* 実績 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-400">リスト作成</p>
                <p className="text-2xl font-bold text-indigo-600">
                  {total}<span className="text-sm font-medium text-slate-400 ml-1">件</span>
                </p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-xs text-slate-400">フォーム送信</p>
                <p className="text-2xl font-bold text-orange-500">
                  {formSentCount}<span className="text-sm font-medium text-slate-400 ml-1">件</span>
                </p>
              </div>
            </div>

            {/* 仕事を選ぶ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => router.push('/companies/new')}
                className="group flex items-center gap-3 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl px-4 py-4 text-left transition"
              >
                <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-indigo-50 group-hover:bg-indigo-100 text-indigo-600 shrink-0 transition">
                  <Plus size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">新規顧客登録</span>
                  <span className="block text-xs text-slate-400 mt-0.5">リストを作成して追加する</span>
                </span>
                <ChevronRight size={16} className="text-slate-300 group-hover:text-indigo-400 shrink-0 transition" />
              </button>

              <button
                onClick={() => setFormMode(true)}
                className="group flex items-center gap-3 bg-white hover:bg-orange-50 border border-slate-200 hover:border-orange-300 rounded-xl px-4 py-4 text-left transition"
              >
                <span className="flex items-center justify-center w-10 h-10 rounded-lg bg-orange-50 group-hover:bg-orange-100 text-orange-500 shrink-0 transition">
                  <ClipboardList size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">メール送信</span>
                  <span className="block text-xs text-slate-400 mt-0.5">フォームから問い合わせを送る</span>
                </span>
                <ChevronRight size={16} className="text-slate-300 group-hover:text-orange-400 shrink-0 transition" />
              </button>
            </div>

            {/* 自分が作ったリスト */}
            <div className="pt-1">
              <p className="text-xs font-medium text-slate-500 mb-2 px-1">あなたが作成したリスト</p>
              {loading ? (
                <p className="text-center text-sm text-slate-400 py-10">読み込み中...</p>
              ) : companies.length === 0 ? (
                <div className="text-center text-sm text-slate-400 py-16 bg-white rounded-xl border border-slate-200">
                  まだリストがありません。<br />「新規顧客登録」から追加してください。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {companies.map(c => (
                    <div key={c.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800 truncate">{c.name}</p>
                          {c.company_emails?.[0]?.email && (
                            <p className="text-xs text-slate-400 truncate flex items-center gap-1 mt-0.5">
                              <Mail size={11} />{c.company_emails[0].email}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          {c.statuses?.name && (
                            <span className="inline-block text-xs font-medium text-indigo-700 bg-indigo-50 rounded-full px-2.5 py-0.5">
                              {c.statuses.name}
                            </span>
                          )}
                          <p className="text-[11px] text-slate-400 mt-1">登録 {fmt(c.created_at)}</p>
                        </div>
                      </div>

                      {/* 送信履歴 */}
                      {c.email_logs && c.email_logs.length > 0 && (
                        <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-1">
                          {c.email_logs
                            .slice()
                            .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())
                            .map((log, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs text-slate-500">
                                <FileText size={11} className="text-emerald-500 shrink-0" />
                                <span className="text-emerald-600 font-medium">
                                  {log.send_type === 'form' ? 'フォーム送信' : 'メール送信'}
                                </span>
                                <span className="text-slate-400">{fmt(log.sent_at)}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
