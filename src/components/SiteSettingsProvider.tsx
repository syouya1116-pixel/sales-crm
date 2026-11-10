'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { DEFAULT_SITE_SETTINGS, STATUS_COLOR_OPTIONS, themeCss, type SiteSettings } from '@/lib/siteSettings'
import { setStatusColorOverrides } from '@/lib/statusColors'
import { setNameOverrides } from '@/lib/emailToName'
import type { SiteReps } from '@/lib/siteSettingsServer'

type Ctx = {
  settings: SiteSettings
  /** 保存して画面全体に反映する。失敗したらエラー文を返す */
  save: (next: SiteSettings) => Promise<string | null>
  /** 営業担当の名前を変えたときに、メール→名前の表示を差し替える */
  setReps: (reps: SiteReps) => void
}

const SiteSettingsContext = createContext<Ctx>({
  settings: DEFAULT_SITE_SETTINGS,
  save: async () => 'デモ環境でのみ使えます',
  setReps: () => {},
})

export const useSiteSettings = () => useContext(SiteSettingsContext)

function applyOverrides(settings: SiteSettings, reps: SiteReps) {
  setStatusColorOverrides(Object.fromEntries(
    Object.entries(settings.statusColors).map(([name, key]) => [name, STATUS_COLOR_OPTIONS[key].cls]),
  ))
  setNameOverrides(Object.fromEntries(reps.filter(r => r.email).map(r => [r.email as string, r.name])))
}

export default function SiteSettingsProvider({
  initial, initialReps, children,
}: { initial: SiteSettings; initialReps: SiteReps; children: React.ReactNode }) {
  const [settings, setSettings] = useState(initial)
  const [reps, setRepsState] = useState(initialReps)

  // 子が描画される前に上書きを入れておく（statusColor / emailToName は普通の関数なので）
  applyOverrides(settings, reps)

  const save = useCallback(async (next: SiteSettings) => {
    const res = await fetch('/api/demo/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return json.error || '保存に失敗しました'
    setSettings(json.settings)
    return null
  }, [])

  const css = themeCss(settings.theme)
  return (
    <SiteSettingsContext.Provider value={{ settings, save, setReps: setRepsState }}>
      {css && <style>{css}</style>}
      {children}
    </SiteSettingsContext.Provider>
  )
}
