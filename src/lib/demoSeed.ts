// デモ環境のデータを全部消して、架空のデータを入れ直す。
// /api/demo/reset（毎日のcron）から呼ぶ。IS_DEMO でないときは何もしない。
//
// 会社名・人名・連絡先はすべて架空。メールは example.com / example.net、
// 電話は実在しない 0000 局番、住所は市区町村まで。
// 日付は「今日」から逆算するので、いつ初期化しても直近のKPIやグラフが埋まる。
import type { SupabaseClient } from '@supabase/supabase-js'
import { TEAM_MEMBERS } from '@/config/team'
import { hashPassword } from './staffAuth'
import { IS_DEMO, DEMO_STAFF_LOGIN_ID, DEMO_STAFF_PASSWORD } from './demo'
import { DEFAULT_PRODUCT_NAME } from './defaultProduct'

// 毎回同じ並びになるよう、乱数は種つき
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STATUSES = ['未接触', '送信予定', '送信済', '返信あり', '商談済', '案件中', '契約済み', '失注', '禁止']
const PRODUCTS = [DEFAULT_PRODUCT_NAME, '商材B']

const GENRES: { name: string; words: string[] }[] = [
  { name: '美容室', words: ['ヘアサロン', 'ヘアーメイク', '美容室'] },
  { name: '整体・整骨院', words: ['整体院', '整骨院', 'ほぐし処'] },
  { name: '歯科', words: ['歯科クリニック', 'デンタルオフィス', '歯科医院'] },
  { name: '飲食店', words: ['食堂', 'ビストロ', 'カフェ', '酒場'] },
  { name: '不動産', words: ['不動産', 'ホーム', '住宅センター'] },
  { name: '学習塾', words: ['ゼミナール', '学習塾', '個別指導教室'] },
  { name: 'ネイル・まつげ', words: ['ネイルサロン', 'アイラッシュ', 'ビューティー'] },
  { name: '工務店', words: ['工務店', '建築', 'リフォーム'] },
  { name: '士業', words: ['税理士事務所', '行政書士事務所', '社労士オフィス'] },
  { name: 'ペット', words: ['ペットサロン', 'どうぶつ病院', 'トリミング'] },
]
const PREFIX = ['さくら', 'みどり', 'あおば', 'ひかり', 'こもれび', 'はなみずき', 'つばさ', 'ほしぞら', 'まるやま', 'やまびこ',
  'あさひ', 'いずみ', 'かえで', 'しらかば', 'すずらん', 'たんぽぽ', 'なごみ', 'のぞみ', 'ふたば', 'わかば',
  'Lumière', 'Hareto', 'Coco', 'Mint', 'Olive', 'Fika', 'Nest', 'Tone', 'Rest', 'Bloom']
const AREAS = ['東京都 世田谷区', '東京都 杉並区', '東京都 練馬区', '神奈川県 横浜市', '神奈川県 川崎市', '埼玉県 さいたま市',
  '千葉県 船橋市', '大阪府 大阪市', '愛知県 名古屋市', '福岡県 福岡市', '北海道 札幌市', '宮城県 仙台市']
const FAMILY = ['佐々木', '田中', '高橋', '伊藤', '渡辺', '中村', '小林', '加藤', '吉田', '山口', '松本', '井上', '木村', '林', '清水']
const GIVEN = ['健', '美咲', '翔太', '彩', '大輔', '愛', '拓也', '恵', '直樹', '由美', '亮', '真由', '誠', '香織', '悠']

const TOTAL_COMPANIES = 360
const DAY = 24 * 60 * 60 * 1000

