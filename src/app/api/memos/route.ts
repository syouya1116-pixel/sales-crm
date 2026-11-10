import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/requireAuth'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const { error, session } = await requireAuth()
  if (error) return error

  const { data } = await supabaseAdmin
    .from('personal_memos')
    .select('id, content, created_at')
    .eq('created_by', session!.user!.email!)
    .order('created_at', { ascending: false })
    .limit(100)

  return NextResponse.json({ memos: data || [] })
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error) return error

  const { content } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: '内容が必要です' }, { status: 400 })

  const { data } = await supabaseAdmin
    .from('personal_memos')
    .insert({ content: content.trim(), created_by: session!.user!.email! })
    .select('id, content, created_at')
    .single()

  return NextResponse.json({ memo: data })
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error) return error

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'idが必要です' }, { status: 400 })

  await supabaseAdmin
    .from('personal_memos')
    .delete()
    .eq('id', id)
    .eq('created_by', session!.user!.email!)

  return NextResponse.json({ ok: true })
}
