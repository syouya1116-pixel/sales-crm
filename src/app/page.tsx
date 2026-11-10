'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { emailToName } from '@/lib/emailToName'
import { getSearchVariants } from '@/lib/normalizeSearch'
import { fetchAllPaged, fetchByIdChunks } from '@/lib/supabaseFetch'
import { normalizePhone } from '@/lib/normalize'
import { statusColor } from '@/lib/statusColors'
import { Company, Status } from '@/types'
import { Plus, Search, Phone, Mail, Globe, RefreshCw, Building2, CheckSquare, Square, Trash2, NotebookPen } from 'lucide-react'
import Link from 'next/link'
import { ACCOUNT_ORDER } from '@/config/team'

type Task = {
  id: string
  title: string
  done: boolean
  created_by: string | null
  created_at: string
  scheduled_date: string
  original_date: string | null
  is_shared: boolean
}

const daysOverdue = (task: Task, today: string): number => {
  const baseDate = task.original_date || task.scheduled_date
  const diff = new Date(today + 'T00:00:00').getTime() - new Date(baseDate + 'T00:00:00').getTime()
  return Math.max(0, Math.floor(diff / 86400000))
}

/** 顧客一覧で契約済み・禁止を目立たせる装飾。テーブル行とスマホのカードで共通 */
const highlightClass = (statusName?: string): string => {
  if (statusName === '契約済み') return 'bg-yellow-50/60 border-l-[3px] border-l-yellow-400'
  if (statusName === '禁止') return 'bg-red-50/60 border-l-[3px] border-l-red-400'
  return ''
}

const overdueBadgeStyle = (days: number): { badge: string; row: string } => {
  if (days >= 4) return { badge: 'bg-red-100 text-red-600', row: 'bg-red-50/40' }
  if (days >= 2) return { badge: 'bg-orange-100 text-orange-600', row: 'bg-orange-50/40' }
  if (days >= 1) return { badge: 'bg-yellow-100 text-yellow-700', row: 'bg-yellow-50/40' }
  return { badge: '', row: '' }
}


const PAGE_SIZE = 50

const sortByAccountOrder = (a: string, b: string) => {
  const ai = ACCOUNT_ORDER.indexOf(a)
  const bi = ACCOUNT_ORDER.indexOf(b)
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
}