// JST の「今日 0時」（UTC の Date）
function jstMidnight(offsetDays = 0) {
  const now = new Date(Date.now() + 9 * 3600 * 1000)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 9 * 3600 * 1000 + offsetDays * DAY)
}
function ym(d: Date) {
  const j = new Date(d.getTime() + 9 * 3600 * 1000)
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, '0')}`
}
function isWeekend(d: Date) {
  const w = new Date(d.getTime() + 9 * 3600 * 1000).getUTCDay()
  return w === 0 || w === 6
}

async function insertAll<T extends object>(db: SupabaseClient, table: string, rows: T[], select = false) {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const q = db.from(table).insert(chunk)
    const { data, error } = select ? await q.select() : await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (data) out.push(...(data as Record<string, unknown>[]))
  }
  return out
}

// 子から順に全部消す（主キーの列名は表ごとに違うので、必ず入っている列で絞る）
const WIPE: [string, string][] = [
  ['email_logs', 'id'], ['call_logs', 'id'], ['appointments', 'id'],
  ['company_proposal_products', 'company_id'], ['company_urls', 'id'], ['company_phones', 'id'], ['company_emails', 'id'],
  ['kpi_carry_base', 'year_month'], ['kpi_targets', 'id'], ['sales_targets', 'id'], ['sales_total_targets', 'year_month'],
  ['companies', 'id'], ['email_templates', 'id'], ['proposal_products', 'id'], ['genres', 'id'],
  ['sales_reps', 'id'], ['statuses', 'id'], ['admin_users', 'id'], ['staff', 'id'], ['csv_column_aliases', 'id'],
  ['tasks', 'id'], ['personal_memos', 'id'], ['feature_flags', 'key'], ['kpi_holidays', 'day'], ['demo_settings', 'key'],
]

export async function resetDemoData(db: SupabaseClient) {
  if (!IS_DEMO) throw new Error('デモ環境ではありません')
  const rand = rng(20261110)
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]

  for (const [table, col] of WIPE) {
    const { error } = await db.from(table).delete().not(col, 'is', null)
    // 設定CMSの表（demo_settings）はまだ無い環境もあるので、無ければ飛ばす
    if (error && !/does not exist|Could not find/.test(error.message)) throw new Error(`${table}: ${error.message}`)
  }

  // ---- マスタ ----
  const statuses = await insertAll(db, 'statuses', STATUSES.map((name, i) => ({ name, sort_order: i + 1 })), true)
  const statusId = Object.fromEntries(statuses.map(s => [s.name as string, s.id as string]))
  const products = await insertAll(db, 'proposal_products', PRODUCTS.map((name, i) => ({ name, sort_order: i + 1 })), true)
  const productIds = products.map(p => p.id as string)
  await insertAll(db, 'genres', GENRES.map((g, i) => ({ name: g.name, sort_order: i + 1 })))
  const reps = await insertAll(db, 'sales_reps', TEAM_MEMBERS.map(m => ({ name: m.name, email: m.email })), true)
  const repIds = reps.map(r => r.id as string)
  await insertAll(db, 'admin_users', [{ email: TEAM_MEMBERS[0].email }])
  const { hash, salt } = hashPassword(DEMO_STAFF_PASSWORD)
  await insertAll(db, 'staff', [{ login_id: DEMO_STAFF_LOGIN_ID, display_name: 'デモ スタッフ', password_hash: hash, password_salt: salt, active: true }])
  await insertAll(db, 'feature_flags', [{ key: 'resend_filter', enabled: true }])
  await insertAll(db, 'csv_column_aliases', [
    { csv_header: '企業名', field_key: 'name' }, { csv_header: '店舗名', field_key: 'name' },
    { csv_header: 'HP', field_key: 'url' }, { csv_header: 'TEL', field_key: 'phone' },
    { csv_header: 'Mail', field_key: 'email' }, { csv_header: '業種', field_key: 'genre' },
  ])
  await insertAll(db, 'kpi_holidays', HOLIDAYS.map(([day, name]) => ({ day, name })))
  await insertAll(db, 'email_templates', [
    { name: '初回のご案内（Instagram）', subject: '{{会社名}}様　Instagram運用のご提案', body: '{{代表者名}}様\n\n突然のご連絡失礼いたします。さんぷるの山田と申します。\n{{会社名}}様のInstagram運用について、ご提案の機会をいただけないでしょうか。\n\n（デモ用の文面です）', proposal_product_id: productIds[0], owner_email: TEAM_MEMBERS[0].email },
    { name: '初回のご案内（商材B）', subject: '{{会社名}}様へのご提案', body: '{{代表者名}}様\n\nお世話になります。さんぷるの山田です。\n集客のお手伝いについてご案内させてください。\n\n（デモ用の文面です）', proposal_product_id: productIds[1], owner_email: TEAM_MEMBERS[0].email },
    { name: 'フォローアップ', subject: '先日のご案内について', body: '{{代表者名}}様\n\n先日お送りしたご案内はご覧いただけましたでしょうか。\n\n（デモ用の文面です）', proposal_product_id: null, owner_email: null },
  ])

  // ---- 顧客 ----
  type Draft = { name: string; genre: string; status: string; rep: number; createdAt: Date; product: number; createdBy: string | null }
  const drafts: Draft[] = []
  const used = new Set<string>()
  const weights: [string, number][] = [['未接触', 30], ['送信予定', 14], ['送信済', 30], ['返信あり', 7], ['商談済', 5], ['案件中', 4], ['契約済み', 6], ['失注', 3], ['禁止', 1]]
  const totalW = weights.reduce((a, [, w]) => a + w, 0)
  while (drafts.length < TOTAL_COMPANIES) {
    const g = pick(GENRES)
    const name = `${pick(PREFIX)}${pick(g.words)}`
    const full = used.has(name) ? `${name} ${pick(['駅前店', '本店', '第二店', '南口店', '北店'])}` : name
    if (used.has(full)) continue
    used.add(full)
    let r = rand() * totalW, status = '未接触'
    for (const [s, w] of weights) { if ((r -= w) < 0) { status = s; break } }
    drafts.push({
      name: full, genre: g.name, status, rep: rand() < 0.55 ? 0 : 1,
      createdAt: new Date(jstMidnight(-Math.floor(rand() * 120)).getTime() + Math.floor(rand() * 9 * 3600 * 1000) + 9 * 3600 * 1000),
      product: rand() < 0.65 ? 0 : 1,
      createdBy: drafts.length < 12 ? DEMO_STAFF_LOGIN_ID : null,
    })
  }

  const companies = await insertAll(db, 'companies', drafts.map(d => {
    const contracted = d.status === '契約済み'
    const contractedAt = contracted ? new Date(jstMidnight(-Math.floor(rand() * 75)).getTime() + 15 * 3600 * 1000) : null
    const amount = [30000, 50000, 80000, 100000][Math.floor(rand() * 4)]
    return {
      name: d.name,
      status_id: statusId[d.status],
      representative_name: `${pick(FAMILY)} ${pick(GIVEN)}`,
      service_name: rand() < 0.4 ? `${d.name.split(' ')[0]} 公式サイト` : null,
      genre: d.genre,
      address: pick(AREAS),
      notes: d.status === '返信あり' ? '返信あり。来週電話でフォロー予定（デモ）' : d.status === '失注' ? '今期は予算なしとのこと（デモ）' : null,
      sales_rep_id: d.createdBy ? null : repIds[d.rep],
      instagram_revenue: contracted && d.product === 0 ? amount : null,
      line_revenue: contracted && d.product === 1 ? amount : null,
      contracted_at: contractedAt?.toISOString() ?? null,
      created_by: d.createdBy ?? TEAM_MEMBERS[d.rep].email,
      created_at: d.createdAt.toISOString(),
    }
  }), true)

  const urls: object[] = [], phones: object[] = [], emails: object[] = [], cpp: object[] = []
  companies.forEach((c, i) => {
    const n = String(i + 1).padStart(3, '0')
    urls.push({ company_id: c.id, url: `https://example.com/shop/${n}`, label: '公式', sort_order: 0 })
    if (rand() < 0.5) urls.push({ company_id: c.id, url: `https://example.net/sns/${n}`, label: 'Instagram', sort_order: 1 })
    phones.push({ company_id: c.id, phone: `03-0000-${String(1000 + i).slice(-4)}`, label: '代表', sort_order: 0 })
    emails.push({ company_id: c.id, email: `info${n}@example.com`, label: null, sort_order: 0 })
    if (drafts[i].status !== '未接触') cpp.push({ company_id: c.id, proposal_product_id: productIds[drafts[i].product] })
  })
  await insertAll(db, 'company_urls', urls)
  await insertAll(db, 'company_phones', phones)
  const emailRows = await insertAll(db, 'company_emails', emails, true)
  const emailIdByCompany = new Map(emailRows.map(e => [e.company_id as string, e.id as string]))
  await insertAll(db, 'company_proposal_products', cpp)

  // ---- 送信履歴（直近90日・平日のみ）----
  // 一度送った顧客にまた送ることもあるので、送信済み以降の顧客から繰り返し選ぶ
  const sentPool = companies.filter((_, i) => !['未接触', '送信予定'].includes(drafts[i].status) && !drafts[i].createdBy)
  const logs: object[] = []
  for (let back = 90; back >= 0; back--) {
    const day = jstMidnight(-back)
    if (isWeekend(day)) continue
    TEAM_MEMBERS.forEach((m, r) => {
      const count = back === 0 ? Math.floor(4 + rand() * 6) : Math.floor((r === 0 ? 14 : 10) + rand() * 10)
      for (let k = 0; k < count; k++) {
        const ci = Math.floor(rand() * sentPool.length)
        const c = sentPool[ci]
        const idx = companies.indexOf(c)
        logs.push({
          company_id: c.id,
          company_email_id: emailIdByCompany.get(c.id as string) ?? null,
          subject: drafts[idx].product === 0 ? `${c.name}様　Instagram運用のご提案` : `${c.name}様へのご提案`,
          sent_at: new Date(day.getTime() + (10 + rand() * 8) * 3600 * 1000).toISOString(),
          sent_by: m.email,
          gmail_message_id: `demo-mail-seed-${logs.length}`,
          proposal_product_id: productIds[drafts[idx].product],
          send_type: rand() < 0.2 ? 'form' : 'email',
        })
      }
    })
  }
  await insertAll(db, 'email_logs', logs)

  // ---- 通話・アポ ----
  const talked = companies.filter((_, i) => ['返信あり', '商談済', '案件中', '契約済み', '失注'].includes(drafts[i].status))
  await insertAll(db, 'call_logs', talked.map((c, i) => ({
    company_id: c.id,
    direction: i % 3 === 0 ? 'inbound' : 'outbound',
    duration_seconds: 60 + Math.floor(rand() * 900),
    notes: pick(['資料送付の希望あり', '担当者不在。折り返し待ち', '料金について質問あり', '来月改めて検討とのこと']) + '（デモ）',
    called_at: new Date(jstMidnight(-Math.floor(rand() * 30)).getTime() + 14 * 3600 * 1000).toISOString(),
    logged_by: TEAM_MEMBERS[i % TEAM_MEMBERS.length].email,
  })))
  const apo: object[] = []
  talked.forEach((c, i) => {
    const offset = i % 4 === 0 ? Math.floor(rand() * 14) : -Math.floor(rand() * 60)
    const start = new Date(jstMidnight(offset).getTime() + (10 + Math.floor(rand() * 7)) * 3600 * 1000)
    apo.push({
      company_id: c.id,
      title: `【商談】${c.name}`,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + 3600 * 1000).toISOString(),
      google_event_id: `demo-event-seed-${i}`,
      created_by: TEAM_MEMBERS[i % TEAM_MEMBERS.length].email,
    })
  })
  await insertAll(db, 'appointments', apo)

  // ---- 目標（今月と先月）----
  // 送信の実績（1日あたり山田14〜24通・鈴木10〜20通）でだいたい届く値にして、繰越が膨らまないようにする
  const months = [ym(jstMidnight()), ym(jstMidnight(-31))].filter((v, i, a) => a.indexOf(v) === i)
  const kpi: object[] = [], st: object[] = [], tt: object[] = []
  for (const m of months) {
    repIds.forEach((rid, r) => {
      productIds.forEach((pid, p) => kpi.push({ year_month: m, sales_rep_id: rid, proposal_product_id: pid, target_contracts: p === 0 ? (r === 0 ? 3 : 2) : 1, appointments_per_contract: 4, sends_per_appointment: 20 }))
      st.push({ sales_rep_id: rid, year_month: m, target_revenue: r === 0 ? 400000 : 300000 })
    })
    tt.push({ year_month: m, target_revenue: 700000 })
  }
  await insertAll(db, 'kpi_targets', kpi)
  await insertAll(db, 'sales_targets', st)
  await insertAll(db, 'sales_total_targets', tt)

  // ---- タスク・メモ ----
  const owner = TEAM_MEMBERS[0].email
  const today = new Date(jstMidnight().getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  await insertAll(db, 'tasks', [
    { title: '返信があった3社に電話でフォロー', done: false, is_shared: false, scheduled_date: today, original_date: today, created_by: owner },
    { title: '来週の商談資料を作る', done: false, is_shared: false, scheduled_date: today, original_date: today, created_by: owner },
    { title: 'CSVで新しいリストを取り込む', done: true, is_shared: false, scheduled_date: today, original_date: today, created_by: owner },
    { title: '月末の数字をチームで確認', done: false, is_shared: true, scheduled_date: today, original_date: today, created_by: owner },
  ])
  await insertAll(db, 'personal_memos', [
    { content: '火曜の午後は返信が多い。送信は午前中に寄せる（デモ）', created_by: owner },
    { content: '整体院は「予約が埋まらない」話から入ると反応がよい（デモ）', created_by: owner },
  ])

  return { companies: companies.length, emailLogs: logs.length, appointments: apo.length }
}

