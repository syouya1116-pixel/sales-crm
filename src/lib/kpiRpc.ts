import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { KpiProgress } from '@/app/api/kpi/progress/route'
import type { CarryDaysRow } from '@/app/api/kpi/carry-days/route'
import type { KpiDailyQuotaRow } from '@/lib/kpiDailyQuota'

// KPI関係の RPC をサーバー側で呼ぶ。
// /api/kpi/* の各ルート（画面用・ログイン必須）と、
// /api/report/kpi-daily（n8n の日報用・トークン認証）で同じ形の行を返すために共有する。
// サーバー専用（supabaseAdmin を使う）。クライアントから import しないこと。

// numeric は PostgREST から文字列で返ることがある（精度を落とさないため）。
// そのまま足し算すると文字列連結になるので、ここで数値にしておく
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v) || 0)

type Result<T> = { data: T; error: null } | { data: null; error: string }

export async function rpcKpiProgress(from: string, to: string): Promise<Result<KpiProgress>> {
  const { data, error } = await supabaseAdmin.rpc('kpi_progress', { p_from: from, p_to: to })
  if (error) return { data: null, error: error.message }
  return { data: data as KpiProgress, error: null }
}

type QuotaRaw = {
  q_rid: string
  q_pid: string
  q_base: number | string
  q_quota: number | string
  q_ratio: number | string
  q_apt_target: number | string
  q_apt_left: number | string
  q_bdays_left: number
}

export async function rpcDailyQuota(date: string): Promise<Result<KpiDailyQuotaRow[]>> {
  const { data, error } = await supabaseAdmin.rpc('kpi_daily_quota', { p_date: date })
  if (error) return { data: null, error: error.message }
  const rows = ((data as QuotaRaw[]) ?? []).map(r => ({
    rep_id: r.q_rid,
    product_id: r.q_pid,
    base_sends: num(r.q_base),
    quota_sends: num(r.q_quota),
    ratio: num(r.q_ratio),
    apt_target: num(r.q_apt_target),
    apt_left: num(r.q_apt_left),
    business_days_left: r.q_bdays_left,
  }))
  return { data: rows, error: null }
}

type CarryRaw = {
  d_rid: string
  d_pid: string
  d_day: string
  d_base: number | string
  d_quota: number | string
  d_sent: number
}

export async function rpcCarryDays(date: string): Promise<Result<CarryDaysRow[]>> {
  const { data, error } = await supabaseAdmin.rpc('kpi_carry_days', { p_date: date })
  if (error) return { data: null, error: error.message }
  const rows = ((data as CarryRaw[]) ?? []).map(r => ({
    rep_id: r.d_rid,
    product_id: r.d_pid,
    day: r.d_day,
    base: num(r.d_base),
    quota: num(r.d_quota),
    sent: r.d_sent,
  }))
  return { data: rows, error: null }
}
