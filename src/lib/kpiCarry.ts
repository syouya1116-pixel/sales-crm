// 繰り越し（前月までの未消化ぶん）の残り通数。
//
// ※ 2026-10 からは下の allocateCarry（その日のノルマを超えたぶんから減る）を使う。
//   このファイル前半の carryLeft は 2026-09 以前の表示用に残してある。
//
// kpi_carry が返す繰り越し額は「前月末に確定した未消化ぶん」なので、
// 今月どれだけ送っても SQL 側の値は動かない。そのままだと
// 「103通」が月末まで貼りついたままで、消化できているのかが読めない。
//
// そこで画面では、実績を
//   1. まず今月ぶんの目標（按分ぶん）に充てる
//   2. それを超えた分から繰り越しを埋める
// という順で当てて、繰り越しの残りを出す。
//
//   繰り越しの残り = min(繰り越し額, 月間残り)
//
// 月間目標には繰り越しが乗っているので（1080 + 103 = 1183）、
// 月間残りが繰り越し額を下回った時点＝今月ぶんを送り切った時点になる。
// そこから先は月間残りがそのまま繰り越しの残りになる。
//
// 例（9月・目標1183通＝今月1080＋繰越103）:
//   実績  620通 → 月間残り563 → 繰り越しの残り 103（まだ動かない）
//   実績 1080通 → 月間残り103 → 繰り越しの残り 103（ここから減り始める）
//   実績 1100通 → 月間残り 83 → 繰り越しの残り  83
//   実績 1183通 → 月間残り  0 → 繰り越しの残り   0
//
// 今月ぶんを先に充てるので、月の前半は数字が動かない。
// 逆順（送ったぶんから先に繰り越しを埋める）にすると初日から減るが、
// 今月ぶんの進捗が実際より遅れて見えるので採らなかった。

/**
 * 繰り越しの残り通数。
 *
 * @param carry      その月に乗った繰り越し額（kpi_prod の carry_sends）
 * @param monthLeft  月間目標に対する残り（月間目標 − 月初からの実績）。
 *                   未設定・取得できないときは undefined を渡す
 * @returns 残り通数。月間残りが取れないときは繰り越し額をそのまま返す
 */
export function carryLeft(carry: number, monthLeft: number | undefined): number {
  if (carry <= 0) return 0
  // 月間ぶんが取れていないときに 0 を返すと「消化済み」に見えてしまう。
  // 減る前の状態（＝満額）を出しておくほうが誤解が少ない
  if (monthLeft === undefined || Number.isNaN(monthLeft)) return carry
  return Math.min(carry, Math.max(0, monthLeft))
}

/** 繰り越しを消化し切ったか。ラベルの出し分けに使う */
export function carryDone(carry: number, monthLeft: number | undefined): boolean {
  return carry > 0 && carryLeft(carry, monthLeft) === 0
}

// ---------------------------------------------------------------
// 2026-10 からの充て方（2026-09-29 合意・案A）
//
// 上の carryLeft は「今月ぶんを全部送り切ってから繰り越しが減る」。
// それだと月末近くまで数字が動かないので、10月からは
//   1. 送った分は、まずその日までのノルマ（今月ぶん）に充てる
//   2. その日のノルマを超えたぶんで繰り越しを減らす
//   3. 一度減った繰り越しは戻さない
// に変える。3 を守るために、月初から1日ずつ順に充てていく。
// 月の合計で計算し直すと、翌日に今月ぶんが足りなくなったとき
// 前日の超過が今月ぶんに回り直して、減ったはずの繰り越しが増えて見えるため。
//
// 繰り越しは「本日のノルマ」から外し、別に「繰越 残り◯通」として出す。
// 繰り越しが残っていても、今日のぶんを送り切っていれば赤にはしない。
// ---------------------------------------------------------------

/** この月（YYYY-MM）から日ごとに充てる。9月以前は上の carryLeft のまま */
export const CARRY_DAILY_FROM = '2026-10'

export function usesDailyCarry(ym: string) {
  return ym >= CARRY_DAILY_FROM
}

/** kpi_carry_days の1日ぶん（担当者×商材×日） */
export type CarryDay = {
  day: string
  /** 月初按分の1日ぶん。営業日でなければ0 */
  base: number
  /** アポ連動を掛けたあとのその日のノルマ。営業日でなければ0 */
  quota: number
  sent: number
}

export type CarryAllocation = {
  /** 繰り越しの残り */
  carryLeft: number
  /** 最終日（＝今日）までに届いていてほしい今月ぶんの累計（繰り越しを含まない） */
  due: number
  /** 実績のうち今月ぶんに充てた累計 */
  paid: number
  /** 最終日のノルマ（アポ連動後） */
  todayQuota: number
}

/**
 * 月初から1日ずつ実績を充てて、繰り越しの残りと今月ぶんの進み具合を出す。
 *
 * その日までに届いていてほしい今月ぶん
 *   = 前日までの基準値の累計 + その日のノルマ（アポ連動後）
 * 前日までを基準値で積むのは、警告バーの累計（adjustCumulativeTarget）と同じ。
 * アポ調整ぶんは当日だけ効き、翌日に持ち越さない。
 *
 * @param carry 月初に乗った繰り越し額
 * @param days  月初から今日までを日付順に。最後の要素を「今日」として扱う
 */
export function allocateCarry(carry: number, days: CarryDay[]): CarryAllocation {
  let left = Math.max(0, carry)
  let baseSum = 0
  let paid = 0
  let due = 0
  let todayQuota = 0
  for (const d of days) {
    due = baseSum + d.quota
    todayQuota = d.quota
    // 今月ぶんの不足に先に充てる
    const toMonth = Math.min(d.sent, Math.max(0, due - paid))
    const rest = d.sent - toMonth
    // その日のノルマを超えたぶんで繰り越しを減らす。残りは先行ぶん
    const toCarry = Math.min(left, rest)
    left -= toCarry
    paid += toMonth + (rest - toCarry)
    baseSum += d.base
  }
  return { carryLeft: left, due, paid, todayQuota }
}

/**
 * kpi_carry_days の行を担当者×商材ごとにまとめる（キーは `担当者:商材`）。
 * 日付順に並べ直しておく（allocateCarry は最後の要素を今日として扱うため）
 */
export function groupCarryDays(
  rows: (CarryDay & { rep_id: string; product_id: string })[] | null | undefined,
) {
  const m = new Map<string, CarryDay[]>()
  for (const r of rows ?? []) {
    const k = `${r.rep_id}:${r.product_id}`
    const list = m.get(k) ?? []
    list.push({ day: r.day, base: r.base, quota: r.quota, sent: r.sent })
    m.set(k, list)
  }
  for (const list of m.values()) list.sort((a, b) => a.day.localeCompare(b.day))
  return m
}
