import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/requireAdmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { hashPassword } from '@/lib/staffAuth'

// スタッフ一覧（管理者のみ・パスワードは返さない）
export async function GET() {
  const { error } = await requireAdmin()
  if (error) return error

  const { data, error: dbErr } = await supabaseAdmin
    .from('staff')
    .select('id, login_id, display_name, active, created_at')
    .order('created_at', { ascending: false })

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ staff: data ?? [] })
}

// スタッフ新規発行（管理者のみ）
export async function POST(req: NextRequest) {
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const loginId = String(body.loginId || '').trim()
  const displayName = String(body.displayName || '').trim()
  const password = String(body.password || '')

  if (!loginId || !displayName || !password) {
    return NextResponse.json({ error: 'ログインID・表示名・パスワードは必須です' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'パスワードは6文字以上にしてください' }, { status: 400 })
  }

  // 重複チェック
  const { data: existing } = await supabaseAdmin.from('staff').select('id').eq('login_id', loginId).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'このログインIDは既に使われています' }, { status: 409 })
  }

  const { hash, salt } = hashPassword(password)
  const { data, error: dbErr } = await supabaseAdmin
    .from('staff')
    .insert({ login_id: loginId, display_name: displayName, password_hash: hash, password_salt: salt, active: true })
    .select('id, login_id, display_name, active, created_at')
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}
