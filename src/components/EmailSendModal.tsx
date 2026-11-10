'use client'

import { useState } from 'react'
import { CompanyEmail } from '@/types'
import { X, Send } from 'lucide-react'

type Props = {
  companyId: string
  companyEmails: CompanyEmail[]
  onClose: () => void
  onSent: () => void
}

export default function EmailSendModal({ companyId, companyEmails, onClose, onSent }: Props) {
  const [selectedEmailId, setSelectedEmailId] = useState(companyEmails[0]?.id || '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const selectedEmail = companyEmails.find(e => e.id === selectedEmailId)

  const handleSend = async () => {
    if (!subject || !body || !selectedEmail) return
    setSending(true)
    setError('')

    const res = await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId,
        companyEmailId: selectedEmailId,
        toEmail: selectedEmail.email,
        subject,
        body,
      }),
    })

    if (res.ok) {
      onSent()
      onClose()
    } else {
      const data = await res.json()
      setError(data.error || '送信に失敗しました')
    }
    setSending(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">メール送信</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">送信先</label>
            <select
              value={selectedEmailId}
              onChange={e => setSelectedEmailId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {companyEmails.map(e => (
                <option key={e.id} value={e.id}>
                  {e.email}{e.label ? ` (${e.label})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">件名</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="件名を入力"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">本文</label>
            <textarea
              rows={10}
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
              placeholder="本文を入力"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">
            キャンセル
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !subject || !body}
            className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            <Send size={14} />
            {sending ? '送信中...' : '送信する'}
          </button>
        </div>
      </div>
    </div>
  )
}
