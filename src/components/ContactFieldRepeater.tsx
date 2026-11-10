'use client'

import { ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { ContactField, emptyField } from '@/lib/contactFields'

// URL・電話・メールの「値＋ラベル」を増減できる入力欄。
// 顧客の新規登録（CompanyForm）と編集（顧客詳細）で6か所に同じ JSX が並んでいたのをまとめたもの。

type Props = {
  title: ReactNode
  fields: ContactField[]
  onChange: (fields: ContactField[]) => void
  valuePlaceholder: string
  labelPlaceholder?: string
  inputType?: 'text' | 'tel' | 'url' | 'email'
  /** 顧客詳細ページ用の一回り小さい見た目 */
  compact?: boolean
  /** 1行目だけ必須にする（業務委託スタッフの登録フォーム） */
  requiredFirst?: boolean
  /** 見出しと入力欄の間に差し込む内容（スタッフ用チェックボックスなど） */
  children?: ReactNode
}

export default function ContactFieldRepeater({
  title,
  fields,
  onChange,
  valuePlaceholder,
  labelPlaceholder = 'ラベル',
  inputType = 'text',
  compact = false,
  requiredFirst = false,
  children,
}: Props) {
  const base = 'border border-slate-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white/80'
  const sizeClass = compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
  const labelWidth = compact ? 'w-24' : 'w-32'

  const update = (i: number, patch: Partial<ContactField>) => {
    onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  }

  return (
    <div>
      <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-4'}`}>
        {typeof title === 'string' ? (
          compact
            ? <p className="text-xs text-slate-400">{title}</p>
            : <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
        ) : title}
        <button
          type="button"
          onClick={() => onChange([...fields, emptyField()])}
          className={compact
            ? 'text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-0.5'
            : 'text-xs text-blue-600 hover:underline flex items-center gap-1'}
        >
          <Plus size={compact ? 11 : 12} />追加
        </button>
      </div>

      {children}

      {fields.map((f, i) => (
        <div key={i} className={`flex ${compact ? 'gap-1.5 mb-1.5' : 'gap-2 mb-2'}`}>
          <input
            required={requiredFirst && i === 0}
            type={inputType}
            placeholder={valuePlaceholder}
            value={f.value}
            onChange={e => update(i, { value: e.target.value })}
            className={`flex-1 ${base} ${sizeClass}`}
          />
          <input
            type="text"
            placeholder={labelPlaceholder}
            value={f.label}
            onChange={e => update(i, { label: e.target.value })}
            className={`${labelWidth} ${base} ${sizeClass}`}
          />
          {fields.length > 1 && (
            <button
              type="button"
              onClick={() => onChange(fields.filter((_, j) => j !== i))}
              className={compact ? 'text-slate-300 hover:text-red-400' : 'text-gray-400 hover:text-red-500'}
            >
              <X size={compact ? 14 : 16} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
