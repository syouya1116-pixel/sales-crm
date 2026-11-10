import NextAuth from 'next-auth'
import { authConfig } from '@/lib/auth.config'
import { NextResponse } from 'next/server'

// Edge Runtime では Node の 'crypto' が使えないため、
// scrypt を含む src/lib/auth.ts ではなく Edge 安全な auth.config.ts から組み立てる
const { auth } = NextAuth(authConfig)

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim())

// 業務委託スタッフがアクセスできるパス（これ以外は /staff に弾く）
//
// API も明示的に許さないとリダイレクトされて届かない。
// フォーム送信モードが使う /api/staff/form-queue だけを通す。
// /api/staff や /api/staff/[id]（スタッフ発行・無効化）は管理者専用なので
// ここには足さないこと（前方一致で巻き込まないよう完全パスで書いている）。
const STAFF_ALLOWED = ['/staff', '/companies/new', '/api/staff/form-queue']

export default auth((req) => {
  const { nextUrl, auth: session } = req
  const email = session?.user?.email || ''
  const role = session?.user?.role
  const isStaff = role === 'staff'
  const isGoogleUser = !!email && allowedEmails.includes(email)
  const isLoggedIn = isStaff || isGoogleUser

  const isLoginPage = nextUrl.pathname === '/login'
  const isAuthApi = nextUrl.pathname.startsWith('/api/auth')
  // n8n の毎朝の日報。ログインの代わりにルート側でトークンを見る（KPI_REPORT_TOKEN）
  const isReportApi = nextUrl.pathname.startsWith('/api/report/')
  // デモの毎日の初期化。ルート側で CRON_SECRET を見る（デモ以外では 404）
  const isDemoResetApi = nextUrl.pathname === '/api/demo/reset'

  if (isAuthApi || isReportApi || isDemoResetApi) return NextResponse.next()

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', nextUrl))
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL(isStaff ? '/staff' : '/', nextUrl))
  }

  // スタッフは許可パス以外に入れない（自分専用画面へ誘導）
  if (isStaff) {
    const allowed = STAFF_ALLOWED.some(p => nextUrl.pathname === p || nextUrl.pathname.startsWith(p + '/'))
    if (!allowed) {
      return NextResponse.redirect(new URL('/staff', nextUrl))
    }
  }

  return NextResponse.next()
})

export const config = {
  // public/ の画像（ログイン画面のロゴなど）は未ログインでも読めるよう除外する
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
}
