import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/requireAdmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { hashPassword } from '@/lib/staffAuth'

// スタッフの有効/無効切り替え・パスワード再発行（管理者のみ）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin()
  if (error) return error

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const updates: Record<string, unknown> = {}

  if (typeof body.active === 'boolean') {
    updates.active = body.active
  }
  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 6) {
      return NextResponse.json({ error: 'パスワードは6文字以上にしてください' }, { status: 400 })
    }
    const { hash, salt } = hashPassword(body.password)
    updates.password_hash = hash
    updates.password_salt = salt
  }
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    updates.display_name = body.displayName.trim()
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: '更新内容がありません' }, { status: 400 })
  }

  const { data, error: dbErr } = await supabaseAdmin
    .from('staff')
    .update(updates)
    .eq('id', id)
    .select('id, login_id, display_name, active, created_at')
    .single()

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })
  return NextResponse.json({ staff: data })
}
