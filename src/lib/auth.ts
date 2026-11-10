import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authConfig } from './auth.config'
import { supabaseAdmin } from './supabaseAdmin'
import { verifyPassword } from './staffAuth'

// Node ランタイム用の完全な設定。
// scrypt（Node の crypto）を使うスタッフログインはここにだけ置く。
// middleware は Edge で動くため src/lib/auth.config.ts の方を読み込む。
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    // 業務委託スタッフ用 ID/パスワードログイン（Googleアカウント不要）
    Credentials({
      id: 'staff',
      name: 'Staff',
      credentials: {
        loginId: { label: 'ログインID', type: 'text' },
        password: { label: 'パスワード', type: 'password' },
      },
      async authorize(creds) {
        const loginId = String(creds?.loginId || '').trim()
        const password = String(creds?.password || '')
        if (!loginId || !password) return null

        const { data: staff } = await supabaseAdmin
          .from('staff')
          .select('login_id, display_name, password_hash, password_salt, active')
          .eq('login_id', loginId)
          .maybeSingle()

        if (!staff || !staff.active) return null
        if (!verifyPassword(password, staff.password_hash, staff.password_salt)) return null

        // email には login_id を入れる（companies.created_by と突合するキー）
        return { id: staff.login_id, email: staff.login_id, name: staff.display_name, role: 'staff' as const }
      },
    }),
  ],
})
