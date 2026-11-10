import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/requireAuth'
import { rpcCarryDays } from '@/lib/kpiRpc'
import type { CarryDay } from '@/lib/kpiCarry'

// 繰り越しを日ごとに充てるための材料（2026-10〜）。
//
// 月初から指定日までの、担当者×商材×日ごとの「基準値・ノルマ・送信数」を返す。
// 充て方の計算は画面側（lib/kpiCarry.ts の allocateCarry）。
// SQL は supabase-kpi-carry-daily.sql。未実行なら500になり、
// 呼び出し側は今までの計算（今月ぶんを送り切ってから減る）で表示する。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type CarryDaysRow = CarryDay & { rep_id: string; product_id: string }

export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const date = req.nextUrl.searchParams.get('date')
  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: '日付の指定が不正です' }, { status: 400 })
  }

  const { data: rows, error: rpcErr } = await rpcCarryDays(date)
  if (rpcErr) {
    return NextResponse.json({ error: rpcErr }, { status: 500 })
  }

  return NextResponse.json({ date, rows })
}
