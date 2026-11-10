import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/requireAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// スタッフ別の実績（山田・鈴木が閲覧可）
// - リスト作成数: created_by ごとに、期間内に作成された顧客数
// - フォーム送信数: sent_by ごとに、期間内の send_type='form' の送信数
//   （自分が作ったリストとは限らないので companies ではなく email_logs で数える）
export async function GET(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  const from = req.nextUrl.searchParams.get('from') // ISO or null
  const to = req.nextUrl.searchParams.get('to')     // ISO or null

  const { data: staffList, error: staffErr } = await supabaseAdmin
    .from('staff')
    .select('login_id, display_name, active')
    .order('created_at', { ascending: false })

  if (staffErr) return NextResponse.json({ error: staffErr.message }, { status: 500 })

  const stats = await Promise.all(
    (staffList ?? []).map(async (s) => {
      let q = supabaseAdmin
        .from('companies')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', s.login_id)
      if (from) q = q.gte('created_at', from)
      if (to) q = q.lte('created_at', to)

      let fq = supabaseAdmin
        .from('email_logs')
        .select('id', { count: 'exact', head: true })
        .eq('sent_by', s.login_id)
        .eq('send_type', 'form')
      if (from) fq = fq.gte('sent_at', from)
      if (to) fq = fq.lte('sent_at', to)

      const [{ count }, { count: formCount }] = await Promise.all([q, fq])
      return {
        login_id: s.login_id,
        display_name: s.display_name,
        active: s.active,
        count: count ?? 0,
        formCount: formCount ?? 0,
      }
    })
  )

  // 作成数の多い順（同数ならフォーム送信数の多い順）
  stats.sort((a, b) => b.count - a.count || b.formCount - a.formCount)
  return NextResponse.json({ stats })
}
