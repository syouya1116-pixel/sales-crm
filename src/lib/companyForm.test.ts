import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { companyToForm, buildCompanyPayload, type CompanyFormValues } from './companyForm.ts'

// 「契約済み以外なら売上・契約日を null で消す」ルールの回帰テスト。
// 以前は新規登録と編集の2か所に同じ条件が書かれていて、片方だけ直ると
// ステータスを戻したのに売上が残る、という状態になっていた。

const filledForm: CompanyFormValues = {
  name: 'さんぷる',
  status_id: 'status-1',
  representative_name: '山田',
  service_name: 'CRM',
  genre: 'IT',
  address: '東京都',
  notes: 'メモ',
  sales_rep_id: 'rep-1',
  instagram_revenue: '100000',
  line_revenue: 50000,
  contracted_at: '2026-07-01',
  cancel_instagram_revenue: '20000',
  cancel_line_revenue: '',
  cancelled_at: '2026-07-20',
}

describe('companyToForm', () => {
  test('顧客が未指定なら全項目が空文字（フォームの初期値）', () => {
    const form = companyToForm(null)
    assert.deepEqual(Object.values(form).filter(v => v !== ''), [])
  })

  test('undefined でも空文字で返す', () => {
    assert.deepEqual(companyToForm(undefined), companyToForm(null))
  })

  test('DBの null は空文字に変換する（input の value に null を渡さないため）', () => {
    const form = companyToForm({
      id: 'c1',
      name: 'テスト',
      status_id: null,
      instagram_revenue: null,
      contracted_at: null,
    } as never)
    assert.equal(form.name, 'テスト')
    assert.equal(form.status_id, '')
    assert.equal(form.instagram_revenue, '')
    assert.equal(form.contracted_at, '')
  })

  test('売上0はそのまま0で残す（?? を使っているので || で消えない）', () => {
    const form = companyToForm({ id: 'c1', name: 'テスト', instagram_revenue: 0 } as never)
    assert.equal(form.instagram_revenue, 0)
  })
})

describe('buildCompanyPayload', () => {
  test('契約済みなら金額を数値に変換して残す', () => {
    const payload = buildCompanyPayload(filledForm, true)
    assert.equal(payload.instagram_revenue, 100000)
    assert.equal(payload.line_revenue, 50000)
    assert.equal(payload.contracted_at, '2026-07-01')
    assert.equal(payload.cancel_instagram_revenue, 20000)
    assert.equal(payload.cancelled_at, '2026-07-20')
  })

  test('契約済みでなければ金額・日付をすべて null にする', () => {
    const payload = buildCompanyPayload(filledForm, false)
    assert.equal(payload.instagram_revenue, null)
    assert.equal(payload.line_revenue, null)
    assert.equal(payload.contracted_at, null)
    assert.equal(payload.cancel_instagram_revenue, null)
    assert.equal(payload.cancel_line_revenue, null)
    assert.equal(payload.cancelled_at, null)
  })

  test('契約済みでも未入力の金額は null（空文字を数値にして0にしない）', () => {
    const payload = buildCompanyPayload(filledForm, true)
    assert.equal(payload.cancel_line_revenue, null)
  })

  test('契約済みで金額0は0として保存する（未入力と区別する）', () => {
    const payload = buildCompanyPayload({ ...filledForm, instagram_revenue: '0' }, true)
    assert.equal(payload.instagram_revenue, 0)
  })

  test('未選択のステータス・営業担当は空文字でなく null にする（外部キー制約対策）', () => {
    const payload = buildCompanyPayload({ ...filledForm, status_id: '', sales_rep_id: '' }, true)
    assert.equal(payload.status_id, null)
    assert.equal(payload.sales_rep_id, null)
  })

  test('契約情報以外の項目は加工せずそのまま渡す', () => {
    const payload = buildCompanyPayload(filledForm, false)
    assert.equal(payload.name, 'さんぷる')
    assert.equal(payload.notes, 'メモ')
    assert.equal(payload.address, '東京都')
  })
})
