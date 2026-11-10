import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/requireAuth'
import { emailToName } from '@/lib/emailToName'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// タイトルから会社名を抽出（例:「【電話】株式会社ABC　内容」→「株式会社ABC」）
function extractCompanyName(title: string): string {
  const s = title.replace(/^【[^】]*】\s*/, '').trim()
  return s.split(/[\s　]/)[0] || ''
}

export async function POST() {
  const { error, session } = await requireAuth()
  if (error) return error
  if (!session?.accessToken) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  const oauth2Client = new google.auth.OAuth2()
  oauth2Client.setCredentials({ access_token: session.accessToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  // JST (UTC+9) で今日の範囲を計算
  const jstOffset = 9 * 60 * 60 * 1000
  const nowUtc = Date.now()
  const jstDate = new Date(nowUtc + jstOffset)
  const y = jstDate.getUTCFullYear()
  const m = jstDate.getUTCMonth()
  const d = jstDate.getUTCDate()
  const timeMin = new Date(Date.UTC(y, m, d, 0, 0, 0) - jstOffset).toISOString()
  const timeMax = new Date(Date.UTC(y, m, d, 23, 59, 59) - jstOffset).toISOString()

  let items: { id?: string | null; summary?: string | null; start?: { dateTime?: string | null; date?: string | null } | null; end?: { dateTime?: string | null; date?: string | null } | null }[] = []
  try {
    const res = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 50,
    })
    items = res.data.items || []
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'カレンダーAPIエラー'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const account = session.user?.email || ''

  // アカウントに対応する sales_rep_id を取得
  const accountName = emailToName(account)
  const { data: repData } = await supabaseAdmin
    .from('sales_reps')
    .select('id')
    .eq('name', accountName)
    .single()
  const salesRepId = repData?.id || null

  // 担当者に紐付く顧客一覧を取得（自動紐付け用・失注/契約済み/禁止は除外）
  let companiesForMatch: { id: string; name: string }[] = []
  if (salesRepId) {
    const { data: statusData } = await supabaseAdmin
      .from('statuses')
      .select('id, name')
      .in('name', ['失注', '契約済み', '禁止'])
    const excludedStatusIds = (statusData || []).map(s => s.id)

    let compQuery = supabaseAdmin
      .from('companies')
      .select('id, name')
      .eq('sales_rep_id', salesRepId)
    if (excludedStatusIds.length > 0) {
      compQuery = compQuery.not('status_id', 'in', `(${excludedStatusIds.join(',')})`)
    }
    const { data: compData } = await compQuery
    companiesForMatch = compData || []
  }

  // 削除前に既存の company_id 紐付けを google_event_id をキーに保存
  const { data: existing } = await supabaseAdmin
    .from('appointments')
    .select('google_event_id, company_id')
    .eq('created_by', account)
    .gte('start_at', timeMin)
    .lte('start_at', timeMax)
    .not('company_id', 'is', null)

  const companyIdMap = new Map<string, string>()
  for (const row of (existing || [])) {
    if (row.google_event_id) companyIdMap.set(row.google_event_id, row.company_id)
  }

  await supabaseAdmin
    .from('appointments')
    .delete()
    .eq('created_by', account)
    .gte('start_at', timeMin)
    .lte('start_at', timeMax)

  if (items.length > 0) {
    const rows = items
      .filter(e => e.id && (e.start?.dateTime || e.start?.date))
      .map(e => {
        // 既存の紐付けを優先、なければタイトルから自動紐付けを試みる
        let company_id = (e.id && companyIdMap.get(e.id)) || null
        if (!company_id && e.summary && companiesForMatch.length > 0) {
          const extracted = extractCompanyName(e.summary)
          if (extracted) {
            const matches = companiesForMatch.filter(c => c.name === extracted)
            if (matches.length === 1) company_id = matches[0].id
          }
        }
        return {
          company_id,
          title: e.summary || '（タイトルなし）',
          start_at: e.start?.dateTime || `${e.start?.date}T00:00:00+09:00`,
          end_at: e.end?.dateTime || `${e.end?.date}T00:00:00+09:00`,
          google_event_id: e.id,
          created_by: account,
        }
      })

    const { error: insertError } = await supabaseAdmin.from('appointments').insert(rows)
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ synced: items.length, timeMin, timeMax })
}
