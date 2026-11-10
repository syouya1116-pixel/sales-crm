import { createHash, timingSafeEqual } from 'node:crypto'

// 合言葉・トークンの比較用。
//   - 比べる時間から一致した文字数を推測されないよう、両方をハッシュにそろえてから比べる
//   - 正解側（環境変数）が未設定・空なら必ず false（設定し忘れで誰でも通る事故を防ぐ）
export function safeEqual(got: unknown, expected: string | undefined): boolean {
  if (typeof got !== 'string' || !got) return false
  if (!expected) return false
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

// ごく簡単な回数制限（同じキーで windowMs の間に max 回まで）。
// サーバーのメモリに持つので、Vercel ではインスタンスごとに数える＝完全ではないが、
// 総当たりを大きく遅らせる目的には足りる。
const hits = new Map<string, { count: number; resetAt: number }>()

export function tooManyAttempts(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  }
  const cur = hits.get(key)
  if (!cur || cur.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  cur.count += 1
  return cur.count > max
}
