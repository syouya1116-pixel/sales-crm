'use client'

import { useState } from 'react'
import { Phone, PhoneIncoming, PhoneOutgoing } from 'lucide-react'
import { CallLog } from '@/types'
import CallLogForm from '@/components/CallLogForm'
import { formatDateTime, formatDuration } from '@/lib/formatDateTime'

type Props = {
  companyId: string
  logs: CallLog[]
  onRefresh: () => void
}

export default function CallLogSection({ companyId, logs, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="premium-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Phone size={13} />通話ログ
        </h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="tap-target text-xs text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition"
        >
          + 通話を記録
        </button>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
          <CallLogForm
            companyId={companyId}
            onSuccess={() => { setShowForm(false); onRefresh() }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {logs.length === 0 ? (
        <p className="text-sm text-slate-400">通話ログはありません</p>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="flex items-start gap-3 border border-slate-100 rounded-xl p-3 hover:bg-slate-50/50 transition">
              <div className="mt-0.5 shrink-0">
                {log.direction === 'inbound'
                  ? <PhoneIncoming size={14} className="text-green-500" />
                  : <PhoneOutgoing size={14} className="text-blue-500" />
                }
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs text-slate-500">{log.direction === 'inbound' ? '着信' : '発信'}</span>
                  {log.duration_seconds && <span className="text-xs text-slate-400">{formatDuration(log.duration_seconds)}</span>}
                  <span className="text-xs text-slate-400 ml-auto">{formatDateTime(log.called_at)}</span>
                </div>
                {log.notes && <p className="text-sm text-slate-700 mt-1">{log.notes}</p>}
                {log.logged_by && <p className="text-xs text-slate-400 mt-0.5">記録: {log.logged_by}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
