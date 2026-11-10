import { auth } from './auth'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from './supabaseAdmin'

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim())

/**
 * フォーム送信作業をする人（業務委託スタッフ＋山田・鈴木）を通す。
 *
 * requireAuth は ALLOWED_EMAILS の Google ユーザーしか通さないので、
 * スタッフ（Credentials ログイン）から叩くAPIではこちらを使う。
 * 返す workerId は email_logs.sent_by / companies.form_claimed_by に入れるキー。
 */
export async function requireWorker() {
  const session = await auth()
  const id = session?.user?.email
  if (!id) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), workerId: null }
  }

  if (session?.user?.role === 'staff') {
    // 無効化されたスタッフをその場で締め出す（発行済みセッションが残っていても通さない）
    const { data } = await supabaseAdmin
      .from('staff')
      .select('active')
      .eq('login_id', id)
      .maybeSingle()
    if (!data?.active) {
      return { error: NextResponse.json({ error: 'アカウントが無効です' }, { status: 403 }), workerId: null }
    }
    return { error: null, workerId: id }
  }

  if (!allowedEmails.includes(id)) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), workerId: null }
  }
  return { error: null, workerId: id }
}
