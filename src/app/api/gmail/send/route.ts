import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/requireAuth'
import { emailToName } from '@/lib/emailToName'
import { soleProposalProductId } from '@/lib/proposalProductForLog'
import { IS_DEMO, demoExternalId } from '@/lib/demo'

function makeRawEmail(to: string, subject: string, body: string, from: string) {
  const name = emailToName(from)
  const encodedName = `=?UTF-8?B?${Buffer.from(name).toString('base64')}?=`
  const email = [
    `From: ${encodedName} <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body).toString('base64'),
  ].join('\r\n')

  return Buffer.from(email).toString('base64url')
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error) return error
  if (!IS_DEMO && !session?.accessToken) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  const payload = await req.json()
  const { companyId, companyEmailId, toEmail, subject, body } = payload

  // デモでは実際には送らず、送ったことにして履歴だけ残す
  let messageId: string | null
  if (IS_DEMO) {
    messageId = demoExternalId('mail')
  } else {
    const oauth2Client = new google.auth.OAuth2()
    oauth2Client.setCredentials({ access_token: session!.accessToken })
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    const raw = makeRawEmail(toEmail, subject, body, session!.user?.email || '')

    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    })
    messageId = result.data.id || null
  }

  // 送信履歴をSupabaseに保存。
  // 個別送信はテンプレートを介さないので、画面で商材を選んでいればそれを使い、
  // 送ってこなかったときだけ顧客の持ち商材から推定する。
  // キーが無い（＝古い画面・選ばせていない経路）のと、明示的に「商材なし」を
  // 選んだのは別物なので、値ではなくキーの有無で見分ける。
  const proposalProductId = 'proposalProductId' in payload
    ? (payload.proposalProductId || null)
    : await soleProposalProductId(supabaseAdmin, companyId)

  await supabaseAdmin.from('email_logs').insert({
    company_id: companyId,
    company_email_id: companyEmailId || null,
    subject,
    sent_by: session.user?.email || null,
    gmail_message_id: messageId,
    proposal_product_id: proposalProductId,
  })

  return NextResponse.json({ success: true, messageId })
}
