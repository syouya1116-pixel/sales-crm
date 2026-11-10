import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/requireAuth'
import { rpcDailyQuota } from '@/lib/kpiRpc'

// その日の送信ノルマ（アポ実績連動）を担当者×商材ごとに返す。
//
// 月間目標を営業日で割った基準値に、アポの進み具合で決まる倍率を掛けたもの。
// アポが取れていないほどノルマが増える。倍率は1.0を下回らない。
// 計算は全部 DB 側（kpi_daily_quota 関数）。SQL は supabase-kpi-daily-quota.sql。
//
// 2026-09 以降だけ倍率が効く。それ以前の日付は倍率1で返るので、
// 呼び出し側は日付で分岐しなくてよい。
//
// kpi_progress とは分けてある。あちらは期間を渡して按分する関数で、
// こちらは1日ぶんしか意味を持たないため。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const date = req.nextUrl.searchParams.get('date')
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: '日付の指定が不正です' }, { status: 400 })
  }

  const { data: rows, error: rpcErr } = await rpcDailyQuota(date)
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr }, { status: 500 })
  }

  return NextResponse.json({ date, rows })
}
