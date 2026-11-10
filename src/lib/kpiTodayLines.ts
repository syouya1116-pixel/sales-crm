// 警告バー（components/KpiAlertBar.tsx）と、毎朝の日報API（/api/report/kpi-daily）で
// 同じ「本日残り・月間残り・繰越・アポ調整」を出すための計算。
//
// もとは警告バーの中にあった。日報を別に計算すると画面の数字とずれるので、
// ここに切り出して両方から呼ぶ。計算の考え方は KpiAlertBar.tsx の冒頭コメントを参照。

import type { KpiProgress } from '@/app/api/kpi/progress/route'
import { shortDate } from '@/lib/formatDateTime'
import { allocateCarry, carryLeft, groupCarryDays, usesDailyCarry, type CarryDay } from '@/lib/kpiCarry'
import {
  adjustCumulativeTarget, quotaDelta, quotaKey, quotaMap,
  todayPortionOf, type KpiDailyQuotaRow,
} from '@/lib/kpiDailyQuota'

/** 担当者の合計に対する商材ごとの内訳。合計と同じ数え方で出す */
export type ProductLine = {
  key: string
  name: string
  remaining: number
  ahead: number
  monthRemaining: number
  /** 月の途中から数えている場合の起点。'8/25' の形。月全体なら null */
  startLabel: string | null
  /**
   * 前月からの繰り越しのうち、まだ消化できていない通数。0なら出さない。
   * 9月まで：実績はまず今月ぶんの目標に充て、それを超えたぶんから繰り越しを埋める
   * （今月ぶんを送り切るまでは満額のまま動かない）。
   * 10月から：その日のノルマを超えたぶんで減らす（lib/kpiCarry.ts の allocateCarry）
   */
  carry: number
  /** アポ連動で今日のぶんに上乗せされた通数。0なら出さない */
  quotaAdd: number
  /** 今日のぶんのノルマ（アポ連動後）。日報で「今日は何通」と出すために使う */
  todayPortion: number
}

export type Line = {
  key: string
  repName: string
  actual: number
  target: number
  /** 今日までのノルマに対する不足。足りていれば0（＝本日残り） */
  remaining: number
  /** ノルマより先行している分。遅れていれば0 */
  ahead: number
  /** 月末までの目標に対する不足（＝月間残り） */
  monthRemaining: number
  /** 今日のぶんのノルマ。昼の判定でここにだけ pace を掛ける */
  todayPortion: number
  /**
   * 繰り越しの残り（商材ぶんの合計）。2026-10 からの日ごとの充て方のときだけ入る。
   * 本日残りが0でこれが残っていれば carry（琥珀）にする
   */
  carryLeft: number
  /**
   * 商材別の内訳。画面に出す数字はこちらだけで、担当者の合計は出さない。
   * 合算だと「残り240通」がどの商材の遅れなのか読めないため。
   * 合計は色（遅れているかどうか）の判定にだけ使う
   */
  products: ProductLine[]
}

export type Head = {
  month: number
  /** 今月の何営業日目か */
  dayNo: number
  /** 今月の営業日数 */
  monthDays: number
}

export type KpiTodayInput = {
  /** YYYY-MM-DD */
  today: string
  /** kpi_progress(月初, 今日) */
  data: KpiProgress
  /** kpi_progress(月初, 月末) */
  dataMonth: KpiProgress
  /** kpi_daily_quota(今日)。取れなければ null（アポ連動なしで出す） */
  quotaRows: KpiDailyQuotaRow[] | null
  /** kpi_carry_days(今日)。取れなければ null（今までの繰り越し計算で出す） */
  carryRows: (CarryDay & { rep_id: string; product_id: string })[] | null
}

/**
 * 今日の担当者ごとの行を作る。土日祝は null（出さない）。
 * 目標が入っている担当者×商材だけが対象。
 */
