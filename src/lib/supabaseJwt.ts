// NextAuth のセッションから Supabase 互換の JWT を作る。
//
// middleware（Edge Runtime）からも呼ばれるため、Node の 'crypto' は使わず
// Web Crypto だけで HS256 を組み立てている。
// SUPABASE_JWT_SECRET は Supabase ダッシュボードの JWT Secret（サーバー専用・
// NEXT_PUBLIC_ を付けないこと）。未設定なら null を返し、従来どおり anon キーで動く。

const enc = new TextEncoder()

const b64url = (bytes: Uint8Array): string => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlJson = (obj: unknown): string => b64url(enc.encode(JSON.stringify(obj)))

// Supabase の auth.uid() は sub を uuid にキャストするため、
// メールアドレス（スタッフは login_id）から決定的な UUID を作って入れておく。
async function stableUuid(seed: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(seed)))
  const h = Array.from(hash.slice(0, 16), b => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

export const SUPABASE_TOKEN_TTL_SEC = 60 * 60

export async function createSupabaseAccessToken(
  email: string,
  appRole: 'staff' | 'google',
): Promise<string | null> {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret || !email) return null

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: await stableUuid(email),
    email,
    aud: 'authenticated',
    // PostgREST はこの role を見て DB ロールを切り替える。RLS の TO authenticated が効く。
    role: 'authenticated',
    // 自前の権限判定用（RLS から current_setting で参照できる）
    app_role: appRole,
    iat: now,
    exp: now + SUPABASE_TOKEN_TTL_SEC,
  }

  const data = `${b64urlJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlJson(payload)}`
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
  return `${data}.${b64url(sig)}`
}
