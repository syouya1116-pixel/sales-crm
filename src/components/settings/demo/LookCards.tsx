'use client'

import { useRef, useState } from 'react'
import { ImageUp, RotateCcw } from 'lucide-react'
import {
  THEMES, LIST_COLUMNS, MENU_ITEMS, DEFAULT_SITE_SETTINGS,
  type ThemeKey, type AnnouncementTone, type SiteSettings,
} from '@/lib/siteSettings'
import { CmsCard, SaveButton, MoveButtons, moveItem, useSettingsSave, cmsInput } from './shared'

// 画像を 128px 四方の PNG に縮めて data URL にする（DB に JSON で持つため小さくする）
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('画像を読み込めませんでした'))
      i.src = url
    })
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const scale = Math.min(size / img.width, size / img.height)
    const w = img.width * scale, h = img.height * scale
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 1. 会社名・システム名・ロゴ・テーマカラー */
export function SiteInfoCard() {
  const { settings, run, state } = useSettingsSave()
  const [companyName, setCompanyName] = useState(settings.companyName)
  const [systemName, setSystemName] = useState(settings.systemName)
  const [logo, setLogo] = useState(settings.logoDataUrl)
  const [theme, setTheme] = useState<ThemeKey>(settings.theme)
  const [logoError, setLogoError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setLogoError('')
    if (!file.type.startsWith('image/')) { setLogoError('画像ファイルを選んでください'); return }
    try { setLogo(await shrinkImage(file)) } catch (e) { setLogoError((e as Error).message) }
  }

  return (
    <CmsCard id="cms-site" title="サイト情報" description="サイドバー・スマホのヘッダー・ログイン画面・タブの題名に出ます。テーマカラーはボタンや選択中のメニューの色です。">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-[#0f172a] p-2 shrink-0 ring-1 ring-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo || '/logo.svg'} alt="ロゴ" className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-50">
              <ImageUp size={13} />ロゴを変更
            </button>
            {logo && (
              <button type="button" onClick={() => setLogo(null)} className="flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-50">
                <RotateCcw size={13} />標準に戻す
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        </div>
        {logoError && <p className="text-xs text-red-500">{logoError}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs text-slate-500 mb-1">会社名</span>
            <input value={companyName} maxLength={30} onChange={e => setCompanyName(e.target.value)} className={cmsInput} />
          </label>
          <label className="block">
            <span className="block text-xs text-slate-500 mb-1">システム名</span>
            <input value={systemName} maxLength={30} onChange={e => setSystemName(e.target.value)} className={cmsInput} />
          </label>
        </div>

        <div>
          <span className="block text-xs text-slate-500 mb-2">テーマカラー</span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(THEMES) as ThemeKey[]).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setTheme(k)}
                className={`flex items-center gap-2 text-xs rounded-full border px-3 py-1.5 transition ${theme === k ? 'border-slate-800 text-slate-800 font-medium' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
              >
                <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: THEMES[k].swatch }} />
                {THEMES[k].label}
              </button>
            ))}
          </div>
        </div>

        <SaveButton
          state={state}
          disabled={!companyName.trim() || !systemName.trim()}
          onClick={() => run({ companyName, systemName, logoDataUrl: logo, theme })}
        />
      </div>
    </CmsCard>
  )
}

const TONES: { key: AnnouncementTone; label: string; cls: string }[] = [
  { key: 'info', label: 'お知らせ（青）', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  { key: 'warning', label: '注意（赤）', cls: 'bg-rose-50 text-rose-800 border-rose-200' },
  { key: 'success', label: '良い知らせ（緑）', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
]

/** 9. 全画面の上に出すお知らせ */
export function AnnouncementCard() {
  const { settings, run, state } = useSettingsSave()
  const [a, setA] = useState(settings.announcement)
  const tone = TONES.find(t => t.key === a.tone) ?? TONES[0]
  return (
    <CmsCard id="cms-banner" title="お知らせバナー" description="全画面の上部に1行で出ます。チームへの連絡（締め日・休業日など）に使えます。">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={a.enabled} onChange={e => setA({ ...a, enabled: e.target.checked })} className="accent-indigo-600" />
          バナーを表示する
        </label>
        <input value={a.text} maxLength={200} onChange={e => setA({ ...a, text: e.target.value })} placeholder="例：今月の締めは25日です。送信の記録漏れに注意してください" className={cmsInput} />
        <div className="flex flex-wrap gap-2">
          {TONES.map(t => (
            <button key={t.key} type="button" onClick={() => setA({ ...a, tone: t.key })} className={`text-xs border rounded-full px-3 py-1.5 ${t.cls} ${a.tone === t.key ? 'ring-2 ring-offset-1 ring-slate-400' : 'opacity-70'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div>
          <span className="block text-xs text-slate-400 mb-1">プレビュー</span>
          <div className={`text-xs text-center px-3 py-1.5 border rounded-lg ${tone.cls} ${a.enabled && a.text ? '' : 'opacity-40'}`}>
            {a.text || '（文言が空のときは表示されません）'}
          </div>
        </div>
        <SaveButton state={state} onClick={() => run({ announcement: a })} />
      </div>
    </CmsCard>
  )
}

/** 8. サイドバーのメニューの表示・非表示 */
export function MenuCard() {
  const { settings, run, state } = useSettingsSave()
  const [hidden, setHidden] = useState(settings.hiddenMenus)
  const toggle = (href: string) =>
    setHidden(h => h.includes(href) ? h.filter(x => x !== href) : [...h, href])
  return (
    <CmsCard id="cms-menu" title="メニューの表示" description="使わない画面をサイドバーから隠せます（設定画面は常に表示）。">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-4">
        {MENU_ITEMS.map(m => (
          <label key={m.href} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
            <input type="checkbox" checked={!hidden.includes(m.href)} onChange={() => toggle(m.href)} className="accent-indigo-600" />
            {m.label}
          </label>
        ))}
      </div>
      <SaveButton state={state} onClick={() => run({ hiddenMenus: hidden })} />
    </CmsCard>
  )
}

/** 5. 顧客一覧（PC表示）の列 */
export function ListColumnsCard() {
  const { settings, run, state } = useSettingsSave()
  const [cols, setCols] = useState<SiteSettings['listColumns']>(settings.listColumns)
  return (
    <CmsCard id="cms-columns" title="顧客一覧の列" description="PC表示の顧客一覧に出す列と順番です。会社名は常に左端に出ます。">
      <div className="space-y-1 mb-4">
        <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-400">
          <input type="checkbox" checked disabled className="accent-indigo-600" />
          <span className="flex-1">会社名（固定）</span>
        </div>
        {cols.map((c, i) => (
          <div key={c.key} className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-slate-50">
            <input
              type="checkbox"
              checked={c.visible}
              onChange={e => setCols(cols.map(x => x.key === c.key ? { ...x, visible: e.target.checked } : x))}
              className="accent-indigo-600"
              aria-label={`${LIST_COLUMNS[c.key].label}を表示`}
            />
            <span className={`flex-1 text-sm ${c.visible ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{LIST_COLUMNS[c.key].label}</span>
            <MoveButtons onUp={() => setCols(moveItem(cols, i, -1))} onDown={() => setCols(moveItem(cols, i, 1))} upDisabled={i === 0} downDisabled={i === cols.length - 1} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SaveButton state={state} onClick={() => run({ listColumns: cols })} />
        <button type="button" onClick={() => setCols(DEFAULT_SITE_SETTINGS.listColumns)} className="text-xs text-slate-400 hover:text-slate-600">初期の並びに戻す</button>
      </div>
    </CmsCard>
  )
}
