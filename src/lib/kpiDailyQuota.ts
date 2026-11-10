// 日次送信ノルマのアポ実績連動。
//
// 月間目標を営業日で割った「基準値」に、アポの進み具合で決まる倍率を掛けて
// その日のノルマを出す。アポが取れていないほど送信ノルマが増える。
//   倍率 = (残アポ ÷ 残営業日) ÷ (月間必要アポ ÷ 月の営業日数)
// 倍率は 1.0 を下回らない（アポが先行していても基準値までは送る）。
//
// 計算は全部 DB 側（kpi_daily_quota 関数）。ここにあるのは
// 「累計の目標のうち、今日のぶんだけを差し替える」ための足し算だけ。
//
// 2026-09 以降だけ効く。8月に当てると残営業日が1日しかなく、
// 8/31 のノルマが 1000通超になってしまうため（SQL 側で止めている）。

/** kpi_daily_quota の1行。担当者×商材ごと */
export type KpiDailyQuotaRow = {
  rep_id: string
  product_id: string
  /** 月初按分の基準値（その日が営業日でなければ0） */
  base_sends: number
  /** アポ連動を掛けたあとのその日のノルマ */
  quota_sends: number
  /** 掛けた倍率。1 なら今までどおり */
  ratio: number
  /** 月間必要アポ（担当者ぶんの合計。商材別ではない） */
  apt_target: number
  /** 残アポ。当月内に実施予定の確定アポは未来のぶんも引いてある */
  apt_left: number
  /** その日を含む月末までの営業日数 */
  business_days_left: number
}

export function quotaKey(repId: string, productId: string) {
  return `${repId}:${productId}`
}

export function quotaMap(rows: KpiDailyQuotaRow[] | null | undefined) {
  const m = new Map<string, KpiDailyQuotaRow>()
  for (const r of rows ?? []) m.set(quotaKey(r.rep_id, r.product_id), r)
  return m
}

/**
 * 月初からの累計目標のうち、今日のぶんだけをアポ連動の値に差し替える。
 * 前日までのぶんはそのまま（あとから遡って増減させない）。
 * 繰り越し分は基準値に含まれていないので、掛け算の外で素通しになる。
 */
export function adjustCumulativeTarget(target: number, q?: KpiDailyQuotaRow) {
  if (!q) return target
  return Math.max(0, target - q.base_sends + q.quota_sends)
}

/** 今日のぶんの増減（＋なら上乗せ）。0 なら表示しない */
export function quotaDelta(q?: KpiDailyQuotaRow) {
  if (!q) return 0
  return Math.round(q.quota_sends - q.base_sends)
}

/**
 * その枠の時点で届いていてほしい累計。
 * 前日までのぶんは満額で、今日のぶんにだけ pace を掛ける。
 * todayPortion はアポ連動後の「今日のノルマ」を渡す。
 */
export function pacedTarget(target: number, todayPortion: number, pace: number) {
  return target - todayPortion * (1 - pace)
}

/**
 * 累計目標から今日のぶんを取り出す。
 * アポ連動が効いていればその値、無ければ営業日数で割った按分値。
 */
export function todayPortionOf(target: number, dayNo: number, q?: KpiDailyQuotaRow) {
  if (q) return q.quota_sends
  if (dayNo <= 0) return target
  return target / dayNo
}
