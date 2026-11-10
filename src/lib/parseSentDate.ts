// CSV取込の「送信日」列を読む。
//
// 素の new Date() を使っていたら、年の無い「1/7」が 2001年1月7日として通ってしまい、
// isNaN() でも弾けずに 2001-01-07 の送信ログが28件できていた（2026-07 に発覚）。
// 受け付ける書式を明示して、読めないものは null を返して取り込まないようにする。
//
// 受け付ける書式:
//   2026-01-07 / 2026/1/7 / 2026.1.7 / 2026年1月7日   … 年あり
//   1/7 / 1-7 / 1.7 / 1月7日                          … 年なし（年を補う）
// うしろに時刻が付いていても日付だけ見る。
//
// 年なしの場合は「取込時点の年」を補い、それだと未来になってしまうときだけ前年にする
// （送信日は過去のはずなので）。

const MIN_YEAR = 1990
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// JSTでの「今日」をUTC基準の年月日として取り出す
function jstToday(now: Date): { y: number; m: number; d: number; ms: number } {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  return {
    y: jst.getUTCFullYear(),
    m: jst.getUTCMonth() + 1,
    d: jst.getUTCDate(),
    ms: Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()),
  }
}

// 存在しない日付（2/30 など）を弾く。Date は勝手に繰り上げてしまうので往復で確認する
function buildUtcDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null
  return dt
}

/**
 * 送信日の文字列を ISO 文字列（その日のUTC 0時）に変換する。
 * 読めない・範囲外なら null。
 */
export function parseSentDate(raw: string | null | undefined, now: Date = new Date()): string | null {
  if (!raw) return null
  const datePart = raw.trim().split(/[T\s]/)[0]?.replace(/\s+/g, '')
  if (!datePart) return null

  const ymd = datePart.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/)
  const md = datePart.match(/^(\d{1,2})[-/.月](\d{1,2})日?$/)

  let year: number | null = null
  let month: number
  let day: number

  if (ymd) {
    year = Number(ymd[1])
    month = Number(ymd[2])
    day = Number(ymd[3])
  } else if (md) {
    month = Number(md[1])
    day = Number(md[2])
  } else {
    return null
  }

  const today = jstToday(now)
  // 未来かどうかの判定は1日ぶん甘くする（時差やCSV作成日のずれを吸収する）
  const latestAllowed = today.ms + 24 * 60 * 60 * 1000

  if (year === null) {
    // 年なし。今年で読んでみて、未来になるなら前年
    const thisYear = buildUtcDate(today.y, month, day)
    if (!thisYear) return null
    if (thisYear.getTime() <= latestAllowed) return thisYear.toISOString()
    const lastYear = buildUtcDate(today.y - 1, month, day)
    return lastYear ? lastYear.toISOString() : null
  }

  const dt = buildUtcDate(year, month, day)
  if (!dt) return null
  if (year < MIN_YEAR) return null
  if (dt.getTime() > latestAllowed) return null
  return dt.toISOString()
}