export default function Home() {
  const { data: session } = useSession()
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [statuses, setStatuses] = useState<Status[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [suggestions, setSuggestions] = useState<Company[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [newTask, setNewTask] = useState('')
  const [isSharedTask, setIsSharedTask] = useState(false)
  const [taskAdding, setTaskAdding] = useState(false)
  const [memoContent, setMemoContent] = useState('')
  const [memoSaving, setMemoSaving] = useState(false)
  const memoRef = useRef<HTMLTextAreaElement>(null)

  const fetchTasks = useCallback(async () => {
    const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
    // 未完了の過去タスクを今日に引き継ぎ
    const { data: overdue } = await supabase.from('tasks').select('id').eq('done', false).lt('scheduled_date', todayStr)
    if (overdue && overdue.length > 0) {
      await supabase.from('tasks').update({ scheduled_date: todayStr }).in('id', overdue.map(t => t.id))
    }
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('scheduled_date', todayStr)
      .order('created_at', { ascending: true })
    if (data) setTasks(data)
  }, [])

  const addTask = async () => {
    if (!newTask.trim()) return
    setTaskAdding(true)
    const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()
    const { data } = await supabase
      .from('tasks')
      .insert({ title: newTask.trim(), created_by: session?.user?.email || null, is_shared: isSharedTask, scheduled_date: todayStr, original_date: todayStr })
      .select()
      .single()
    if (data) setTasks(prev => [...prev, data])
    setNewTask('')
    setTaskAdding(false)
  }

  const toggleTask = async (task: Task) => {
    await supabase.from('tasks').update({ done: !task.done }).eq('id', task.id)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, done: !t.done } : t))
  }

  const deleteTask = async (id: string) => {
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const fetchStatuses = async () => {
    const { data } = await supabase.from('statuses').select('*').order('sort_order')
    if (data) setStatuses(data)
  }

  const saveMemo = async () => {
    if (!memoContent.trim()) return
    setMemoSaving(true)
    await fetch('/api/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: memoContent }),
    })
    setMemoSaving(false)
  }

  const fetchCompanies = useCallback(async () => {
    setLoading(true)
    const variants = getSearchVariants(search)
    const primarySearch = variants[0] ?? ''
    const hasJapanese = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(primarySearch)
    const hasDigit = /\d/.test(primarySearch)
    const hasAt = /@/.test(primarySearch)
    const doPhone = primarySearch !== '' && hasDigit && !hasJapanese && !hasAt
    const doEmail = primarySearch !== '' && hasAt
    const doName = primarySearch !== '' && !doPhone && !doEmail

    // 電話検索: RPC で ID 全件収集 → ページ分割
    if (doPhone) {
      const phoneData = await fetchAllPaged<{ company_id: string }>((from, to) =>
        supabase.rpc('search_phones_normalized', { search_text: normalizePhone(primarySearch) }).range(from, to)
      )
      const allIds = [...new Set<string>(phoneData.map(r => r.company_id))]
      setTotalCount(allIds.length)
      const pageIds = allIds.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
      if (pageIds.length === 0) { setCompanies([]); setLoading(false); return }
      let q = supabase
        .from('companies')
        .select(`*, statuses(id, name), sales_reps(id, name), company_urls(*), company_phones(*), company_emails(*)`)
        .in('id', pageIds)
        .order('updated_at', { ascending: false })
      if (statusFilter) q = q.eq('status_id', statusFilter)
      const { data } = await q
      if (data) setCompanies(data)
      setLoading(false)
      return
    }

    // メール検索: company_emails から ID 全件収集 → ページ分割
    if (doEmail) {
      const emailData = await fetchAllPaged<{ company_id: string }>((from, to) =>
        supabase
          .from('company_emails')
          .select('company_id')
          .ilike('email', `%${primarySearch}%`)
          .range(from, to)
      )
      const allIds = [...new Set<string>(emailData.map(r => r.company_id))]
      setTotalCount(allIds.length)
      const pageIds = allIds.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
      if (pageIds.length === 0) { setCompanies([]); setLoading(false); return }
      let q = supabase
        .from('companies')
        .select(`*, statuses(id, name), sales_reps(id, name), company_urls(*), company_phones(*), company_emails(*)`)
        .in('id', pageIds)
        .order('updated_at', { ascending: false })
      if (statusFilter) q = q.eq('status_id', statusFilter)
      const { data } = await q
      if (data) setCompanies(data)
      setLoading(false)
      return
    }

    // 名前検索: カタカナ・ひらがな両バリアントで ID を全件収集 → ページ分割（スペース有無を無視して比較）
    if (doName) {
      const idSet = new Set<string>()
      const rpcResults = await Promise.all(
        variants.map(v =>
          fetchAllPaged<{ id: string }>((from, to) =>
            supabase.rpc('search_company_ids_by_name', { search_text: v }).range(from, to)
          )
        )
      )
      rpcResults.forEach(rows => rows.forEach(row => idSet.add(row.id)))
      const allMatchIds = [...idSet]

      let filteredIds = allMatchIds
      if (statusFilter && allMatchIds.length > 0) {
        const sf = await fetchByIdChunks<{ id: string }>(allMatchIds, chunk =>
          supabase.from('companies').select('id').in('id', chunk).eq('status_id', statusFilter)
        )
        filteredIds = sf.map(r => r.id)
      }

      setTotalCount(filteredIds.length)
      const pageIds = filteredIds.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
      if (pageIds.length === 0) { setCompanies([]); setLoading(false); return }

      const { data } = await supabase
        .from('companies')
        .select(`*, statuses(id, name), sales_reps(id, name), company_urls(*), company_phones(*), company_emails(*)`)
        .in('id', pageIds)
        .order('updated_at', { ascending: false })
      if (data) setCompanies(data)
      setLoading(false)
      return
    }

    // 検索なし・フィルターなし → 最新50件のみ（countなし）
    if (!statusFilter) {
      const { data } = await supabase
        .from('companies')
        .select(`*, statuses(id, name), sales_reps(id, name), company_urls(*), company_phones(*), company_emails(*)`)
        .order('updated_at', { ascending: false })
        .limit(PAGE_SIZE)
      if (data) setCompanies(data)
      setTotalCount(0)
      setLoading(false)
      return
    }

    // ステータスフィルターのみ → 全件検索・ページネーション
    const query = supabase
      .from('companies')
      .select(`*, statuses(id, name), sales_reps(id, name), company_urls(*), company_phones(*), company_emails(*)`, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1)
      .eq('status_id', statusFilter)
    const { data, count } = await query
    if (data) setCompanies(data)
    if (count !== null) setTotalCount(count)
    setLoading(false)
  }, [search, statusFilter, currentPage])

  const fetchSuggestions = useCallback(async (q: string) => {
    const variants = getSearchVariants(q)
    if (!variants.length) { setSuggestions([]); return }
    const primarySearch = variants[0] ?? ''
    const hasJapanese = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(primarySearch)
    const hasDigit = /\d/.test(primarySearch)
    const hasAt = /@/.test(primarySearch)
    const doPhone = hasDigit && !hasJapanese && !hasAt
    const doEmail = hasAt

    if (doPhone || doEmail) {
      const [phoneRes, emailRes] = await Promise.all([
        doPhone ? supabase.rpc('search_phones_normalized', { search_text: primarySearch.replace(/\s/g, '') }) : Promise.resolve({ data: [] }),
        doEmail ? supabase.from('company_emails').select('company_id').ilike('email', `%${primarySearch}%`).limit(8) : Promise.resolve({ data: [] }),
      ])
      const idSet = new Set<string>()
      phoneRes.data?.forEach((r: { company_id: string }) => idSet.add(r.company_id))
      emailRes.data?.forEach((r: { company_id: string }) => idSet.add(r.company_id))
      const pageIds = [...idSet].slice(0, 8)
      if (pageIds.length === 0) { setSuggestions([]); return }

      const { data } = await supabase
        .from('companies')
        .select('id, name, representative_name, service_name, genre, statuses(name), company_phones(phone), company_emails(email)')
        .in('id', pageIds)
      if (data) setSuggestions(data as unknown as Company[])
      return
    }

    // サジェスト名前検索（スペース有無を無視して比較）
    {
      const idSet = new Set<string>()
      const rpcResults = await Promise.all(
        variants.map(v => supabase.rpc('search_company_ids_by_name', { search_text: v }))
      )
      rpcResults.forEach(r => r.data?.forEach((row: { id: string }) => idSet.add(row.id)))
      const suggIds = [...idSet].slice(0, 8)
      if (suggIds.length > 0) {
        const { data } = await supabase
          .from('companies')
          .select('id, name, representative_name, service_name, genre, statuses(name), company_phones(phone), company_emails(email)')
          .in('id', suggIds)
          .limit(8)
        if (data) setSuggestions(data as unknown as Company[])
      } else {
        setSuggestions([])
      }
    }
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 初回表示時にDBから取得する
  useEffect(() => { fetchStatuses() }, [])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 初回表示時にDBから取得する
  useEffect(() => { fetchTasks() }, [fetchTasks])
  useEffect(() => {
    if (!session?.user?.email) return
    const saved = localStorage.getItem(`personalMemo_${session.user.email}`)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ログイン後に端末保存のメモを読み込む（SSR中は localStorage が無い）
    if (saved) setMemoContent(saved)
  }, [session?.user?.email])
  useEffect(() => {
    if (!session?.user?.email) return
    localStorage.setItem(`personalMemo_${session.user.email}`, memoContent)
    if (memoRef.current) {
      memoRef.current.style.height = 'auto'
      memoRef.current.style.height = memoRef.current.scrollHeight + 'px'
    }
  }, [memoContent, session?.user?.email])
  useEffect(() => {
    const t = setTimeout(fetchCompanies, 300)
    return () => clearTimeout(t)
  }, [fetchCompanies])
  useEffect(() => {
    const t = setTimeout(() => fetchSuggestions(search), 200)
    return () => clearTimeout(t)
  }, [search, fetchSuggestions])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
  }

  const todayISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })()

  return (
    <div className="p-4 md:p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      {/* メモ */}
      <div className="premium-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <NotebookPen size={15} className="text-indigo-500" />
            <h2 className="text-sm font-semibold text-slate-700">メモ</h2>
          </div>
          <button
            onClick={saveMemo}
            disabled={memoSaving || !memoContent.trim()}
            className="tap-target text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition font-semibold shadow disabled:opacity-50"
          >
            {memoSaving ? '保存中...' : '保存'}
          </button>
        </div>
        <textarea
          ref={memoRef}
          value={memoContent}
          onChange={e => setMemoContent(e.target.value)}
          placeholder="メモを入力..."
          style={{ minHeight: '200px', maxHeight: '600px', overflowY: 'auto' }}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
        />
        <Link href="/memos" className="text-xs text-slate-400 hover:text-indigo-500 mt-2 inline-block transition">
          過去のメモを見る →
        </Link>
      </div>

      {/* 本日のタスク */}
      <div className="premium-card rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CheckSquare size={15} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-slate-700">本日のタスク</h2>
            <span className="text-xs text-slate-400">{tasks.filter(t => !t.done).length}件未完了</span>
          </div>
        </div>
        <div className="flex gap-2 mb-3 items-center">
          <input
            type="text"
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && session?.user?.email && addTask()}
            placeholder="タスクを追加..."
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer whitespace-nowrap select-none">
            <input
              type="checkbox"
              checked={isSharedTask}
              onChange={e => setIsSharedTask(e.target.checked)}
              className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
            />
            <span className={isSharedTask ? 'text-amber-600 font-medium' : ''}>共通</span>
          </label>
          <button
            onClick={addTask}
            disabled={taskAdding || !newTask.trim() || !session?.user?.email}
            className="tap-target bg-violet-600 hover:bg-violet-700 text-white px-3 py-2 rounded-lg text-sm transition disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-slate-400">タスクはありません</p>
        ) : (
          <div className="space-y-3">
            {/* 共通タスク */}
            {tasks.filter(t => t.is_shared).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-600 mb-1.5">共通タスク</p>
                <div className="space-y-1 bg-amber-50 rounded-xl p-2 border border-amber-100">
                  {tasks.filter(t => t.is_shared).map(t => {
                    const days = t.done ? 0 : daysOverdue(t, todayISO)
                    const { badge, row } = overdueBadgeStyle(days)
                    return (
                    <div key={t.id} className={`flex items-start gap-2 p-1.5 rounded-lg hover:bg-amber-100/60 group ${!t.done ? row : ''}`}>
                      <button onClick={() => toggleTask(t)} className="shrink-0 transition mt-0.5 text-amber-400 hover:text-amber-600">
                        {t.done ? <CheckSquare size={15} className="text-amber-500" /> : <Square size={15} />}
                      </button>
                      <span className={`flex-1 text-sm min-w-0 break-words ${t.done ? 'line-through text-slate-300' : 'text-slate-700'}`}>
                        {t.title}
                      </span>
                      {days >= 1 && !t.done && (
                        <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-md ${badge}`}>
                          +{days}日
                        </span>
                      )}
                      <button
                        onClick={() => deleteTask(t.id)}
                        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition shrink-0"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* 担当者別タスク */}
            {tasks.filter(t => !t.is_shared).length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from(new Set(tasks.filter(t => !t.is_shared).map(t => t.created_by || ''))).sort(sortByAccountOrder).map(account => (
                  <div key={account} className="min-w-0">
                    <p className="text-xs font-semibold text-slate-500 mb-1">{emailToName(account) || '不明'}</p>
                    <div className="space-y-1">
                      {tasks.filter(t => !t.is_shared && (t.created_by || '') === account).map(t => {
                        const isOwn = t.created_by === session?.user?.email || !t.created_by
                        const days = t.done ? 0 : daysOverdue(t, todayISO)
                        const { badge, row } = overdueBadgeStyle(days)
                        return (
                          <div key={t.id} className={`flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50 group ${!t.done ? row : ''}`}>
                            <button onClick={() => isOwn && toggleTask(t)} className={`shrink-0 transition mt-0.5 ${isOwn ? 'text-slate-400 hover:text-violet-500' : 'text-slate-200 cursor-not-allowed'}`}>
                              {t.done ? <CheckSquare size={15} className={isOwn ? 'text-violet-500' : 'text-slate-300'} /> : <Square size={15} />}
                            </button>
                            <span className={`flex-1 text-sm min-w-0 break-words ${t.done ? 'line-through text-slate-300' : 'text-slate-700'}`}>
                              {t.title}
                            </span>
                            {days >= 1 && !t.done && (
                              <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-md ${badge}`}>
                                +{days}日
                              </span>
                            )}
                            {isOwn && (
                              <button
                                onClick={() => deleteTask(t.id)}
                                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition shrink-0"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* ページヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">顧客一覧</h2>
          <p className="text-sm text-slate-400 mt-0.5">{totalCount.toLocaleString()}件の顧客</p>
        </div>
        <Link
          href="/companies/new"
          className="tap-target flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium shadow-sm transition"
        >
          <Plus size={15} />新規登録
        </Link>
      </div>

      {/* 検索・フィルター */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative w-full sm:flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="会社名・電話番号・メール・担当者で検索..."
            value={search}
            onChange={e => { setSearch(e.target.value); setCurrentPage(0); setShowSuggestions(true) }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
              {suggestions.map(s => (
                <Link key={s.id} href={`/companies/${s.id}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <Building2 size={13} className="text-slate-400 mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-800">{s.name}</span>
                      {s.statuses && (
                        <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{s.statuses.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {s.representative_name && (
                        <span className="text-xs text-slate-400">{s.representative_name}</span>
                      )}
                      {s.service_name && (
                        <span className="text-xs text-slate-400 truncate max-w-[120px]">{s.service_name}</span>
                      )}
                      {s.company_phones?.[0] && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Phone size={10} />{s.company_phones[0].phone}
                        </span>
                      )}
                      {s.company_emails?.[0] && (
                        <span className="flex items-center gap-1 text-xs text-slate-400 truncate max-w-[150px]">
                          <Mail size={10} />{s.company_emails[0].email}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setCurrentPage(0) }}
          className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm min-w-[150px]"
        >
          <option value="">すべてのステータス</option>
          {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <button onClick={fetchCompanies} className="tap-target border border-slate-200 rounded-xl px-3 py-2.5 bg-white hover:bg-slate-50 shadow-sm transition">
          <RefreshCw size={15} className="text-slate-500" />
        </button>
      </div>

      {/* テーブル */}
      <div className="premium-card rounded-2xl overflow-hidden">
        {loading ? (
          <div className="py-24 text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">読み込み中...</p>
          </div>
        ) : companies.length === 0 ? (
          <div className="py-24 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Building2 size={24} className="text-slate-300" />
            </div>
            <p className="text-sm text-slate-400">顧客が見つかりません</p>
          </div>
        ) : (
          <>
            <div className="bg-slate-50/80 border-b border-slate-200 px-4 sm:px-5 py-2">
              {!search && !statusFilter
                ? <span className="text-xs text-slate-400">最近更新された50件を表示　／　検索またはフィルターで全件から絞り込み</span>
                : <span className="text-xs text-slate-400">{totalCount.toLocaleString()}件</span>
              }
            </div>

            {/* スマホ・タブレット向けのカード表示。
                テーブルは列幅の合計が910px必要で、サイドバー(224px)を引いた
                本文幅がそれを下回ると premium-card の overflow-hidden で列が切れてしまう */}
            <div className="lg:hidden divide-y divide-slate-100">
              {companies.map(c => (
                <div
                  key={c.id}
                  onClick={() => router.push(`/companies/${c.id}`)}
                  className={`px-4 py-3 cursor-pointer active:bg-blue-50/50 transition-colors ${highlightClass(c.statuses?.name)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/companies/${c.id}`}
                        onClick={e => e.stopPropagation()}
                        className="font-semibold text-slate-800 text-sm break-words"
                      >
                        {c.name}
                      </Link>
                      {c.representative_name && (
                        <p className="text-xs text-slate-400 mt-0.5 break-words">{c.representative_name}</p>
                      )}
                    </div>
                    {c.statuses && (
                      <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium ${statusColor(c.statuses.name)}`}>
                        {c.statuses.name}
                      </span>
                    )}
                  </div>

                  {c.service_name && (
                    <p className="text-xs text-slate-500 mt-1.5 break-words">{c.service_name}</p>
                  )}

                  <div className="flex flex-col gap-1.5 mt-2">
                    {c.company_phones?.[0] && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Phone size={12} className="text-slate-300 shrink-0" />
                        {/* 外出先でそのまま発信できるようにリンクにしている */}
                        <a href={`tel:${c.company_phones[0].phone}`} onClick={e => e.stopPropagation()} className="text-blue-500 break-all">
                          {c.company_phones[0].phone}
                        </a>
                      </span>
                    )}
                    {c.company_emails?.[0] && (
                      <span className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
                        <Mail size={12} className="text-slate-300 shrink-0" />
                        <span className="truncate">{c.company_emails[0].email}</span>
                      </span>
                    )}
                    {c.company_urls?.[0] && (
                      <span className="flex items-center gap-1.5 text-xs min-w-0">
                        <Globe size={12} className="text-slate-300 shrink-0" />
                        <a
                          href={c.company_urls[0].url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-blue-400 truncate"
                        >
                          {c.company_urls[0].url.replace(/^https?:\/\//, '')}
                        </a>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                    <span>{c.sales_reps?.name || '担当なし'}</span>
                    <span>更新 {formatDate(c.updated_at)}</span>
                    {c.last_emailed_at && <span>送信 {formatDate(c.last_emailed_at)}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* PC向けのテーブル。中途半端な幅でも列が切れないよう横スクロールを許す */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full table-fixed min-w-[1020px]">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-400 px-5 py-3.5 uppercase tracking-wider w-[220px]">会社名</th>
                    <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3.5 uppercase tracking-wider w-[120px]">ステータス</th>
                    <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3.5 uppercase tracking-wider w-[160px]">サービス名</th>
                    <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3.5 uppercase tracking-wider w-[220px]">連絡先</th>
                    <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3.5 uppercase tracking-wider w-[90px]">担当</th>
                    <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3.5 uppercase tracking-wider w-[110px]">最終送信</th>
                    <th className="text-left text-xs font-semibold text-slate-400 px-4 py-3.5 uppercase tracking-wider w-[100px]">更新日</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {companies.map(c => (
                    <tr key={c.id} onClick={() => router.push(`/companies/${c.id}`)} className={`cursor-pointer hover:bg-blue-50/30 transition-colors group ${highlightClass(c.statuses?.name)}`}>
                      <td className="px-5 py-3.5">
                        <Link href={`/companies/${c.id}`} className="font-semibold text-slate-800 hover:text-blue-600 text-sm transition-colors truncate block">
                          {c.name}
                        </Link>
                        {c.representative_name && (
                          <div className="text-xs text-slate-400 mt-0.5 truncate">{c.representative_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        {c.statuses && (
                          <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-medium ${statusColor(c.statuses.name)}`}>
                            {c.statuses.name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-slate-500 truncate">{c.service_name || <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1">
                          {c.company_phones?.[0] && (
                            <span className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                              <Phone size={11} className="text-slate-300 shrink-0" />{c.company_phones[0].phone}
                            </span>
                          )}
                          {c.company_emails?.[0] && (
                            <span className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                              <Mail size={11} className="text-slate-300 shrink-0" />{c.company_emails[0].email}
                            </span>
                          )}
                          {c.company_urls?.[0] && (
                            <span className="flex items-center gap-1.5 text-xs">
                              <Globe size={11} className="text-slate-300" />
                              <a href={c.company_urls[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-blue-400 hover:underline truncate max-w-[140px]">
                                {c.company_urls[0].url.replace(/^https?:\/\//, '')}
                              </a>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-slate-500">{c.sales_reps?.name || <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3.5 text-xs text-slate-400">{c.last_emailed_at ? formatDate(c.last_emailed_at) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3.5 text-xs text-slate-400">{formatDate(c.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ページネーション（検索・フィルター時のみ） */}
      {(search || statusFilter) && totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-sm text-slate-400">
            {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, totalCount)} / {totalCount.toLocaleString()}件
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => p - 1)}
              disabled={currentPage === 0}
              className="tap-target px-4 py-2 text-sm border border-slate-200 rounded-xl bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              前へ
            </button>
            <span className="text-sm text-slate-500">
              {currentPage + 1} / {Math.ceil(totalCount / PAGE_SIZE)}
            </span>
            <button
              onClick={() => setCurrentPage(p => p + 1)}
              disabled={(currentPage + 1) * PAGE_SIZE >= totalCount}
              className="tap-target px-4 py-2 text-sm border border-slate-200 rounded-xl bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              次へ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
