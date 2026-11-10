import { NextRequest, NextResponse } from 'next/server'
import { safeEqual, tooManyAttempts } from '@/lib/safeEqual'

// ログイン前の合言葉チェック（ログイン不要で呼べるため、総当たり対策を入れている）
//   - 同じIPから15分に10回まで
//   - 比較は時間差の出ない方法で行い、SITE_PASSWORD 未設定なら誰も通さない
export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  if (tooManyAttempts(`verify-password:${ip}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: '試行回数が多すぎます。しばらくしてからお試しください' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const password = (body as { password?: unknown })?.password

  if (!safeEqual(password, process.env.SITE_PASSWORD)) {
    return NextResponse.json({ error: 'パスワードが違います' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set('site_verified', '1', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30日
    path: '/',
  })
  return res
}
