import { supabase } from './supabase'
import { normalizeEmail, normalizePhone, normalizeUrl, isPhoneSearchable } from './normalize'

// 顧客の新規登録（CompanyForm）と編集（顧客詳細ページ）で、まったく同じ重複判定を使うための共通処理。
// 以前は2ファイルに同じコードがコピーされていて、片方だけ直すと判定がズレる状態だった。

export type ContactValues = {
  /** trim 済みの入力値。空文字は呼び出し側で除外しておくこと */
  emails: string[]
  phones: string[]
  urls: string[]
}

/**
 * 重複が見つかったらユーザー向けのエラーメッセージを返す。問題なければ null。
 * @param excludeCompanyId 編集中の顧客ID。自分自身は重複扱いしないために使う（新規登録時は undefined）
 */
export async function findDuplicateContactError(
  { emails, phones, urls }: ContactValues,
  excludeCompanyId?: string,
): Promise<string | null> {
  // --- メールアドレス（フォーム内）---
  const normalizedEmails = emails.map(normalizeEmail)
  if (new Set(normalizedEmails).size !== normalizedEmails.length) {
    return '同じメールアドレスが複数入力されています'
  }

  // --- メールアドレス（他の顧客）---
  // ※ilike は大文字小文字しか無視しないため、全角・スペースを除去した値で照合する
  if (normalizedEmails.length > 0) {
    const results = await Promise.all(
      normalizedEmails.map(email =>
        supabase.from('company_emails').select('email, company_id').ilike('email', email)
      )
    )
    const duplicates = results
      .flatMap(r => r.data ?? [])
      .filter(e => e.company_id !== excludeCompanyId)
    if (duplicates.length > 0) {
      return `以下のメールアドレスは他の顧客に登録済みです：${duplicates.map(d => d.email).join('、')}`
    }
  }

  // --- 電話番号（フォーム内）---
  const normalizedPhones = phones.map(normalizePhone)
  if (new Set(normalizedPhones).size !== normalizedPhones.length) {
    return '同じ電話番号が複数入力されています'
  }

  // --- 電話番号（他の顧客・正規化RPC使用）---
  // ※RPCは数字以外を除去して部分一致するため、全角のまま渡すと空文字になり全件ヒットして誤ブロックになる。
  //   必ず半角化してから渡し、数字が6桁未満のものは誤ヒット防止のため照合しない。
  const phoneTargets = phones
    .map((original, i) => ({ original, normalized: normalizedPhones[i] }))
    .filter(p => isPhoneSearchable(p.normalized))
  if (phoneTargets.length > 0) {
    const results = await Promise.all(
      phoneTargets.map(p => supabase.rpc('search_phones_normalized', { search_text: p.normalized }))
    )
    const duplicates = phoneTargets.filter((_, i) => {
      const hits = (results[i].data as { company_id: string }[] | null) ?? []
      return hits.some(r => r.company_id !== excludeCompanyId)
    })
    if (duplicates.length > 0) {
      return `以下の電話番号は他の顧客に登録済みです：${duplicates.map(p => p.original).join('、')}`
    }
  }

  // --- URL（他の顧客）---
  // ※会社名の重複チェックは弾かれすぎるため入れていない
  for (const url of urls) {
    const urlCore = normalizeUrl(url)
    if (!urlCore) continue
    // 前方 % 付きの ILIKE はインデックスが使えず company_urls を全走査するので、
    // 「1件でもあるか」だけ分かればいい以上は limit(1) で転送量を最小にする。
    // 自分自身の除外は必ずDB側（.neq）で行うこと。
    // JS側で除外すると limit(1) の1件を自分の行が使い切って、他の顧客との重複を見落とす。
    let query = supabase
      .from('company_urls')
      .select('url, company_id')
      .ilike('url', `%${urlCore}%`)
    if (excludeCompanyId) query = query.neq('company_id', excludeCompanyId)
    const { data: hits } = await query.limit(1)
    if ((hits ?? []).length > 0) {
      return `このURLは既に他の顧客に登録されています：${url}`
    }
  }

  return null
}
