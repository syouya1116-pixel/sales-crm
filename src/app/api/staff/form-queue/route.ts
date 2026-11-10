import { NextRequest, NextResponse } from 'next/server'
import { requireWorker } from '@/lib/requireWorker'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sortContacts } from '@/lib/contactFields'

// ── 調整用の定数 ──────────────────────────────────────────────
/** 一度に取り置く件数 */
const CLAIM_BATCH = 10
/** 取り置きの有効時間（分）。放置されたらこの時間でプールに戻る */
const CLAIM_EXPIRY_MIN = 60
/** 候補を探すときの1ページ件数と、最大何ページまで遡るか */
const SCAN_PAGE = 300
const SCAN_MAX_PAGES = 10
// ─────────────────────────────────────────────────────────────

const FORM_STATUS = 'フォーム'
const SENT_STATUS = '送信済'
/** 対象にする提案商材。商材Bなど他商材のリストは拾わない */
const TARGET_PRODUCT = 'Instagram'

const COMPANY_SELECT =
  'id, name, representative_name, service_name, genre, sales_reps(name), company_urls(id, url, label, sort_order)'

type CompanyRow = {
  id: string
  name: string | null
  representative_name: string | null
  service_name: string | null
  genre: string | null
  sales_reps: { name: string } | null
  company_urls: { id: string; url: string; label: string | null; sort_order: number | null }[]
}

function expiryIso() {
  return new Date(Date.now() - CLAIM_EXPIRY_MIN * 60_000).toISOString()
}

async function getStatusId(name: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('statuses').select('id').eq('name', name).maybeSingle()
  return data?.id ?? null
}

async function getProductId(name: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('proposal_products').select('id').eq('name', name).maybeSingle()
  return data?.id ?? null
}

/**
 * 渡した候補のうち、対象商材（Instagram）が紐づいているものだけを返す。
 *
 * 逆方向（先に company_proposal_products から Instagram の company_id を全部集める）は
 * 件数が数万になって .in() のURLが長すぎで壊れるため、
 * 「フォームの顧客を少しずつ取って、その分だけ商材を確認する」向きにしている。
 */
async function filterByProduct(candidateIds: string[], productId: string): Promise<Set<string>> {
  const hit = new Set<string>()
  const CHUNK = 200
  for (let i = 0; i < candidateIds.length; i += CHUNK) {
    const { data } = await supabaseAdmin
      .from('company_proposal_products')
      .select('company_id')
      .eq('proposal_product_id', productId)
      .in('company_id', candidateIds.slice(i, i + CHUNK))
    for (const row of data ?? []) hit.add(row.company_id)
  }
  return hit
}

/**
 * 1件だけ条件付きで取り置く。
 * 「まだフォームのまま」かつ「未取得（または期限切れ）」を UPDATE の条件に入れているので、
 * 2人が同時に同じ行を狙っても更新できるのは片方だけ（もう片方は0件更新になる）。
 *
 * Supabase の .or() に ISO タイムスタンプを渡すと PostgREST が壊れるため、
 * 「未取得」と「期限切れ」は1本のクエリにまとめず別々に試す。
 */
async function tryClaim(
  companyId: string,
  statusId: string,
  workerId: string,
  mode: 'unclaimed' | 'expired',
): Promise<boolean> {
  let q = supabaseAdmin
    .from('companies')
    .update({ form_claimed_by: workerId, form_claimed_at: new Date().toISOString() })
    .eq('id', companyId)
    .eq('status_id', statusId)

  q = mode === 'unclaimed'
    ? q.is('form_claimed_by', null)
    : q.lt('form_claimed_at', expiryIso())

  const { data } = await q.select('id')
  return (data?.length ?? 0) > 0
}