export function buildKpiTodayLines(
  { today, data, dataMonth, quotaRows, carryRows }: KpiTodayInput,
): { head: Head; lines: Line[] } | null {
  // 土日祝は出さない。SQL が古くて項目が無いときは営業日扱いにしておく
  if (data.to_is_business_day === false) return null

  const daily = usesDailyCarry(today.slice(0, 7))
  const quota = quotaMap(quotaRows)
  const carryDays = carryRows ? groupCarryDays(carryRows) : null

  // 月間の残り。未来の送信は無いので実績は今日までのものと同じ。
  // 担当者の合計と、商材ごとの内訳の両方を作る
  const monthLeft = new Map<string, number>()
  const monthLeftByProduct = new Map<string, number>()
  for (const p of dataMonth.product_rows) {
    if (p.target_sends <= 0) continue
    const cur = monthLeft.get(p.rep_id) ?? 0
    monthLeft.set(p.rep_id, cur + (p.target_sends - p.actual_sends))
    monthLeftByProduct.set(`${p.rep_id}:${p.product_id}`, p.target_sends - p.actual_sends)
  }

  // 目標が入っている行だけを見て、担当者ごとに合算する
  const byRep = new Map<string, Line>()
  for (const p of data.product_rows) {
    if (p.target_sends <= 0) continue
    const cur = byRep.get(p.rep_id) ?? {
      key: p.rep_id,
      // バーの横幅を詰めるため姓だけ出す（「山田 太郎」→「山田」）
      repName: p.rep_name.split(/[\s　]/)[0] || p.rep_name,
      actual: 0,
      target: 0,
      remaining: 0,
      ahead: 0,
      monthRemaining: 0,
      todayPortion: 0,
      carryLeft: 0,
      products: [],
    }
    const q = quota.get(quotaKey(p.rep_id, p.product_id))
    // 今日のぶんだけアポ連動の値に差し替える
    let target = adjustCumulativeTarget(p.target_sends, q)
    let actual = p.actual_sends
    let todayPortion = todayPortionOf(p.target_sends, data.business_days, q)
    let carry = carryLeft(
      p.carry_sends ?? 0,
      monthLeftByProduct.get(`${p.rep_id}:${p.product_id}`),
    )
    // 2026-10〜：繰り越しを本日ぶんから外し、その日のノルマを超えたぶんで減らす。
    // 材料が取れないとき（SQL未実行）は上の今までの計算のまま
    const days = carryDays?.get(`${p.rep_id}:${p.product_id}`)
    if (daily && (p.carry_sends ?? 0) > 0 && days && days.length > 0) {
      const a = allocateCarry(p.carry_sends ?? 0, days)
      target = a.due
      actual = a.paid
      todayPortion = a.todayQuota
      carry = a.carryLeft
      cur.carryLeft += a.carryLeft
    }
    cur.actual += actual
    cur.target += target
    cur.todayPortion += todayPortion
    cur.products.push({
      key: p.product_id,
      name: p.product_name,
      remaining: Math.max(0, target - actual),
      ahead: Math.max(0, actual - target),
      monthRemaining: Math.max(0, monthLeftByProduct.get(`${p.rep_id}:${p.product_id}`) ?? 0),
      // 途中から数えている商材は集計ページの送信数と一致しない。
      // 起点を添えて、数字がずれて見える理由が分かるようにする
      startLabel: p.start_day ? shortDate(p.start_day) : null,
      // 月初にまとめて乗るぶん。これが無いと数字が急に増えた理由が読めない。
      // 9月までは月間残りで頭打ちにして、10月からは日ごとに充てて「残り」を出す
      carry,
      // アポが足りていない日は今日のぶんが増える。理由を出さないと
      // 「昨日より急にノルマが上がった」が読めない
      quotaAdd: Math.max(0, quotaDelta(q)),
      todayPortion,
    })
    byRep.set(p.rep_id, cur)
  }
  const lines = [...byRep.values()]
    .map(l => ({
      ...l,
      remaining: Math.max(0, l.target - l.actual),
      ahead: Math.max(0, l.actual - l.target),
      monthRemaining: Math.max(0, monthLeft.get(l.key) ?? 0),
      products: [...l.products].sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    }))
    .sort((a, b) => a.repName.localeCompare(b.repName, 'ja'))

  return {
    head: {
      month: Number(today.slice(5, 7)),
      dayNo: data.business_days,
      monthDays: data.month_business_days ?? dataMonth.business_days,
    },
    lines,
  }
}
