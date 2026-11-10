// 画面の見た目・表示項目を設定画面から変えるための設定（デモ環境だけで使う）。
// DB の demo_settings（key='site'）に JSON で1件だけ持ち、無い項目は既定値で埋める。
// デモでないときは常に既定値＝今までと同じ表示になる。

export const THEMES = {
  indigo: { label: 'インディゴ（標準）', swatch: '#4f46e5', shades: null },
  sky: { label: 'スカイ', swatch: '#0284c7', shades: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e'] },
  teal: { label: 'ティール', swatch: '#0d9488', shades: ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a'] },
  emerald: { label: 'エメラルド', swatch: '#059669', shades: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b'] },
  violet: { label: 'バイオレット', swatch: '#7c3aed', shades: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95'] },
  rose: { label: 'ローズ', swatch: '#e11d48', shades: ['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337'] },
  orange: { label: 'オレンジ', swatch: '#ea580c', shades: ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12'] },
} as const
export type ThemeKey = keyof typeof THEMES

const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]

// Tailwind 4 は bg-indigo-600 などを var(--color-indigo-600) で描くので、
// 変数を差し替えるだけで画面全体のアクセント色（indigo と blue）が切り替わる
export function themeCss(theme: ThemeKey): string {
  const shades = THEMES[theme]?.shades
  if (!shades) return ''
  const vars = SHADE_STEPS.flatMap((s, i) => [`--color-indigo-${s}:${shades[i]}`, `--color-blue-${s}:${shades[i]}`])
  return `:root{${vars.join(';')}}`
}

// ステータスバッジの色。Tailwind が拾えるようクラス名はすべて文字列で書く
export const STATUS_COLOR_OPTIONS = {
  slate: { label: 'グレー', cls: 'bg-slate-100 text-slate-600' },
  amber: { label: '黄', cls: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
  sky: { label: '水色', cls: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  green: { label: '緑', cls: 'bg-green-50 text-green-700 ring-1 ring-green-200' },
  violet: { label: '紫', cls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
  orange: { label: 'オレンジ', cls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-200' },
  emerald: { label: 'エメラルド', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  pink: { label: 'ピンク', cls: 'bg-pink-50 text-pink-700 ring-1 ring-pink-200' },
  red: { label: '赤', cls: 'bg-red-50 text-red-700 ring-1 ring-red-200' },
} as const
export type StatusColorKey = keyof typeof STATUS_COLOR_OPTIONS

// 顧客一覧（PC表示）の列。会社名は常に先頭に出す
export const LIST_COLUMNS = {
  status: { label: 'ステータス', width: 120 },
  service: { label: 'サービス名', width: 160 },
  contact: { label: '連絡先', width: 220 },
  rep: { label: '担当', width: 110 },
  lastSent: { label: '最終送信', width: 110 },
  updated: { label: '更新日', width: 100 },
} as const
export type ListColumnKey = keyof typeof LIST_COLUMNS

// サイドバーのメニュー（アイコンは Sidebar 側で持つ）
export const MENU_ITEMS = [
  { href: '/', label: '顧客一覧' },
  { href: '/bulk-send', label: '一斉送信' },
  { href: '/tasks', label: 'タスク管理' },
  { href: '/appointments', label: 'アポ一覧' },
  { href: '/analytics', label: '集計' },
  { href: '/sales-board', label: '売上ボード' },
  { href: '/import', label: 'CSVインポート' },
  { href: '/memos', label: 'メモ' },
] as const

export const TEAM_COLOR_OPTIONS = ['#4f46e5', '#0284c7', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#e11d48', '#9333ea', '#475569']

export type AnnouncementTone = 'info' | 'warning' | 'success'

export type SiteSettings = {
  companyName: string
  systemName: string
  /** 小さく縮めた PNG の data URL。null なら標準のロゴ */
  logoDataUrl: string | null
  theme: ThemeKey
  /** ステータス名 → 色 */
  statusColors: Record<string, StatusColorKey>
  /** 営業担当ID → 色 */
  teamColors: Record<string, string>
  /** 営業担当IDの並び順 */
  teamOrder: string[]
  listColumns: { key: ListColumnKey; visible: boolean }[]
  hiddenMenus: string[]
  announcement: { enabled: boolean; text: string; tone: AnnouncementTone }
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  companyName: 'さんぷる',
  systemName: 'CRM',
  logoDataUrl: null,
  theme: 'indigo',
  statusColors: {},
  teamColors: {},
  teamOrder: [],
  listColumns: (Object.keys(LIST_COLUMNS) as ListColumnKey[]).map(key => ({ key, visible: true })),
  hiddenMenus: [],
  announcement: { enabled: false, text: '', tone: 'info' },
}

const MAX_LOGO_LENGTH = 200_000

const str = (v: unknown, max: number, fallback: string) =>
  typeof v === 'string' ? v.trim().slice(0, max) : fallback

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** 保存されていた JSON（または送られてきた JSON）を、決まった形に整える */
export function normalizeSiteSettings(raw: unknown): SiteSettings {
  const d = DEFAULT_SITE_SETTINGS
  if (!isRecord(raw)) return d

  const logo = raw.logoDataUrl
  const logoDataUrl = typeof logo === 'string' && logo.startsWith('data:image/') && logo.length <= MAX_LOGO_LENGTH ? logo : null

  const theme = typeof raw.theme === 'string' && raw.theme in THEMES ? raw.theme as ThemeKey : d.theme

  const statusColors: Record<string, StatusColorKey> = {}
  if (isRecord(raw.statusColors)) {
    for (const [name, c] of Object.entries(raw.statusColors)) {
      if (typeof c === 'string' && c in STATUS_COLOR_OPTIONS) statusColors[name.slice(0, 50)] = c as StatusColorKey
    }
  }

  const teamColors: Record<string, string> = {}
  if (isRecord(raw.teamColors)) {
    for (const [id, c] of Object.entries(raw.teamColors)) {
      if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) teamColors[id.slice(0, 40)] = c
    }
  }

  const teamOrder = Array.isArray(raw.teamOrder) ? raw.teamOrder.filter((x): x is string => typeof x === 'string').slice(0, 100) : []

  // 列は既知のキーだけ・重複なし・足りないものは末尾に表示ありで足す
  const seen = new Set<string>()
  const listColumns: SiteSettings['listColumns'] = []
  if (Array.isArray(raw.listColumns)) {
    for (const c of raw.listColumns) {
      if (isRecord(c) && typeof c.key === 'string' && c.key in LIST_COLUMNS && !seen.has(c.key)) {
        seen.add(c.key)
        listColumns.push({ key: c.key as ListColumnKey, visible: c.visible !== false })
      }
    }
  }
  for (const c of d.listColumns) if (!seen.has(c.key)) listColumns.push(c)

  const menuHrefs = new Set<string>(MENU_ITEMS.map(m => m.href))
  const hiddenMenus = Array.isArray(raw.hiddenMenus)
    ? raw.hiddenMenus.filter((h): h is string => typeof h === 'string' && menuHrefs.has(h))
    : []

  const a = isRecord(raw.announcement) ? raw.announcement : {}
  const tone: AnnouncementTone = a.tone === 'warning' || a.tone === 'success' ? a.tone : 'info'

  return {
    companyName: str(raw.companyName, 30, d.companyName) || d.companyName,
    systemName: str(raw.systemName, 30, d.systemName) || d.systemName,
    logoDataUrl,
    theme,
    statusColors,
    teamColors,
    teamOrder,
    listColumns,
    hiddenMenus,
    announcement: { enabled: a.enabled === true, text: str(a.text, 200, ''), tone },
  }
}

/** teamOrder に沿って並べる。並びに無い人は名前順で後ろへ */
export function sortByTeamOrder<T extends { id: string; name: string }>(reps: T[], order: string[]): T[] {
  const pos = new Map(order.map((id, i) => [id, i]))
  return [...reps].sort((a, b) => {
    const pa = pos.get(a.id) ?? Infinity, pb = pos.get(b.id) ?? Infinity
    return pa !== pb ? pa - pb : a.name.localeCompare(b.name, 'ja')
  })
}
