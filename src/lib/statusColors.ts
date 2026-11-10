// ステータスバッジの色。顧客一覧と顧客詳細で別々に定義していて
// 「契約済み」だけ色が食い違っていたため、ここ1か所にまとめている。
export const STATUS_COLORS: Record<string, string> = {
  '未接触':   'bg-slate-100 text-slate-600',
  'フォーム': 'bg-slate-100 text-slate-600',
  '送信予定': 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  '送信済':   'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  '返信あり': 'bg-green-50 text-green-700 ring-1 ring-green-200',
  '商談済':   'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  '案件中':   'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
  '契約済み': 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  '失注':     'bg-slate-100 text-slate-500',
  '禁止':     'bg-red-50 text-red-700 ring-1 ring-red-200',
}

export const statusColor = (name: string): string =>
  STATUS_COLORS[name] || 'bg-slate-100 text-slate-600'
