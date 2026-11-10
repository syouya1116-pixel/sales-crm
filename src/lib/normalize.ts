// 重複チェック用の正規化ロジック。
// CSVインポート（api/import）と手動登録（CompanyForm・顧客詳細）で必ずこれを共有する。
// 片方だけ直すと判定がズレて重複が素通りするため、個別に再定義しないこと。

/** 全角英数字を半角にする */
export const toHalfWidth = (v: string): string =>
  v.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))

/** メール：全角→半角・スペース除去・小文字化 */
export const normalizeEmail = (email: string): string =>
  toHalfWidth(email)
    .replace(/[　\s]/g, '')
    .toLowerCase()

/** 電話：全角→半角・数字と + 以外を除去 */
export const normalizePhone = (phone: string): string =>
  toHalfWidth(phone)
    .replace(/[　\s]/g, '')
    .replace(/[^\d+]/g, '')

/** URL：全角→半角・プロトコル/www/末尾スラッシュ除去・小文字化 */
export const normalizeUrl = (url: string): string =>
  url
    .replace(/[Ａ-Ｚａ-ｚ０-９：／．－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')

/** 会社名：法人格を除去（部分一致の照合用） */
export const normalizeCompanyName = (name: string): string =>
  name
    .replace(/株式会社|合同会社|有限会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|特定非営利活動法人|NPO法人/g, '')
    .trim()

/** 会社名：法人格＋スペースを除去して小文字化（完全一致の照合用） */
export const normalizeCompanyNameStrict = (name: string): string =>
  normalizeCompanyName(name).replace(/[　\s]/g, '').toLowerCase()

/**
 * 保存用の整形。
 * 全角のまま保存するとメール送信やリンクが機能しないため半角へ直す。
 * 大文字小文字とハイフンは入力どおり残す（表示に使うため）。
 */
export const sanitizeEmailForSave = (email: string): string =>
  toHalfWidth(email).replace(/[　\s]/g, '')

export const sanitizeForSave = (v: string): string => toHalfWidth(v).trim()

/**
 * 電話番号を照合してよいか。
 * search_phones_normalized RPC は数字以外を除去して部分一致するため、
 * 桁数が少ないと無関係な会社に大量ヒットする。空文字を渡すと全件ヒットする。
 */
export const isPhoneSearchable = (normalizedPhone: string): boolean =>
  normalizedPhone.replace(/\D/g, '').length >= 6
