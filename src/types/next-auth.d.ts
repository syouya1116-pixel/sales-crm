import 'next-auth'

declare module 'next-auth' {
  interface Session {
    accessToken?: string
    /** ブラウザの Supabase クライアントが RLS を通るための Supabase 互換 JWT */
    supabaseAccessToken?: string
    user?: {
      name?: string | null
      email?: string | null
      image?: string | null
      role?: 'staff' | 'google'
    }
  }
  interface User {
    role?: 'staff' | 'google'
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'staff' | 'google'
    /** デモの管理者ログイン（Google のトークンを持たない） */
    demo?: boolean
  }
}
