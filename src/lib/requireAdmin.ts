import { auth } from './auth'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from './supabaseAdmin'

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim())

// admin_users テーブルに登録されたGoogleユーザー（初期値：yamada@）だけ許可
export async function requireAdmin() {
  const session = await auth()
  const email = session?.user?.email
  if (!email || session?.user?.role === 'staff' || !allowedEmails.includes(email)) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), session: null }
  }
  const { data } = await supabaseAdmin.from('admin_users').select('id').eq('email', email).maybeSingle()
  if (!data) {
    return { error: NextResponse.json({ error: '管理者権限が必要です' }, { status: 403 }), session: null }
  }
  return { error: null, session }
}