/** POST /api/staff/form-queue  { action: 'claim' | 'record' | 'release', ... } */
export async function POST(req: NextRequest) {
  const { error, workerId } = await requireWorker()
  if (error) return error

  const body = await req.json().catch(() => ({}))
  const action = body?.action as string

  const formStatusId = await getStatusId(FORM_STATUS)
  if (!formStatusId) {
    return NextResponse.json({ error: 'ステータス「フォーム」が見つかりません' }, { status: 500 })
  }

  // ── 取り置き ───────────────────────────────────────────────
  if (action === 'claim') {
    const exclude: string[] = Array.isArray(body?.exclude) ? body.exclude : []
    const claimedIds: string[] = []

    const productId = await getProductId(TARGET_PRODUCT)
    if (!productId) {
      return NextResponse.json({ error: `提案商材「${TARGET_PRODUCT}」が見つかりません` }, { status: 500 })
    }

    // 1. 自分が既に取り置き済みで未処理のもの（作業の再開・リロード対策）
    const { data: mine } = await supabaseAdmin
      .from('companies')
      .select('id')
      .eq('status_id', formStatusId)
      .eq('form_claimed_by', workerId)
      .gte('form_claimed_at', expiryIso())
      .order('created_at')
      .limit(CLAIM_BATCH)
    const mineIds = (mine ?? []).map(r => r.id).filter(id => !exclude.includes(id))
    if (mineIds.length > 0) {
      const ok = await filterByProduct(mineIds, productId)
      claimedIds.push(...mineIds.filter(id => ok.has(id)))
    }

    // 2. 足りない分を新しく取り置く（未取得 → 期限切れの順）
    //    フォームの顧客をページごとに見て、Instagram のものだけ取り置く。
    //    取り置いた行は条件から外れて後続ページがずれるが、
    //    1回に取るのは最大 CLAIM_BATCH 件なので影響は小さい（漏れても次回拾える）。
    for (const mode of ['unclaimed', 'expired'] as const) {
      for (let page = 0; page < SCAN_MAX_PAGES; page++) {
        if (claimedIds.length >= CLAIM_BATCH) break

        let q = supabaseAdmin
          .from('companies')
          .select('id')
          .eq('status_id', formStatusId)
          .order('created_at')
          .range(page * SCAN_PAGE, page * SCAN_PAGE + SCAN_PAGE - 1)
        q = mode === 'unclaimed'
          ? q.is('form_claimed_by', null)
          : q.not('form_claimed_by', 'is', null).lt('form_claimed_at', expiryIso())

        const { data: candidates } = await q
        if (!candidates || candidates.length === 0) break

        const targetIds = candidates
          .map(r => r.id)
          .filter(id => !exclude.includes(id) && !claimedIds.includes(id))
        const ok = await filterByProduct(targetIds, productId)

        for (const id of targetIds) {
          if (claimedIds.length >= CLAIM_BATCH) break
          if (!ok.has(id)) continue
          if (await tryClaim(id, formStatusId, workerId, mode)) claimedIds.push(id)
        }

        if (candidates.length < SCAN_PAGE) break
      }
      if (claimedIds.length >= CLAIM_BATCH) break
    }

    // 3. 残っている件数（Instagram × フォーム）。
    //    結合を伴うので失敗しうる。数字が出せないときは null にして画面から隠す。
    let remaining: number | null = null
    try {
      const { count, error: cntErr } = await supabaseAdmin
        .from('company_proposal_products')
        .select('company_id, companies!inner(status_id)', { count: 'exact', head: true })
        .eq('proposal_product_id', productId)
        .eq('companies.status_id', formStatusId)
      if (!cntErr) remaining = count ?? 0
    } catch { /* 件数表示は諦める */ }

    // 4. テンプレートは対象商材のものだけ返す（商材B用を混ぜない）。
    //    商材の紐づけが未設定でも動くよう、名前に「インスタ」が入るものも通す。
    const { data: allTemplates } = await supabaseAdmin
      .from('email_templates')
      .select('id, name, subject, body, proposal_product_id')
      .order('created_at')
    const templates = (allTemplates ?? []).filter(
      t => t.proposal_product_id === productId || t.name.includes('インスタ'),
    )

    if (claimedIds.length === 0) {
      return NextResponse.json({ targets: [], templates, remaining })
    }

    // 5. 取り置いた顧客の中身を返す
    const { data: rows } = await supabaseAdmin
      .from('companies')
      .select(COMPANY_SELECT)
      .in('id', claimedIds)

    const order = new Map(claimedIds.map((id, i) => [id, i]))
    const targets = ((rows ?? []) as unknown as CompanyRow[])
      .map(c => ({
        companyId: c.id,
        companyName: c.name || '',
        representativeName: c.representative_name || '',
        serviceName: c.service_name || '',
        genreName: c.genre || '',
        salesRepName: c.sales_reps?.name || '',
        urls: sortContacts(c.company_urls),
      }))
      .sort((a, b) => (order.get(a.companyId) ?? 0) - (order.get(b.companyId) ?? 0))

    return NextResponse.json({ targets, templates, remaining })
  }

  // ── 送信を記録 ─────────────────────────────────────────────
  if (action === 'record') {
    const companyId = String(body?.companyId || '')
    const subject = String(body?.subject || '') || '（フォーム送信）'
    if (!companyId) return NextResponse.json({ error: 'companyId が必要です' }, { status: 400 })

    const sentStatusId = await getStatusId(SENT_STATUS)
    if (!sentStatusId) {
      return NextResponse.json({ error: 'ステータス「送信済」が見つかりません' }, { status: 500 })
    }

    // 先にステータスを進める。「まだフォームのまま」を条件にしているので、
    // 万一ほかの人と重なっても更新できるのは片方だけ。
    // 更新が通ってから履歴を書くので、送っていない記録が残ることはない。
    const { data: updated } = await supabaseAdmin
      .from('companies')
      .update({ status_id: sentStatusId, form_claimed_by: null, form_claimed_at: null })
      .eq('id', companyId)
      .eq('status_id', formStatusId)
      .select('id')

    if (!updated || updated.length === 0) {
      return NextResponse.json({ ok: false, reason: 'already_sent' })
    }

    // このキューは Instagram の顧客しか流れてこないので、商材はその1つで確定する。
    // マスタから消えていても記録自体は残したいので、見つからなければ null で通す。
    await supabaseAdmin.from('email_logs').insert({
      company_id: companyId,
      subject,
      sent_by: workerId,
      send_type: 'form',
      proposal_product_id: await getProductId(TARGET_PRODUCT),
    })

    return NextResponse.json({ ok: true })
  }

  // ── 取り置きを解放 ─────────────────────────────────────────
  if (action === 'release') {
    const ids: string[] = Array.isArray(body?.companyIds) ? body.companyIds : []
    let q = supabaseAdmin
      .from('companies')
      .update({ form_claimed_by: null, form_claimed_at: null })
      .eq('form_claimed_by', workerId)
      .eq('status_id', formStatusId)
    if (ids.length > 0) q = q.in('id', ids)
    await q
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '不正なリクエストです' }, { status: 400 })
}
