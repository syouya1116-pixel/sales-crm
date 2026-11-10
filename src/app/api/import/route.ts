import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/requireAuth'
import { createClient } from '@supabase/supabase-js'
import {
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  normalizeCompanyName,
  normalizeCompanyNameStrict,
} from '@/lib/normalize'
import { parseSentDate } from '@/lib/parseSentDate'
import { nameToEmail } from '@/lib/emailToName'

// サービスロールキーで直接アクセス（RLS回避）
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const SALES_REP_ALIAS: Record<string, string> = {
  '山田': '山田 太郎',
  '鈴木': '鈴木 一郎',
}

const STATUS_ALIAS: Record<string, string> = {
  'アポイント': '案件中',
  '対応中': '返信あり',
}


// Supabaseは1クエリ10000件が上限（max_rows）。超えた分はエラーも警告もなく黙って切り捨てられる。
// 全件必要なテーブルはページネーションで取得する（companies 17000件超・company_urls 12000件超のため必須）。
// 上限いっぱいで取ることで往復回数を最小にしている。
const PAGE_SIZE = 10000

const fetchAllColumn = async (table: string, column: string): Promise<string[]> => {
  const out: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await supabaseAdmin.from(table).select(column).range(from, from + PAGE_SIZE - 1)
    if (!data || data.length === 0) break
    out.push(...(data as unknown as Record<string, string>[]).map(r => r[column]).filter(Boolean))
    if (data.length < PAGE_SIZE) break
  }
  return out
}

const fetchAllCompanyNames = async (statusIds?: string[]): Promise<string[]> => {
  const out: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let q = supabaseAdmin.from('companies').select('name').range(from, from + PAGE_SIZE - 1)
    if (statusIds && statusIds.length > 0) q = q.in('status_id', statusIds)
    const { data } = await q
    if (!data || data.length === 0) break
    out.push(...(data as { name: string }[]).map(r => r.name).filter(Boolean))
    if (data.length < PAGE_SIZE) break
  }
  return out
}

// 画面側で100件ずつに分けて呼ぶ。重複チェック用の全件読み込み＋1行ごとに最大6回の書き込みがあるので60秒
export const maxDuration = 60

