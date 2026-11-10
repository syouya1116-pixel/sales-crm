'use client'

import { useState } from 'react'
import { Calendar, Pencil } from 'lucide-react'
import { Appointment } from '@/types'
import { formatDateTime, toLocalDatetimeValue } from '@/lib/formatDateTime'
import { INPUT_CLASS } from '@/lib/formStyles'

type Props = {
  companyId: string
  appointments: Appointment[]
  /** 編集後の即時反映に使う */
  onAppointmentsChange: (updater: (prev: Appointment[]) => Appointment[]) => void
  currentUserEmail: string | null | undefined
  onRefresh: () => void
}

// 5分刻みの時刻候補（00:00〜23:55）
const TIME_OPTIONS = Array.from({ length: 24 * 12 }, (_, i) => {
  const h = Math.floor(i / 12)
  const m = (i % 12) * 5
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

const smallInputClass =
  'border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white/80'

export default function AppointmentSection({
  companyId, appointments, onAppointmentsChange, currentUserEmail, onRefresh,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', startAt: '', endAt: '' })
  const [editSaving, setEditSaving] = useState(false)

  // 開始時刻を選んだら終了時刻を1時間後に自動セット
  const handleStartTimeChange = (time: string) => {
    setStartTime(time)
    if (!time) return
    const [h, m] = time.split(':').map(Number)
    const total = h * 60 + m + 60
    setEndTime(`${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`)
  }

  const handleSubmit = async (force = false) => {
    if (!title || !date || !startTime || !endTime) return
    setSaving(true)
    setError(null)
    const startAt = new Date(`${date}T${startTime}:00`).toISOString()
    const endAt = new Date(`${date}T${endTime}:00`).toISOString()
    const res = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId, title, startAt, endAt, force }),
    })
    const data = await res.json()
    if (res.status === 409 && data.conflict) {
      const names = (data.conflictEvents as string[]).join('、')
      if (confirm(`この時間帯にすでに予定があります。\n\n${names}\n\nそれでも登録しますか？`)) {
        setSaving(false)
        handleSubmit(true)
        return
      }
    } else if (data.error) {
      setError(data.error)
    } else {
      setShowForm(false)
      setTitle('')
      setDate('')
      setStartTime('')
      setEndTime('')
      onRefresh()
    }
    setSaving(false)
  }

  const startEdit = (apt: Appointment) => {
    setEditingId(apt.id)
    setEditForm({
      title: apt.title ?? '',
      startAt: apt.start_at ? toLocalDatetimeValue(apt.start_at) : '',
      endAt: apt.end_at
        ? toLocalDatetimeValue(apt.end_at)
        : (apt.start_at ? toLocalDatetimeValue(apt.start_at) : ''),
    })
  }

  const saveEdit = async (apt: Appointment) => {
    setEditSaving(true)
    const startIso = new Date(editForm.startAt).toISOString()
    const endIso = new Date(editForm.endAt).toISOString()
    const res = await fetch('/api/calendar/events', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appointmentId: apt.id,
        googleEventId: apt.google_event_id,
        title: editForm.title,
        startAt: startIso,
        endAt: endIso,
      }),
    })
    if (res.ok) {
      onAppointmentsChange(prev => prev.map(a =>
        a.id === apt.id ? { ...a, title: editForm.title, start_at: startIso, end_at: endIso } : a
      ))
      setEditingId(null)
    }
    setEditSaving(false)
  }

  return (
    <div className="premium-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Calendar size={13} />アポ・カレンダー
        </h2>
        <button
          onClick={() => { setShowForm(!showForm); setError(null) }}
          className="tap-target text-xs text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition"
        >
          + アポを追加
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">タイトル</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="例: 初回商談" className={INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">日付</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">開始時刻</label>
              <select value={startTime} onChange={e => handleStartTimeChange(e.target.value)} className={INPUT_CLASS}>
                <option value="">--:--</option>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">終了時刻</label>
              <select value={endTime} onChange={e => setEndTime(e.target.value)} className={INPUT_CLASS}>
                <option value="">--:--</option>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => handleSubmit()}
              disabled={saving || !title || !date || !startTime || !endTime}
              className="tap-target flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              {saving ? '保存中...' : 'Googleカレンダーに登録'}
            </button>
            <button onClick={() => setShowForm(false)} className="tap-target px-4 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg transition">
              キャンセル
            </button>
          </div>
        </div>
      )}

      {appointments.length === 0 ? (
        <p className="text-sm text-slate-400">アポの記録はありません</p>
      ) : (
        <div className="space-y-2">
          {appointments.map(apt => (
            <div key={apt.id} className="border border-slate-100 rounded-xl p-3 hover:bg-slate-50/50 transition">
              {editingId === apt.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                    className={INPUT_CLASS}
                    placeholder="タイトル"
                  />
                  <div className="flex gap-2 items-center flex-wrap">
                    <input
                      type="datetime-local"
                      value={editForm.startAt}
                      onChange={e => setEditForm(f => ({ ...f, startAt: e.target.value }))}
                      className={smallInputClass}
                    />
                    <span className="text-xs text-slate-400">〜</span>
                    <input
                      type="datetime-local"
                      value={editForm.endAt}
                      onChange={e => setEditForm(f => ({ ...f, endAt: e.target.value }))}
                      className={smallInputClass}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(apt)}
                      disabled={editSaving || !editForm.title}
                      className="tap-target text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition disabled:opacity-40"
                    >
                      {editSaving ? '保存中...' : '保存'}
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
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">{apt.title || '（タイトルなし）'}</span>
                      <span className="text-xs text-slate-400 shrink-0">{apt.start_at ? formatDateTime(apt.start_at) : ''}</span>
                    </div>
                    {apt.end_at && <p className="text-xs text-slate-400 mt-0.5">〜 {formatDateTime(apt.end_at)}</p>}
                  </div>
                  {apt.created_by === currentUserEmail && (
                    <button onClick={() => startEdit(apt)} className="text-slate-300 hover:text-indigo-500 transition shrink-0 mt-0.5">
                      <Pencil size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
