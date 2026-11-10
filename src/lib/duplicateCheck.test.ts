import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { findDuplicateContactError } from './duplicateCheck.ts'
import { db, resetDb } from '../../test/fakeSupabase.ts'

// 顧客の新規登録・編集で共有している重複判定。
// 「重複が素通りして二重登録される」「無関係な顧客を重複扱いして登録できない」の
// どちらも過去に起きているため、両方向をテストしている。
// Supabase は test/fakeSupabase.ts に差し替わる（test/hooks.mjs 参照）。

const ME = 'company-me'
const OTHER = 'company-other'

const empty = { emails: [], phones: [], urls: [] }

beforeEach(resetDb)

describe('入力なし', () => {
  test('何も入力がなければ重複なし', async () => {
    assert.equal(await findDuplicateContactError(empty), null)
  })
})

describe('メールアドレス', () => {
  test('フォーム内で同じメールを2つ入れたら弾く', async () => {
    const result = await findDuplicateContactError({
      ...empty,
      emails: ['info@example.com', 'info@example.com'],
    })
    assert.equal(result, '同じメールアドレスが複数入力されています')
  })

  test('全角・大文字違いでもフォーム内重複として弾く', async () => {
    const result = await findDuplicateContactError({
      ...empty,
      emails: ['info@example.com', 'ＩＮＦＯ@Example.com'],
    })
    assert.equal(result, '同じメールアドレスが複数入力されています')
  })

  test('別のメールなら通す', async () => {
    const result = await findDuplicateContactError({
      ...empty,
      emails: ['a@example.com', 'b@example.com'],
    })
    assert.equal(result, null)
  })

  test('他の顧客に登録済みなら弾く', async () => {
    db.company_emails = [{ email: 'info@example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, emails: ['info@example.com'] })
    assert.equal(result, '以下のメールアドレスは他の顧客に登録済みです：info@example.com')
  })

  test('大文字小文字が違っても他の顧客の重複として検出する', async () => {
    db.company_emails = [{ email: 'Info@Example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, emails: ['info@example.com'] })
    assert.match(result ?? '', /他の顧客に登録済み/)
  })

  test('編集中の顧客自身のメールは重複扱いしない', async () => {
    db.company_emails = [{ email: 'info@example.com', company_id: ME }]
    const result = await findDuplicateContactError({ ...empty, emails: ['info@example.com'] }, ME)
    assert.equal(result, null)
  })

  test('新規登録（excludeCompanyId なし）では既存メールを必ず弾く', async () => {
    db.company_emails = [{ email: 'info@example.com', company_id: ME }]
    const result = await findDuplicateContactError({ ...empty, emails: ['info@example.com'] })
    assert.match(result ?? '', /他の顧客に登録済み/)
  })

  test('部分一致では弾かない（別アドレスを巻き込まない）', async () => {
    db.company_emails = [{ email: 'sales-info@example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, emails: ['info@example.com'] })
    assert.equal(result, null)
  })
})

describe('電話番号', () => {
  test('フォーム内でハイフン違いの同じ番号を入れたら弾く', async () => {
    const result = await findDuplicateContactError({
      ...empty,
      phones: ['03-1234-5678', '0312345678'],
    })
    assert.equal(result, '同じ電話番号が複数入力されています')
  })

  test('他の顧客に登録済みなら入力どおりの表記でエラーに出す', async () => {
    db.company_phones = [{ phone: '0312345678', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, phones: ['03-1234-5678'] })
    assert.equal(result, '以下の電話番号は他の顧客に登録済みです：03-1234-5678')
  })

  test('全角で入力しても他の顧客の重複として検出する', async () => {
    db.company_phones = [{ phone: '0312345678', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, phones: ['０３－１２３４－５６７８'] })
    assert.match(result ?? '', /他の顧客に登録済み/)
  })

  test('編集中の顧客自身の番号は重複扱いしない', async () => {
    db.company_phones = [{ phone: '0312345678', company_id: ME }]
    const result = await findDuplicateContactError({ ...empty, phones: ['0312345678'] }, ME)
    assert.equal(result, null)
  })

  test('数字が6桁未満の入力は照合しない（部分一致で全社に当たるため）', async () => {
    db.company_phones = [{ phone: '0312345678', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, phones: ['0312'] })
    assert.equal(result, null)
  })

  test('数字を含まない入力（「担当者に確認」など）で全件重複にならない', async () => {
    db.company_phones = [{ phone: '0312345678', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, phones: ['担当者に確認'] })
    assert.equal(result, null)
  })

  test('別の番号なら通す', async () => {
    db.company_phones = [{ phone: '0312345678', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, phones: ['0398765432'] })
    assert.equal(result, null)
  })
})

describe('URL', () => {
  test('他の顧客に登録済みなら弾く', async () => {
    db.company_urls = [{ url: 'https://www.example.com/', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, urls: ['https://example.com'] })
    assert.equal(result, 'このURLは既に他の顧客に登録されています：https://example.com')
  })

  test('http / https / www / 末尾スラッシュの違いを同一URLとみなす', async () => {
    db.company_urls = [{ url: 'http://example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, urls: ['https://www.example.com/'] })
    assert.match(result ?? '', /既に他の顧客に登録/)
  })

  test('編集中の顧客自身のURLは重複扱いしない', async () => {
    db.company_urls = [{ url: 'https://example.com', company_id: ME }]
    const result = await findDuplicateContactError({ ...empty, urls: ['https://example.com'] }, ME)
    assert.equal(result, null)
  })

  test('別ドメインなら通す', async () => {
    db.company_urls = [{ url: 'https://example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, urls: ['https://example.co.jp'] })
    assert.equal(result, null)
  })

  test('空のURLはスキップする（前方一致で全件ヒットさせない）', async () => {
    db.company_urls = [{ url: 'https://example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({ ...empty, urls: ['   '] })
    assert.equal(result, null)
  })
})

describe('チェックの優先順位', () => {
  test('メール・電話・URLがすべて重複していてもメールのエラーを先に返す', async () => {
    db.company_emails = [{ email: 'info@example.com', company_id: OTHER }]
    db.company_phones = [{ phone: '0312345678', company_id: OTHER }]
    db.company_urls = [{ url: 'https://example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({
      emails: ['info@example.com'],
      phones: ['0312345678'],
      urls: ['https://example.com'],
    })
    assert.match(result ?? '', /メールアドレスは他の顧客に登録済み/)
  })

  test('メールが問題なければ電話のエラーを返す', async () => {
    db.company_phones = [{ phone: '0312345678', company_id: OTHER }]
    db.company_urls = [{ url: 'https://example.com', company_id: OTHER }]
    const result = await findDuplicateContactError({
      emails: ['fresh@example.com'],
      phones: ['0312345678'],
      urls: ['https://example.com'],
    })
    assert.match(result ?? '', /電話番号は他の顧客に登録済み/)
  })
})
