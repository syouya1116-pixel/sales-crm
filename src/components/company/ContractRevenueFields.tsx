'use client'

import { INPUT_CLASS } from '@/lib/formStyles'

// 契約日・売上・キャンセル情報の入力欄。
// 顧客の新規登録（CompanyForm）と編集（顧客詳細）の両方で使う。

export type ContractValues = {
  contracted_at: string
  instagram_revenue: string | number
  line_revenue: string | number
  cancelled_at: string
  cancel_instagram_revenue: string | number
  cancel_line_revenue: string | number
}

type Props = {
  values: ContractValues
  onChange: (patch: Partial<ContractValues>) => void
  /** 顧客詳細ページ用の一回り詰めた余白 */
  compact?: boolean
}

function MoneyInput({
  label, value, onChange, compact,
}: { label: string; value: string | number; onChange: (v: string) => void; compact: boolean }) {
  return (
    <div>
      <label className={`block text-xs mb-1 ${compact ? 'text-slate-400' : 'text-gray-500'}`}>{label}</label>
      <div className="relative">
        <input
          type="number"
          min="0"
          placeholder="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          className={INPUT_CLASS + (compact ? ' pr-7' : ' pr-8')}
        />
        <span className={`absolute ${compact ? 'right-2.5' : 'right-3'} top-1/2 -translate-y-1/2 text-xs text-gray-400`}>円</span>
      </div>
    </div>
  )
}

export default function ContractRevenueFields({ values, onChange, compact = false }: Props) {
  const labelClass = `block text-xs mb-1 ${compact ? 'text-slate-400' : 'text-gray-500'}`
  const headingClass = `text-xs font-semibold ${compact ? 'text-slate-400' : 'text-gray-500'}`

  const remaining =
    (Number(values.instagram_revenue) || 0) - (Number(values.cancel_instagram_revenue) || 0) +
    (Number(values.line_revenue) || 0) - (Number(values.cancel_line_revenue) || 0)
  const hasCancel =
    ((Number(values.cancel_instagram_revenue) || 0) + (Number(values.cancel_line_revenue) || 0)) > 0

  return (
    <div className={compact ? 'space-y-3' : ''}>
      <p className={headingClass + (compact ? '' : ' mb-3')}>契約情報</p>
      <div className={compact ? '' : 'mb-4'}>
        <label className={labelClass}>契約日</label>
        <input
          type="date"
          value={values.contracted_at}
          onChange={e => onChange({ contracted_at: e.target.value })}
          className={INPUT_CLASS}
        />
      </div>

      <p className={headingClass + (compact ? '' : ' mb-3')}>売上（税込）</p>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-2' : 'gap-4'}`}>
        <MoneyInput label="Instagram" value={values.instagram_revenue} onChange={v => onChange({ instagram_revenue: v })} compact={compact} />
        <MoneyInput label="LINE" value={values.line_revenue} onChange={v => onChange({ line_revenue: v })} compact={compact} />
      </div>

      <div className={`border-t border-red-100 ${compact ? 'pt-3 space-y-3' : 'mt-4 pt-4'}`}>
        <p className={`text-xs font-semibold text-red-400 ${compact ? '' : 'mb-3'}`}>キャンセル情報（任意）</p>
        <div className={compact ? '' : 'mb-3'}>
          <label className={labelClass}>キャンセル日</label>
          <input
            type="date"
            value={values.cancelled_at}
            onChange={e => onChange({ cancelled_at: e.target.value })}
            className={INPUT_CLASS}
          />
        </div>
        {!compact && <p className="text-xs font-semibold text-gray-500 mb-2">キャンセル金額（税込）</p>}
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${compact ? 'gap-2' : 'gap-4'}`}>
          <MoneyInput label="Instagram" value={values.cancel_instagram_revenue} onChange={v => onChange({ cancel_instagram_revenue: v })} compact={compact} />
          <MoneyInput label="LINE" value={values.cancel_line_revenue} onChange={v => onChange({ cancel_line_revenue: v })} compact={compact} />
        </div>
        {hasCancel && (
          <p className={`text-xs text-slate-500 ${compact ? '' : 'mt-2'}`}>
            残売上: {remaining.toLocaleString()}円
          </p>
        )}
      </div>
    </div>
  )
}
