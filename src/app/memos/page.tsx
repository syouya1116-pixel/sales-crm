'use client'

import { useEffect, useState } from 'react'
import { NotebookPen, Trash2 } from 'lucide-react'

type Memo = {
  id: string
  content: string
  created_at: string
}

const formatDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function MemosPage() {
  const [memos, setMemos] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/memos')
      .then(r => r.json())
      .then(d => { setMemos(d.memos || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const deleteMemo = async (id: string) => {
    if (!confirm('このメモを削除しますか？')) return
    await fetch('/api/memos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setMemos(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <NotebookPen size={18} className="text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">メモ履歴</h2>
        </div>
        <p className="text-sm text-slate-400 mt-0.5">{memos.length}件保存済み</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : memos.length === 0 ? (
        <div className="premium-card rounded-2xl p-10 text-center text-sm text-slate-400">
          保存されたメモはありません
        </div>
      ) : (
        <div className="space-y-3">
          {memos.map(memo => (
            <div key={memo.id} className="premium-card rounded-2xl p-4 group">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-xs text-slate-400">{formatDate(memo.created_at)}</p>
                <button
                  onClick={() => deleteMemo(memo.id)}
                  className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{memo.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
