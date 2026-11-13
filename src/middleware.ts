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

// 11/13〜 デモは「画面のモック」（public/mock/ の静的ページ）だけを見せる。Supabase もログインも使わない。
// 元の動くデモに戻すときは、この MOCK_PAGES の分岐を外す（ほかの作りはそのまま残してある）
const MOCK_PAGES: Record<string, string> = {
  '/': 'index', '/bulk-send': 'bulk-send', '/tasks': 'tasks', '/appointments': 'appointments', '/analytics': 'analytics',
  '/sales-board': 'sales-board', '/import': 'import', '/memos': 'memos', '/settings': 'settings',
}
function mockResponse(req: Request & { nextUrl: URL }) {
  const p = req.nextUrl.pathname.replace(/\/+$/, '') || '/'
  if (p.startsWith('/mock/')) return NextResponse.next()
  if (p.startsWith('/api/')) return NextResponse.json({ error: 'このデモは画面のモックのため、操作はできません' }, { status: 404 })
  const name = p.startsWith('/companies/') ? 'company' : MOCK_PAGES[p]
  if (!name) return NextResponse.redirect(new URL('/', req.nextUrl))
  return NextResponse.rewrite(new URL(`/mock/${name}.html`, req.nextUrl))
}

export default auth((req) => {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') return mockResponse(req)
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
