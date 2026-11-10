'use client'

import { useState } from 'react'
import { Check, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'

// 設定ページの「ステータス／営業担当／提案商材／ジャンル」は
// 一覧＋削除＋末尾に追加、という同じ形なのでここにまとめている。

export type MasterItem = { id: string; name: string; sort_order?: number }

type Props = {
  title: string
  description?: string
  items: MasterItem[]
  placeholder: string
  saving: boolean
  onAdd: (name: string) => void | Promise<void>
  onDelete: (id: string) => void
  /** 渡すと並べ替えの ▲▼ を表示する */
  onReorder?: (id: string, newOrder: number) => void
  /** 右端に「順N」を出すか */
  showOrderNumber?: boolean
  /** 渡すと名前の変更（鉛筆ボタン）を出す */
  onRename?: (id: string, name: string) => void | Promise<void>
  /** ページ内リンク用 */
  id?: string
}

const inputClass =
  'flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function MasterListCard({
  title, description, items, placeholder, saving, onAdd, onDelete, onReorder, showOrderNumber, onRename, id,
}: Props) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const handleRename = async () => {
    if (!editing || !onRename || !editing.name.trim()) return
    await onRename(editing.id, editing.name.trim())
    setEditing(null)
  }

  const handleAdd = async () => {
    if (!newName.trim()) return
    await onAdd(newName.trim())
    setNewName('')
  }

  return (
    <div id={id} className="premium-card rounded-2xl p-5 scroll-mt-20">
      <h3 className={`text-sm font-semibold text-slate-700 ${description ? 'mb-1' : 'mb-4'}`}>{title}</h3>
      {description && <p className="text-xs text-slate-400 mb-4">{description}</p>}

      <div className="space-y-1 mb-3">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group">
            {onReorder && <GripVertical size={14} className="text-slate-300 shrink-0" />}
            {editing?.id === item.id ? (
              <span className="flex-1 flex items-center gap-1 min-w-0">
                <input
                  autoFocus
                  value={editing.name}
                  onChange={e => setEditing({ id: item.id, name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(null) }}
                  className={inputClass}
                  aria-label="新しい名前"
                />
                <button onClick={handleRename} disabled={saving} aria-label="名前を保存" className="text-emerald-600 p-1 shrink-0"><Check size={15} /></button>
                <button onClick={() => setEditing(null)} aria-label="やめる" className="text-slate-400 p-1 shrink-0"><X size={15} /></button>
              </span>
            ) : (
              <span className="flex-1 min-w-0 text-sm text-slate-700 break-words">{item.name}</span>
            )}
            {onRename && editing?.id !== item.id && (
              <button
                onClick={() => setEditing({ id: item.id, name: item.name })}
                aria-label="名前を変える"
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-blue-500 transition shrink-0"
              >
                <Pencil size={13} />
              </button>
            )}
            {onReorder && (
              <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                <button
                  onClick={() => onReorder(item.id, (item.sort_order ?? 0) - 1)}
                  disabled={(item.sort_order ?? 0) <= 1}
                  className="text-xs text-slate-400 hover:text-slate-600 px-1 disabled:opacity-30"
                >▲</button>
                <button
                  onClick={() => onReorder(item.id, (item.sort_order ?? 0) + 1)}
                  className="text-xs text-slate-400 hover:text-slate-600 px-1"
                >▼</button>
              </div>
            )}
            {showOrderNumber && <span className="text-xs text-slate-300 shrink-0">順{item.sort_order}</span>}
            <button
              onClick={() => onDelete(item.id)}
              className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={placeholder}
          className={inputClass}
        />
        <button
          onClick={handleAdd}
          disabled={saving || !newName.trim()}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40"
        >
          <Plus size={14} />追加
        </button>
      </div>
    </div>
  )
}