const HOLIDAYS: [string, string][] = [
  ['2026-01-01', '元日'], ['2026-01-12', '成人の日'], ['2026-02-11', '建国記念の日'], ['2026-02-23', '天皇誕生日'],
  ['2026-03-20', '春分の日'], ['2026-04-29', '昭和の日'], ['2026-05-04', 'みどりの日'], ['2026-05-05', 'こどもの日'],
  ['2026-05-06', '振替休日'], ['2026-07-20', '海の日'], ['2026-08-11', '山の日'], ['2026-09-21', '敬老の日'],
  ['2026-09-22', '国民の休日'], ['2026-09-23', '秋分の日'], ['2026-10-12', 'スポーツの日'], ['2026-11-03', '文化の日'],
  ['2026-11-23', '勤労感謝の日'],
  ['2027-01-01', '元日'], ['2027-01-11', '成人の日'], ['2027-02-11', '建国記念の日'], ['2027-02-23', '天皇誕生日'],
  ['2027-03-22', '春分の日の振替休日'], ['2027-04-29', '昭和の日'], ['2027-05-03', '憲法記念日'], ['2027-05-04', 'みどりの日'],
  ['2027-05-05', 'こどもの日'], ['2027-07-19', '海の日'], ['2027-08-11', '山の日'], ['2027-09-20', '敬老の日'],
  ['2027-09-23', '秋分の日'], ['2027-10-11', 'スポーツの日'], ['2027-11-03', '文化の日'], ['2027-11-23', '勤労感謝の日'],
]
