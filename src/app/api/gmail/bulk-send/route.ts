import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireAuth } from '@/lib/requireAuth'
import { emailToName } from '@/lib/emailToName'
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

// 画面側で10件ずつに分けて呼ぶ（1件あたり送信＋1秒待ち）。余裕を見て60秒
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { error, session } = await requireAuth()
  if (error) return error
  if (!IS_DEMO && !session?.accessToken) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  const { targets, proposalProductId } = await req.json()
  // targets: { companyId, companyEmailId, email, subject, body, statusName }[]

  const { data: sentStatus } = await supabaseAdmin.from('statuses').select('id').eq('name', '送信済').single()
  const sentStatusId = sentStatus?.id || null

  const oauth2Client = new google.auth.OAuth2()
  if (!IS_DEMO) oauth2Client.setCredentials({ access_token: session!.accessToken })
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  const results = []
  for (const target of targets) {
    try {
      // デモでは実際には送らず、送ったことにして履歴だけ残す
      let messageId: string | null
      if (IS_DEMO) {
        messageId = demoExternalId('mail')
      } else {
        const raw = makeRawEmail(target.email, target.subject, target.body, session!.user?.email || '')
        const result = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw },
        })
        messageId = result.data.id || null
      }

      await supabaseAdmin.from('email_logs').insert({
        company_id: target.companyId,
        company_email_id: target.companyEmailId || null,
        subject: target.subject,
        sent_by: session.user?.email || null,
        gmail_message_id: messageId,
        // どの商材で送ったかはテンプレートだけが知っている。
        // 紐づいていなければ「不明」のまま残すこと。
        // 顧客の持ち商材から推定すると、別商材で送ったぶんが
        // その顧客の既存商材の実績として数えられてしまう。
        proposal_product_id: proposalProductId || null,
      })

      if (sentStatusId && target.statusName === '送信予定') {
        await supabaseAdmin.from('companies').update({ status_id: sentStatusId }).eq('id', target.companyId)
      }

      if (proposalProductId) {
        await supabaseAdmin.from('company_proposal_products').insert({
          company_id: target.companyId,
          proposal_product_id: proposalProductId,
        })
        // 重複エラーは無視（既にチェック済みの場合）
      }

      results.push({ email: target.email, success: true })

      // Gmailの送信制限対策（1秒待機）。デモは送らないので短く
      await new Promise(r => setTimeout(r, IS_DEMO ? 100 : 1000))
    } catch {
      results.push({ email: target.email, success: false })
    }
  }

  return NextResponse.json({ results })
}