type CsvRow = {
  url?: string
  status?: string
  name: string
  representative_name?: string
  service_name?: string
  phone?: string
  email?: string
  sent_date?: string
  genre?: string
  other_url?: string
  notes?: string
  sales_rep?: string
  address?: string
  proposal_product?: string
}

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error

  // startIndex はCSV全体での先頭行の位置。スキップ理由に出す行番号をバッチ間で通し番号にするために使う
  const { rows, startIndex = 0 }: { rows: CsvRow[]; startIndex?: number } = await req.json()
  if (!rows?.length) return NextResponse.json({ error: 'データがありません' }, { status: 400 })

  // ステータス・営業担当・CSVエイリアス一覧を取得
  const [{ data: statuses }, { data: salesReps }, { data: aliases }, { data: proposalProducts }] = await Promise.all([
    supabaseAdmin.from('statuses').select('id, name'),
    supabaseAdmin.from('sales_reps').select('id, name'),
    supabaseAdmin.from('csv_column_aliases').select('csv_header, field_key'),
    supabaseAdmin.from('proposal_products').select('id, name'),
  ])

  // エイリアスをrowsに適用（事前にCSVヘッダーを内部キーに変換）
  if (aliases && aliases.length > 0) {
    for (const row of rows as Record<string, string>[]) {
      for (const alias of aliases as { csv_header: string; field_key: string }[]) {
        if (row[alias.csv_header] !== undefined && row[alias.field_key] === undefined) {
          row[alias.field_key] = row[alias.csv_header]
        }
      }
    }
  }
  const statusMap = new Map((statuses || []).map(s => [s.name, s.id]))
  const salesRepMap = new Map((salesReps || []).map(r => [r.name, r.id]))
  const proposalProductMap = new Map((proposalProducts || []).map(p => [p.name, p.id]))

  // 会社名重複チェック対象のステータスID
  const skipStatusNames = ['契約済み', '案件中', '失注']
  const skipStatusIds = skipStatusNames.map(n => statusMap.get(n)).filter(Boolean) as string[]

  let imported = 0
  let skipped = 0
  const skippedRows: { row: number; name: string; reason: string }[] = []

  // DB全件取得（正規化比較のため）※10000件上限を超えるためページネーション必須
  const [existingEmails, existingPhones, existingUrls, strictMatchNames, allCompanyNames] = await Promise.all([
    fetchAllColumn('company_emails', 'email'),
    fetchAllColumn('company_phones', 'phone'),
    fetchAllColumn('company_urls', 'url'),
    // 契約済み・案件中・失注：部分一致で照合（従来どおり厳しめ）
    skipStatusIds.length ? fetchAllCompanyNames(skipStatusIds) : Promise.resolve([]),
    // 全ステータス：完全一致で照合
    fetchAllCompanyNames(),
  ])

  const existingCompanyNames = strictMatchNames
  const existingEmailSet = new Set(existingEmails.map(normalizeEmail))
  const existingPhoneSet = new Set(existingPhones.map(normalizePhone))
  const existingUrlSet = new Set(existingUrls.map(normalizeUrl).filter(Boolean))
  const existingNameSet = new Set(allCompanyNames.map(normalizeCompanyNameStrict).filter(Boolean))

  // CSV内の重複も追跡
  const seenEmails = new Set<string>()
  const seenPhones = new Set<string>()
  const seenNames = new Set<string>()
  const seenUrls = new Set<string>()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = startIndex + i + 2 // ヘッダー行が1行目なのでデータは2行目から

    if (!row.name?.trim()) {
      skipped++
      skippedRows.push({ row: rowNum, name: '（会社名なし）', reason: '会社名が空' })
      continue
    }

    // 会社名の正規化（法人格を除去）
    const rowName = row.name.trim()
    const normalizedRowName = normalizeCompanyName(rowName)

    // 契約済み・案件中・失注で部分一致する会社名が既に存在する場合はスキップ
    const nameMatchDB = existingCompanyNames.some(existing => {
      const normalizedExisting = normalizeCompanyName(existing)
      return normalizedExisting.includes(normalizedRowName) || normalizedRowName.includes(normalizedExisting)
    })
    if (nameMatchDB) {
      skipped++
      skippedRows.push({ row: rowNum, name: rowName, reason: '会社名重複（契約済み・案件中・失注）' })
      continue
    }

    // 全ステータス（送信予定・送信済・フォーム・返信あり・禁止なども含む）で完全一致する会社名はスキップ
    if (existingNameSet.has(normalizeCompanyNameStrict(rowName))) {
      skipped++
      skippedRows.push({ row: rowNum, name: rowName, reason: '会社名重複（全ステータス）' })
      continue
    }

    // CSV内の会社名重複チェック
    if (seenNames.has(normalizedRowName)) {
      skipped++
      skippedRows.push({ row: rowNum, name: rowName, reason: '会社名重複（CSV内）' })
      continue
    }
    seenNames.add(normalizedRowName)

    // ステータスのエイリアス解決
    const rawStatus = row.status?.trim() || ''
    const resolvedStatus = STATUS_ALIAS[rawStatus] || rawStatus

    if (resolvedStatus === '契約済み') {
      skipped++
      skippedRows.push({ row: rowNum, name: row.name.trim(), reason: 'ステータスが契約済' })
      continue
    }

    const email = row.email?.trim() || ''
    const phone = row.phone?.trim() || ''
    const normEmail = normalizeEmail(email)
    const normPhone = normalizePhone(phone)

    // メール or 電話番号がすでに存在する場合はスキップ（正規化比較）
    if (email && (existingEmailSet.has(normEmail) || seenEmails.has(normEmail))) {
      skipped++
      skippedRows.push({ row: rowNum, name: row.name.trim(), reason: `メール重複（${email}）` })
      continue
    }
    if (phone && (existingPhoneSet.has(normPhone) || seenPhones.has(normPhone))) {
      skipped++
      skippedRows.push({ row: rowNum, name: row.name.trim(), reason: `電話番号重複（${phone}）` })
      continue
    }

    // URL重複チェック（HP・その他URLの両方・プロトコル/www/末尾スラッシュ無視）
    const rowUrls = [row.url, row.other_url].map(u => u?.trim() || '').filter(Boolean)
    const dupUrl = rowUrls.find(u => {
      const n = normalizeUrl(u)
      return n && (existingUrlSet.has(n) || seenUrls.has(n))
    })
    if (dupUrl) {
      skipped++
      skippedRows.push({ row: rowNum, name: row.name.trim(), reason: `URL重複（${dupUrl}）` })
      continue
    }

    if (email) seenEmails.add(normEmail)
    if (phone) seenPhones.add(normPhone)
    for (const u of rowUrls) {
      const n = normalizeUrl(u)
      if (n) seenUrls.add(n)
    }

    // ステータスIDを解決
    const statusId = resolvedStatus ? (statusMap.get(resolvedStatus) || null) : null

    // 営業担当IDを解決（「山田」→「山田 太郎」に変換してから照合）
    let salesRepId: string | null = null
    let salesRepEmail: string | null = null
    if (row.sales_rep?.trim()) {
      const repName = SALES_REP_ALIAS[row.sales_rep.trim()] || row.sales_rep.trim()
      salesRepId = salesRepMap.get(repName) || null
      salesRepEmail = nameToEmail(repName)
    }

    // 会社を挿入
    const { data: company, error: companyError } = await supabaseAdmin
      .from('companies')
      .insert({
        name: row.name.trim(),
        status_id: statusId,
        sales_rep_id: salesRepId,
        representative_name: row.representative_name?.trim() || null,
        service_name: row.service_name?.trim() || null,
        genre: row.genre?.trim() || null,
        notes: row.notes?.trim() || null,
        address: row.address?.trim() || null,
      })
      .select('id')
      .single()

    if (companyError || !company) {
      skipped++
      skippedRows.push({ row: rowNum, name: row.name.trim(), reason: 'DB挿入エラー' })
      continue
    }

    const companyId = company.id

    // URL
    const urlInserts = []
    if (row.url?.trim()) urlInserts.push({ company_id: companyId, url: row.url.trim(), label: 'HP', sort_order: 0 })
    if (row.other_url?.trim()) urlInserts.push({ company_id: companyId, url: row.other_url.trim(), label: 'その他', sort_order: 1 })
    if (urlInserts.length) await supabaseAdmin.from('company_urls').insert(urlInserts)

    // 電話番号
    if (phone) {
      await supabaseAdmin.from('company_phones').insert({ company_id: companyId, phone, sort_order: 0 })
    }

    // メールアドレス
    let emailId: string | null = null
    if (email) {
      const { data: emailData } = await supabaseAdmin
        .from('company_emails')
        .insert({ company_id: companyId, email, sort_order: 0 })
        .select('id')
        .single()
      emailId = emailData?.id || null
    }

    // 提案商材。下の送信ログにも同じ商材を残すのでループの外側で受ける
    let proposalProductId: string | null = null
    if (row.proposal_product?.trim()) {
      proposalProductId = proposalProductMap.get(row.proposal_product.trim()) ?? null
      if (proposalProductId) {
        await supabaseAdmin.from('company_proposal_products').insert({ company_id: companyId, proposal_product_id: proposalProductId })
      }
    }

    // 送信日をメール履歴として記録
    //
    // 日付は parseSentDate で読む。以前は new Date() をそのまま使っていたので、
    // 年の無い「1/7」が 2001年1月7日として通ってしまっていた（isNaN では弾けない）。
    // 読めない書式は取り込まない。
    //
    // sent_by は営業担当から引く。以前は入れていなかったため、集計で
    // 「送信者不明」が2,300件以上たまっていた。担当が空なら誰の送信か分からないので
    // NULL のままにする（適当な人を入れると人別の実績が狂う）。
    if (row.sent_date?.trim() && emailId) {
      const sentAt = parseSentDate(row.sent_date)
      if (sentAt) {
        await supabaseAdmin.from('email_logs').insert({
          company_id: companyId,
          company_email_id: emailId,
          subject: '（CSV取込）',
          sent_at: sentAt,
          sent_by: salesRepEmail,
          proposal_product_id: proposalProductId,
        })
      }
    }

    imported++
  }

  return NextResponse.json({ imported, skipped, skippedRows })
}
