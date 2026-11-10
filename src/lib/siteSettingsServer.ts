import { IS_DEMO } from './demo'
import { DEFAULT_SITE_SETTINGS, normalizeSiteSettings, type SiteSettings } from './siteSettings'

export type SiteReps = { id: string; name: string; email: string | null }[]

/** 画面全体に配る設定。デモでなければ DB を見ずに既定値を返す */
export async function loadSiteSettings(): Promise<{ settings: SiteSettings; reps: SiteReps }> {
  if (!IS_DEMO) return { settings: DEFAULT_SITE_SETTINGS, reps: [] }
  try {
    const { supabaseAdmin } = await import('./supabaseAdmin')
    const [s, r] = await Promise.all([
      supabaseAdmin.from('demo_settings').select('value').eq('key', 'site').maybeSingle(),
      supabaseAdmin.from('sales_reps').select('id, name, email'),
    ])
    return { settings: normalizeSiteSettings(s.data?.value), reps: (r.data ?? []) as SiteReps }
  } catch {
    return { settings: DEFAULT_SITE_SETTINGS, reps: [] }
  }
}

export async function saveSiteSettings(settings: SiteSettings) {
  const { supabaseAdmin } = await import('./supabaseAdmin')
  return supabaseAdmin.from('demo_settings')
    .upsert({ key: 'site', value: settings, updated_at: new Date().toISOString() })
}
