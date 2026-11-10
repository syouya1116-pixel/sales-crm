import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { IS_DEMO } from '@/lib/demo'
import { resetDemoData } from '@/lib/demoSeed'

// デモのデータを毎日初期化する（Vercel Cron が Authorization: Bearer <CRON_SECRET> を付けて呼ぶ）。
// デモ環境でなければ 404。CRON_SECRET が未設定なら誰も呼べない。
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (!IS_DEMO) return NextResponse.json({ error: 'Not Found' }, { status: 404 })
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: '認証が必要です' }, { status: 401 })
  }
  try {
    const result = await resetDemoData(supabaseAdmin)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '初期化に失敗しました' }, { status: 500 })
  }
}
