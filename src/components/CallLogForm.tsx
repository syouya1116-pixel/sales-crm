'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type Props = {
  companyId: string
  onSuccess: () => void
  onCancel: () => void
}

export default function CallLogForm({ companyId, onSuccess, onCancel }: Props) {
  const [form, setForm] = useState({
    direction: 'outbound' as 'inbound' | 'outbound',
    duration_seconds: '',
    notes: '',
    logged_by: '',
    called_at: new Date().toISOString().slice(0, 16),
  })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('call_logs').insert({
      company_id: companyId,
      direction: form.direction,
      duration_seconds: form.duration_seconds ? parseInt(form.duration_seconds) : null,
      notes: form.notes || null,
      logged_by: form.logged_by || null,
      called_at: form.called_at,
    })
    setSaving(false)
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">発着信</label>
          <select
            value={form.direction}
            onChange={e => setForm({ ...form, direction: e.target.value as 'inbound' | 'outbound' })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="outbound">発信</option>
            <option value="inbound">着信</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">通話時間（秒）</label>
          <input
            type="number"
            placeholder="例: 120"
            value={form.duration_seconds}
            onChange={e => setForm({ ...form, duration_seconds: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">日時</label>
          <input
            type="datetime-local"
            value={form.called_at}
            onChange={e => setForm({ ...form, called_at: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">記録者</label>
          <input
            type="text"
            placeholder="名前"
            value={form.logged_by}
            onChange={e => setForm({ ...form, logged_by: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">メモ</label>
        <textarea
          rows={3}
          value={form.notes}
          onChange={e => setForm({ ...form, notes: e.target.value })}
          placeholder="通話内容のメモ..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
          キャンセル
        </button>
        <button
          type="submit"
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
        >
          {saving ? '保存中...' : '記録する'}
        </button>
      </div>
    </form>
  )
}
