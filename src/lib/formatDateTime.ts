const pad = (n: number) => String(n).padStart(2, '0')

/** 2026/07/26 14:30 の形式 */
export function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** input[type=datetime-local] に入れる形式（ローカル時刻） */
export function toLocalDatetimeValue(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * '2026-08-25' → '8/25'
 * new Date() を通さないのは、日付だけの文字列がUTCとして解釈されて
 * 前日にずれるため
 */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 秒数を「3分20秒」の形式に。0 / null は空文字 */
export function formatDuration(sec: number | null): string {
  if (!sec) return ''
  return `${Math.floor(sec / 60)}分${sec % 60}秒`
}
