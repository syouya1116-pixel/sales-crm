import type { NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import { createSupabaseAccessToken } from './supabaseJwt'
import { IS_DEMO, DEMO_ADMIN_EMAIL, DEMO_ADMIN_NAME } from './demo'

// middleware（Edge Runtime）からも読み込まれる設定。
// Edge では Node の 'crypto' などが使えないため、
// このファイルには Node 依存のもの（staffAuth の scrypt・supabaseAdmin など）を絶対に入れないこと。
// スタッフ用の Credentials プロバイダーは src/lib/auth.ts 側で足している。

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim())

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
    // デモ環境だけ：ワンクリックで架空の管理者としてログインする（src/lib/demo.ts）
    ...(IS_DEMO
      ? [
          Credentials({
            id: 'demo',
            name: 'Demo',
            credentials: {},
            authorize: () => ({ id: DEMO_ADMIN_EMAIL, email: DEMO_ADMIN_EMAIL, name: DEMO_ADMIN_NAME, role: 'google' as const }),
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      // スタッフ（Credentials）は authorize で検証済みなので許可
      if (account?.provider === 'staff') return true
      if (account?.provider === 'demo') return IS_DEMO
      // Google はホワイトリストにないメールはログイン拒否
      return allowedEmails.includes(user.email || '')
    },
    async jwt({ token, account, user }) {
      // スタッフログイン時：role を記録し、Google用トークン処理は一切通さない
      if (account?.provider === 'staff' || user?.role === 'staff') {
        token.role = 'staff'
        return token
      }
      if (token.role === 'staff') return token

      // デモの管理者：Google のトークンを持たないので、更新処理も通さない
      if (account?.provider === 'demo' || token.demo) {
        token.role = 'google'
        token.demo = true
        return token
      }

      token.role = 'google'
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000
      }

      // アクセストークンがまだ有効なら返す
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token
      }

      // 期限切れ → リフレッシュ
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
            grant_type: 'refresh_token',
            refresh_token: token.refreshToken as string,
          }),
        })
        const refreshed = await res.json()
        if (!res.ok) throw refreshed
        return {
          ...token,
          accessToken: refreshed.access_token,
          accessTokenExpires: Date.now() + refreshed.expires_in * 1000,
          refreshToken: refreshed.refresh_token ?? token.refreshToken,
        }
      } catch {
        return { ...token, error: 'RefreshAccessTokenError' }
      }
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string
      if (session.user) {
        session.user.role = (token.role as 'staff' | 'google') ?? 'google'
        if (token.picture) session.user.image = token.picture as string
      }
      // ブラウザの Supabase クライアントが RLS（TO authenticated）を通るためのトークン。
      // SUPABASE_JWT_SECRET が未設定なら undefined のままで、従来どおり anon キーで動く。
      session.supabaseAccessToken =
        (await createSupabaseAccessToken(
          session.user?.email || '',
          session.user?.role ?? 'google',
        )) ?? undefined
      return session
    },
  },
  pages: {
    error: '/login',
  },
} satisfies NextAuthConfig
