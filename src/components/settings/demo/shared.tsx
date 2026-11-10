'use client'

import { useState } from 'react'
import { Check, Save } from 'lucide-react'
import { useSiteSettings } from '@/components/SiteSettingsProvider'
import type { SiteSettings } from '@/lib/siteSettings'

export const cmsInput =
  'w-full min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'

export function CmsCard({ id, title, description, children }: {
  id: string; title: string; description?: string; children: React.ReactNode
}) {
  return (
    <section id={id} className="premium-card rounded-2xl p-5 scroll-mt-20">
      <h3 className={`text-sm font-semibold text-slate-700 ${description ? 'mb-1' : 'mb-4'}`}>{title}</h3>
      {description && <p className="text-xs text-slate-400 mb-4 leading-relaxed">{description}</p>}
      {children}
    </section>
  )
}

type SaveState = 'idle' | 'saving' | 'saved' | { error: string }

/** サイト設定（demo_settings）の一部を書き換えて保存する */
export function useSettingsSave() {
  const { settings, save } = useSiteSettings()
  const [state, setState] = useState<SaveState>('idle')
  const run = async (patch: Partial<SiteSettings>) => {
    setState('saving')
    const err = await save({ ...settings, ...patch })
    if (err) { setState({ error: err }); return false }
    setState('saved')
    setTimeout(() => setState('idle'), 2000)
    return true
  }
  return { settings, run, state }
}

export function SaveButton({ state, onClick, disabled, label = '保存する' }: {
  state: SaveState; onClick: () => void; disabled?: boolean; label?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={onClick}
        disabled={disabled || state === 'saving'}
        className="tap-target flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
      >
        <Save size={14} />{state === 'saving' ? '保存中...' : label}
      </button>
      {state === 'saved' && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={13} />保存しました</span>}
      {typeof state === 'object' && <span className="text-xs text-red-500">{state.error}</span>}
    </div>
  )
}

export function MoveButtons({ onUp, onDown, upDisabled, downDisabled }: {
  onUp: () => void; onDown: () => void; upDisabled?: boolean; downDisabled?: boolean
}) {
  return (
    <span className="flex items-center shrink-0">
      <button type="button" onClick={onUp} disabled={upDisabled} aria-label="上へ" className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-1 disabled:opacity-30">▲</button>
      <button type="button" onClick={onDown} disabled={downDisabled} aria-label="下へ" className="text-xs text-slate-400 hover:text-slate-700 px-1.5 py-1 disabled:opacity-30">▼</button>
    </span>
  )
}

export function moveItem<T>(arr: T[], index: number, delta: number): T[] {
  const to = index + delta
  if (to < 0 || to >= arr.length) return arr
  const next = [...arr]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
