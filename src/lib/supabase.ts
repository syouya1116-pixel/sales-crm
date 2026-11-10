import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// ブラウザ専用のクライアント。
//
// anon キーはブラウザに配信される＝誰でも入手できるため、RLS では anon に何も
// 許可していない。代わりに NextAuth が発行した Supabase 互換 JWT（role:
// authenticated）を毎回のリクエストに添えることで、ログイン済みの利用者だけが
// DB に触れるようにしている。
//
// サーバー側（API Route / Server Component）からはこれを使わず、
// service_role を持つ supabaseAdmin を使うこと。

// トークンは1時間有効。5分手前で取り直す。
const TOKEN_CACHE_MS = 55 * 60 * 1000

let cached: { token: string; expiresAt: number } | null = null
let inflight: Promise<string | null> | null = null

async function fetchSupabaseToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/session')
    if (!res.ok) return null
    const session = await res.json()
    return session?.supabaseAccessToken ?? null
  } catch {
    return null
  }
}

async function getAccessToken(): Promise<string> {
  // サーバー側で誤って読み込まれた場合の保険（本来は supabaseAdmin を使う）
  if (typeof window === 'undefined') return supabaseAnonKey

  if (cached && Date.now() < cached.expiresAt) return cached.token

  // 画面表示直後は複数クエリが同時に走るので、セッション取得は1回にまとめる
  inflight ??= fetchSupabaseToken().finally(() => {
    inflight = null
  })
  const token = await inflight

  // 未ログイン、または SUPABASE_JWT_SECRET 未設定のとき
  if (!token) return supabaseAnonKey

  cached = { token, expiresAt: Date.now() + TOKEN_CACHE_MS }
  return token
}

/** ログアウト時など、キャッシュしたトークンを捨てたいときに呼ぶ */
export function clearSupabaseTokenCache(): void {
  cached = null
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: getAccessToken,
})
