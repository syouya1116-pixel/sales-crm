import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/requireAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// KPI進捗（集計ページの「KPI進捗」セクション）の数字を返す。
//
// 契約目標から逆算した目標値と、実績を突き合わせて返すだけ。
// 計算は全部 DB 側（kpi_progress 関数）でやる。
// SQL は supabase-kpi-targets.sql。SQL Editor で先に流しておくこと。

export type KpiProductRow = {
  rep_id: string
  rep_name: string
  product_id: string
  product_name: string
  target_sends: number
  actual_sends: number
  /**
   * 目標を数え始める日（YYYY-MM-DD）。null は月初から＝今までどおり。
   * 月の途中で目標を足したときだけ入る。実績もこの日以降しか数えない
   */
  start_day?: string | null
  /**
   * 目標のうち、前月までの未消化分として繰り越された通数。
   * 按分せずその月の最初の営業日に全部乗る。
   * supabase-kpi-carry-over.sql を流す前は undefined
   */
  carry_sends?: number
}

export type KpiRepRow = {
  rep_id: string
  rep_name: string
  /** sales_reps.email が未設定だと送信実績が0件で出る。画面で注意を出すため */
  has_email: boolean
  target_sends: number
  actual_sends: number
  target_apts: number
  actual_apts: number
  target_contracts: number
  actual_contracts: number
  /** 目標のうち繰り越し分（商材ぶんの合計）。SQL未実行なら undefined */
  carry_sends?: number
}

export type KpiProgress = {
  /** 期間内の営業日数（土日と祝日を除く）。目標の按分に使った日数をそのまま画面に出す */
  business_days: number
  /**
   * 期間の終端が属する月の営業日数。「3日目 / 20営業日」の分母。
   * supabase-kpi-holidays.sql を流す前は undefined になる
   */
  month_business_days?: number
  /** 期間の終端そのものが営業日か。土日祝に警告バーを出さない判断に使う */
  to_is_business_day?: boolean
  product_rows: KpiProductRow[]
  rep_rows: KpiRepRow[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')

  // 期間なしでは按分できないので必須。形式も見る
  // （そのまま渡すと Postgres 側の date キャストで500になる）
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { error: '期間の指定が不正です' },
      { status: 400 },
    )
  }

  const { data, error: rpcErr } = await supabaseAdmin.rpc('kpi_progress', {
    p_from: from,
    p_to: to,
  })

  if (rpcErr) {
    return NextResponse.json({ error: rpcErr.message }, { status: 500 })
  }

  return NextResponse.json(data as KpiProgress)
}
