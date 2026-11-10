'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'
import { emailToName } from '@/lib/emailToName'
import { Calendar, Pencil } from 'lucide-react'
import Link from 'next/link'
import { ACCOUNT_ORDER } from '@/config/team'

type Appointment = {
  id: string
  title: string
  start_at: string
  end_at: string | null
  created_by: string | null
  company_id: string | null
  google_event_id: string | null
  companies: { id: string; name: string } | null
}

type EditForm = {
  title: string
  startAt: string
  endAt: string
}


const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

const toLabel = (key: string, today: string, tomorrow: string) => {
  if (key === today) return '今日'
  if (key === tomorrow) return '明日'
  const d = new Date(key + 'T00:00:00')
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}

const formatTime = (iso: string) => {
  const d = new Date(iso)
  if (d.getHours() === 0 && d.getMinutes() === 0) return '終日'
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

const toLocalDatetime = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type DateRange = 'today_tomorrow' | 'past' | 'all'

// 「すべて」は件数が青天井なので上限を置いている。
// 超えた分が黙って消えると古いアポを探しているときに気づけないので、
// 上限に達したことは画面に出す。
const ALL_LIMIT = 500

export default function AppointmentsPage() {
  const { data: session } = useSession()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState<DateRange>('today_tomorrow')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ title: '', startAt: '', endAt: '' })
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const today = dateKey(new Date())
  const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = dateKey(tomorrowDate)

  // ページ開いたら自動でカレンダー同期
  useEffect(() => {
    const sync = async () => {
      setSyncing(true)
      try { await fetch('/api/calendar/sync', { method: 'POST' }) } catch { /* ignore */ }
      setSyncing(false)
    }
    sync()
  }, [])

  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      let query = supabase
        .from('appointments')
        .select('id, title, start_at, end_at, created_by, company_id, google_event_id, companies(id, name)')
        .order('start_at', { ascending: false })

      if (dateRange === 'today_tomorrow') {
        query = query.gte('start_at', today + 'T00:00:00').lte('start_at', tomorrow + 'T23:59:59')
      } else if (dateRange === 'past') {
        const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
        query = query.gte('start_at', oneYearAgo.toISOString()).lt('start_at', today + 'T00:00:00')
      } else {
        query = query.limit(ALL_LIMIT)
      }

      const { data } = await query
      if (data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const typed = (data as any[]).map(a => ({ ...a, companies: Array.isArray(a.companies) ? a.companies[0] ?? null : a.companies })) as Appointment[]
        setAppointments(typed)
      }
      setLoading(false)
    }
    fetch()
  }, [dateRange, today, tomorrow])

  const startEdit = (a: Appointment) => {
    setEditingId(a.id)
    setEditForm({
      title: a.title,
      startAt: toLocalDatetime(a.start_at),
      endAt: a.end_at ? toLocalDatetime(a.end_at) : toLocalDatetime(a.start_at),
    })
  }

  const saveEdit = async (a: Appointment) => {
    setSaving(true)
    const startIso = new Date(editForm.startAt).toISOString()
    const endIso = new Date(editForm.endAt).toISOString()
    const res = await fetch('/api/calendar/events', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appointmentId: a.id,
        googleEventId: a.google_event_id,
        title: editForm.title,
        startAt: startIso,
        endAt: endIso,
      }),
    })
    if (res.ok) {
      setAppointments(prev => prev.map(apt =>
        apt.id === a.id ? { ...apt, title: editForm.title, start_at: startIso, end_at: endIso } : apt
      ))
      setEditingId(null)
    }
    setSaving(false)
  }

  const filtered = appointments

  const grouped = filtered.reduce<Record<string, Appointment[]>>((acc, a) => {
    const key = a.start_at.slice(0, 10)
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  const renderAptList = (items: Appointment[]) => (
    <>
      {items.length === 0 ? (
        <p className="text-xs text-slate-300 px-4 py-5 text-center">なし</p>
      ) : items.map((a, i) => (
        <div key={a.id} className={`px-4 py-3 ${i !== 0 ? 'border-t border-slate-100' : ''}`}>
          {editingId === a.id ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editForm.title}
                onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="タイトル"
              />
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  type="datetime-local"
                  value={editForm.startAt}
                  onChange={e => setEditForm(f => ({ ...f, startAt: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-400">〜</span>
                <input
                  type="datetime-local"
                  value={editForm.endAt}
                  onChange={e => setEditForm(f => ({ ...f, endAt: e.target.value }))}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => saveEdit(a)}
                  disabled={saving || !editForm.title}
                  className="tap-target text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-40"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="tap-target text-xs text-slate-500 hover:text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg transition"
                >
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <div className="text-xs text-blue-600 font-medium shrink-0 w-10 mt-0.5">
                {formatTime(a.start_at)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{a.title || '（タイトルなし）'}</p>
                {a.companies ? (
                  <Link href={`/companies/${a.companies.id}`} className="text-xs text-blue-500 hover:underline truncate block">
                    {a.companies.name}
                  </Link>
                ) : (
                  <span className="text-xs text-slate-300">顧客未設定</span>
                )}
                {a.end_at && (
                  <p className="text-xs text-slate-400">〜{formatTime(a.end_at)}</p>
                )}
              </div>
              {a.created_by === session?.user?.email && (
                <button onClick={() => startEdit(a)} className="text-slate-300 hover:text-blue-500 transition shrink-0 mt-0.5">
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  )

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">アポ一覧</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            {filtered.length}件
            {dateRange === 'all' && appointments.length >= ALL_LIMIT && ` · 最新${ALL_LIMIT}件のみ表示`}
            {syncing && ' · 同期中...'}
          </p>
        </div>
        <div className="flex gap-1">
          {([['today_tomorrow','今日・明日'],['past','過去'],['all','すべて']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setDateRange(val)}
              className={`tap-target text-xs px-3 py-1.5 rounded-lg transition ${dateRange === val ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-sm text-slate-400">読み込み中...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          アポはありません
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, items]) => {
              const repA = items.filter(a => a.created_by === ACCOUNT_ORDER[0])
              const repB = items.filter(a => a.created_by === ACCOUNT_ORDER[1])
              return (
                <div key={date}>
                  <p className="text-xs font-semibold text-slate-400 mb-2 px-1 flex items-center gap-1.5">
                    <Calendar size={12} />
                    {toLabel(date, today, tomorrow)}
                    <span className="font-normal">{items.length}件</span>
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="premium-card rounded-2xl overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
                        <p className="text-xs font-semibold text-slate-600">{emailToName(ACCOUNT_ORDER[0])}</p>
                      </div>
                      {renderAptList(repA)}
                    </div>
                    <div className="premium-card rounded-2xl overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
                        <p className="text-xs font-semibold text-slate-600">{emailToName(ACCOUNT_ORDER[1])}</p>
                      </div>
                      {renderAptList(repB)}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
