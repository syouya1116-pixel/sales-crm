import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/requireAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// 集計ページ（/analytics）の数字を返す。
//
// 以前はブラウザから companies / email_logs / appointments を絞り込みなしで
// 全件取得して JS で数えていたが、Supabase の返却行数の上限で打ち切られ、
// 表示されていた数字が全部おかしくなっていた（顧客総数 387 件 vs 実際 4,541 件超）。
// 数えるのは DB 側（analytics_summary 関数）の仕事にして、ここは受け渡すだけ。
//
// SQL は supabase-analytics-rpc.sql。Supabase の SQL Editor で先に流しておくこと。

export type AnalyticsSummary = {
  total_sent: number
  total_form_sent: number
  total_companies: number
  total_replied: number
  total_appointments: number
  total_contracted: number
  total_revenue: number
  account_stats: { account: string; sent: number; replied: number }[]
  status_stats: { name: string; count: number; sort_order: number }[]
  rep_apt_stats: { name: string; count: number }[]
  chart_stats: { label: string; sort_key: number; sent: number }[]
  /** 商材別の送信数。商材で絞っても内訳は全商材ぶん返る（id が null は商材不明） */
  product_stats: { id: string | null; name: string; sent: number }[]
}

const BUCKETS = ['hour', 'dow', 'day', 'month'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const from = req.nextUrl.searchParams.get('from') // ISO or null
  const to = req.nextUrl.searchParams.get('to')     // ISO or null
  const bucketParam = req.nextUrl.searchParams.get('bucket')
  const bucket = (BUCKETS as readonly string[]).includes(bucketParam ?? '')
    ? bucketParam
    : 'month'

  // 商材で絞る。UUID 以外は無視して全商材扱いにする
  // （そのまま渡すと Postgres 側で uuid のキャストに失敗して500になる）
  const productParam = req.nextUrl.searchParams.get('product')
  const productId = productParam && UUID_RE.test(productParam) ? productParam : null

  const { data, error: rpcErr } = await supabaseAdmin.rpc('analytics_summary', {
    p_from: from,
    p_to: to,
    p_bucket: bucket,
    p_product_id: productId,
  })

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 })
  }

  return NextResponse.json(data as AnalyticsSummary)
}
