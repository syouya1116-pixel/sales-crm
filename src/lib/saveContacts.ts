import { supabase } from './supabase'
import { sanitizeForSave, sanitizeEmailForSave } from './normalize'
import { ContactField, filledFields, planContactSync } from './contactFields'

// 連絡先（URL・電話・メール）の保存を1か所にまとめたもの。
//
// 以前は「全削除 → 入力内容を再挿入」だったが、行の id が毎回変わるため
// email_logs.company_email_id（ON DELETE SET NULL）が外れ、保存するたびに
// メール履歴の「宛先」が消えていた。今は値が同じ行は残して label・並び順だけ直し、
// 消された行だけ削除・増えた行だけ挿入する（planContactSync）。
// 途中で失敗しても消えるのはユーザーが消した行だけなので、連絡先が丸ごと消えることもない。

export type ContactRows = {
  urls: ContactField[]
  phones: ContactField[]
  emails: ContactField[]
}

type ContactTable = 'company_urls' | 'company_phones' | 'company_emails'
type ContactColumn = 'url' | 'phone' | 'email'

type ExistingRow = { id: string; label: string | null; sort_order: number | null } & Partial<Record<ContactColumn, string>>

/** 1種類ぶんを同期する。失敗したらエラー文言、成功したら null */
async function syncContactTable(
  companyId: string,
  table: ContactTable,
  column: ContactColumn,
  fields: ContactField[],
  sanitize: (v: string) => string,
): Promise<string | null> {
  const { data, error: selErr } = await supabase
    .from(table)
    .select(`id, ${column}, label, sort_order`)
    .eq('company_id', companyId)
  if (selErr) return selErr.message

  const rows = (data ?? []) as unknown as ExistingRow[]
  const plan = planContactSync(
    rows.map(r => ({ id: r.id, value: sanitize(r[column] ?? '') })),
    filledFields(fields).map(f => ({ value: sanitize(f.value), label: f.label })),
  )

  if (plan.deleteIds.length > 0) {
    const { error } = await supabase.from(table).delete().in('id', plan.deleteIds)
    if (error) return error.message
  }

  // 変わっていない行まで UPDATE すると保存のたびに往復が増えるので、差分だけ送る
  const byId = new Map(rows.map(r => [r.id, r]))
  const changed = plan.updates.filter(u => {
    const r = byId.get(u.id)
    return !r || (r.label ?? null) !== u.label || r.sort_order !== u.sort_order
  })
  const updateErrors = (await Promise.all(changed.map(u =>
    supabase.from(table).update({ label: u.label, sort_order: u.sort_order }).eq('id', u.id),
  ))).map(r => r.error).filter(Boolean)
  if (updateErrors.length > 0) return updateErrors[0]?.message ?? '更新に失敗しました'

  if (plan.inserts.length > 0) {
    const { error } = await supabase.from(table).insert(plan.inserts.map(ins => ({
      company_id: companyId, [column]: ins.value, label: ins.label, sort_order: ins.sort_order,
    })))
    if (error) return error.message
  }
  return null
}

/** 失敗したらユーザー向けのエラーメッセージ、成功したら null を返す */
export async function replaceCompanyContacts(
  companyId: string,
  { urls, phones, emails }: ContactRows,
): Promise<string | null> {
  const errors = (await Promise.all([
    syncContactTable(companyId, 'company_urls', 'url', urls, sanitizeForSave),
    syncContactTable(companyId, 'company_phones', 'phone', phones, sanitizeForSave),
    syncContactTable(companyId, 'company_emails', 'email', emails, sanitizeEmailForSave),
  ])).filter(Boolean)

  if (errors.length > 0) {
    return (
      `連絡先（URL・電話・メール）の保存に失敗しました：${errors[0]}\n` +
      `この画面を閉じると入力内容が失われます。閉じずにもう一度「保存」を押してください。`
    )
  }

  return null
}

/** 提案商材の中間テーブルを入れ替える。失敗したらエラーメッセージ、成功したら null */
export async function replaceProposalProducts(
  companyId: string,
  productIds: string[],
): Promise<string | null> {
  const { error: delErr } = await supabase
    .from('company_proposal_products')
    .delete()
    .eq('company_id', companyId)
  if (delErr) return `提案商材の更新に失敗しました：${delErr.message}`

  if (productIds.length === 0) return null

  const { error: insErr } = await supabase.from('company_proposal_products').insert(
    productIds.map(pid => ({ company_id: companyId, proposal_product_id: pid }))
  )
  if (insErr) {
    return `提案商材の保存に失敗しました：${insErr.message}（画面はまだ閉じずに、もう一度「保存」を押してください）`
  }
  return null
}
