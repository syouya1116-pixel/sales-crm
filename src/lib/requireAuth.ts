import { auth } from './auth'
import { NextResponse } from 'next/server'

const allowedEmails = (process.env.ALLOWED_EMAILS || '').split(',').map(e => e.trim())

export async function requireAuth() {
  const session = await auth()
  if (!session?.user?.email || !allowedEmails.includes(session.user.email)) {
    return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }), session: null }
  }
  return { error: null, session }
}
