import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@/lib/requireAuth'
import { IS_DEMO, demoExternalId } from '@/lib/demo'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error) return error
  if (!IS_DEMO && !session?.accessToken) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  const { companyId, title, startAt, endAt, force } = await req.json()
  if (!companyId || !title || !startAt || !endAt) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
  }

  // Googleカレンダーにイベント作成（デモではカレンダーに触らず、アポだけ保存する）
  const oauth2Client = new google.auth.OAuth2()
  if (!IS_DEMO) oauth2Client.setCredentials({ access_token: session!.accessToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

  // 重複チェック（force=true の場合はスキップ）
  if (!IS_DEMO && !force) {
    const existing = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startAt,
      timeMax: endAt,
      singleEvents: true,
    })
    const conflicts = (existing.data.items || []).filter(e => e.status !== 'cancelled')
    if (conflicts.length > 0) {
      return NextResponse.json({
        conflict: true,
        conflictEvents: conflicts.map(e => e.summary || '（タイトルなし）'),
      }, { status: 409 })
    }
  }

  let googleEventId: string | null = null
  if (IS_DEMO) googleEventId = demoExternalId('event')
  else try {
    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: title,
        start: { dateTime: startAt, timeZone: 'Asia/Tokyo' },
        end: { dateTime: endAt, timeZone: 'Asia/Tokyo' },
      },
    })
    googleEventId = event.data.id ?? null
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'カレンダーAPIエラー'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Supabaseに保存
  const { data, error: insertError } = await supabaseAdmin
    .from('appointments')
    .insert({
      company_id: companyId,
      title,
      start_at: startAt,
      end_at: endAt,
      google_event_id: googleEventId,
      created_by: session.user?.email || '',
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ appointment: data })
}

export async function PUT(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error) return error
  if (!IS_DEMO && !session?.accessToken) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  const { appointmentId, googleEventId, title, startAt, endAt } = await req.json()
  if (!appointmentId || !title || !startAt || !endAt) {
    return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
  }

  // 自分のアポのみ編集可能か確認
  const { data: apt } = await supabaseAdmin
    .from('appointments')
    .select('created_by')
    .eq('id', appointmentId)
    .single()
  if (apt?.created_by !== session.user?.email) {
    return NextResponse.json({ error: '編集権限がありません' }, { status: 403 })
  }

  // Googleカレンダーを更新（google_event_idがある場合のみ。デモでは触らない）
  if (!IS_DEMO && googleEventId) {
    try {
      const oauth2Client = new google.auth.OAuth2()
      oauth2Client.setCredentials({ access_token: session.accessToken })
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
      await calendar.events.patch({
        calendarId: 'primary',
        eventId: googleEventId,
        requestBody: {
          summary: title,
          start: { dateTime: startAt, timeZone: 'Asia/Tokyo' },
          end: { dateTime: endAt, timeZone: 'Asia/Tokyo' },
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'カレンダーAPIエラー'
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // Supabaseを更新
  const { error: updateError } = await supabaseAdmin
    .from('appointments')
    .update({ title, start_at: startAt, end_at: endAt })
    .eq('id', appointmentId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
