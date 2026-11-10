import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { kpiCount } from '@/lib/formatKpiCount'
import { usesDailyCarry } from '@/lib/kpiCarry'
import { rpcCarryDays, rpcDailyQuota, rpcKpiProgress } from '@/lib/kpiRpc'
import { buildKpiTodayLines } from '@/lib/kpiTodayLines'

// 毎朝の CRM 日報（n8n が9時に叩いて Slack の CRM監視チャンネルに流す）。
//
// 中身は2つ。
//   前営業日の実績 … 担当者ごとの送信数・アポ数（kpi_progress を1日だけで呼ぶ）
//   今日のノルマ   … 警告バーと同じ計算（lib/kpiTodayLines.ts）。繰越・アポ調整込み
// 画面とずれないよう、ノルマは警告バーと同じ関数で出す。
//
// ログインの代わりに x-report-token ヘッダーで通す（middleware で /api/report を素通しにしている）。
// KPI_REPORT_TOKEN が未設定なら常に401＝止めたいときは Vercel の環境変数を消すだけでよい。
//
// 土日祝は { skip: true } を返す。n8n 側はそのときは送らない。
// ?date=YYYY-MM-DD で日付を指定できる（動作確認用）。省略時は日本時間の今日。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function authorized(req: NextRequest) {
  const expected = process.env.KPI_REPORT_TOKEN
  const got = req.headers.get('x-report-token')
  if (!expected || !got) return false
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 日付文字列を n 日ずらす。サーバーは UTC で動くので、日付だけを UTC で扱う */
function shiftDay(ymd: string, n: number) {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 日本時間の今日 */
function jstToday() {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

/** '10/22（木）' の形 */
function label(ymd: string) {
  const d = new Date(`${ymd}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAYS[d.getUTCDay()]}）`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: '認証エラー' }, { status: 401 })

  const qDate = req.nextUrl.searchParams.get('date')
  if (qDate && !DATE_RE.test(qDate)) {
    return NextResponse.json({ error: '日付の指定が不正です' }, { status: 400 })
  }
  const today = qDate || jstToday()
  const monthStart = `${today.slice(0, 7)}-01`
  const [y, m] = today.split('-').map(Number)
  // 翌月の0日目＝今月の末日
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

  const [prog, progMonth, quota, carry] = await Promise.all([
    rpcKpiProgress(monthStart, today),
    rpcKpiProgress(monthStart, monthEnd),
    rpcDailyQuota(today),
    usesDailyCarry(today.slice(0, 7)) ? rpcCarryDays(today) : null,
  ])
  if (prog.error !== null) return NextResponse.json({ error: prog.error }, { status: 500 })
  if (progMonth.error !== null) return NextResponse.json({ error: progMonth.error }, { status: 500 })

  // 警告バーと同じく、アポ連動・繰り越しの材料が取れなくても止めない
  const built = buildKpiTodayLines({
    today,
    data: prog.data,
    dataMonth: progMonth.data,
    quotaRows: quota.data,
    carryRows: carry?.data ?? null,
  })
  if (!built) return NextResponse.json({ date: today, skip: true })

  // 前営業日を探す（連休明けなら数日さかのぼる）。月をまたいでもよい
  let prevDay: string | null = null
  let prevData = null
  for (let i = 1; i <= 10; i++) {
    const d = shiftDay(today, -i)
    const r = await rpcKpiProgress(d, d)
    if (r.error !== null) return NextResponse.json({ error: r.error }, { status: 500 })
    if (r.data.to_is_business_day !== false) {
      prevDay = d
      prevData = r.data
      break
    }
  }

  const { head, lines } = built
  const out: string[] = []
  out.push(`*CRM日報 ${label(today)}*　${head.month}月 ${head.dayNo}/${head.monthDays}営業日`)

  if (prevDay && prevData) {
    out.push('', `*前営業日 ${label(prevDay)} の実績*`)
    const reps = prevData.rep_rows
      .filter(r => r.target_sends > 0 || r.actual_sends > 0 || r.actual_apts > 0 || r.actual_contracts > 0)
      .sort((a, b) => a.rep_name.localeCompare(b.rep_name, 'ja'))
    if (reps.length === 0) out.push('・実績なし')
    for (const r of reps) {
      const name = r.rep_name.split(/[\s　]/)[0] || r.rep_name
      const parts = [`送信 ${kpiCount(r.actual_sends)}通`, `アポ ${kpiCount(r.actual_apts)}件`]
      if (r.actual_contracts > 0) parts.push(`契約 ${kpiCount(r.actual_contracts)}件`)
      out.push(`・${name}：${parts.join('／')}`)
    }
  }

  out.push('', '*今日のノルマ*（本日＝今日中に送る残り）')
  if (lines.length === 0) out.push('・目標が設定されていません')
  for (const l of lines) {
    out.push(`・${l.repName}`)
    for (const p of l.products) {
      const notes: string[] = []
      if (p.quotaAdd > 0) notes.push(`アポ調整+${kpiCount(p.quotaAdd)}`)
      if (p.carry > 0) notes.push(`繰越残り${kpiCount(p.carry)}`)
      if (p.ahead > 0) notes.push(`先行+${kpiCount(p.ahead)}`)
      out.push(
        `　${p.name}${p.startLabel ? `（${p.startLabel}〜）` : ''}：本日 ${kpiCount(p.remaining)}通`
        + `${notes.length ? `（${notes.join('・')}）` : ''}　月間残り ${kpiCount(p.monthRemaining)}通`,
      )
    }
  }

  return NextResponse.json({ date: today, skip: false, text: out.join('\n'), head, lines })
}
