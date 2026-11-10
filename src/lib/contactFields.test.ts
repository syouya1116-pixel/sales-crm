import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { emptyField, toFields, filledFields, filledValues, sortContacts, planContactSync } from './contactFields.ts'

// 連絡先が保存時に消えるバグ（顧客詳細の保存で電話・メールが空になる）が
// 過去に起きているため、空欄の扱いをここで固定しておく。

describe('toFields', () => {
  test('DBの行を value/label に詰め替える', () => {
    const rows = [{ email: 'a@example.com', label: '代表' }, { email: 'b@example.com', label: null }]
    assert.deepEqual(toFields(rows, r => r.email), [
      { value: 'a@example.com', label: '代表' },
      { value: 'b@example.com', label: '' },
    ])
  })

  test('0件のときは空欄を1つ返す（入力欄が消えないように）', () => {
    assert.deepEqual(toFields([], r => String(r)), [{ value: '', label: '' }])
  })

  test('null / undefined でも空欄を1つ返す', () => {
    assert.deepEqual(toFields(null, r => String(r)), [{ value: '', label: '' }])
    assert.deepEqual(toFields(undefined, r => String(r)), [{ value: '', label: '' }])
  })

  test('label が未設定なら空文字にする（null を input に渡さない）', () => {
    const [field] = toFields<{ phone: string; label?: string | null }>(
      [{ phone: '0312345678' }],
      r => r.phone,
    )
    assert.equal(field.label, '')
  })
})

describe('filledValues', () => {
  test('空欄と空白のみの行を除いて trim した値を返す', () => {
    const fields = [
      { value: ' a@example.com ', label: '' },
      { value: '', label: '代表' },
      { value: '   ', label: '' },
      { value: 'b@example.com', label: '' },
    ]
    assert.deepEqual(filledValues(fields), ['a@example.com', 'b@example.com'])
  })

  test('全部空なら空配列（重複チェックに空文字を渡さない）', () => {
    assert.deepEqual(filledValues([emptyField(), emptyField()]), [])
  })
})

describe('filledFields', () => {
  test('label だけ入力された行は保存対象にしない', () => {
    const fields = [{ value: '', label: '代表' }, { value: '0312345678', label: '本社' }]
    assert.deepEqual(filledFields(fields), [{ value: '0312345678', label: '本社' }])
  })

  test('filledValues と違って value は trim しない（保存時に別途整形する）', () => {
    assert.deepEqual(filledFields([{ value: ' a ', label: '' }]), [{ value: ' a ', label: '' }])
  })
})

describe('emptyField', () => {
  test('毎回別のオブジェクトを返す（同じ参照を使い回すと全欄が連動してしまう）', () => {
    const a = emptyField()
    const b = emptyField()
    assert.deepEqual(a, b)
    assert.notEqual(a, b)
  })
})

describe('sortContacts', () => {
  test('id ではなく sort_order（登録順）で並べる。一斉送信の「先頭」がこれで決まる', () => {
    const rows = [
      { id: 'aaa', email: '2番目', sort_order: 1 },
      { id: 'zzz', email: '1番目', sort_order: 0 },
    ]
    assert.deepEqual(sortContacts(rows).map(r => r.email), ['1番目', '2番目'])
  })

  test('sort_order が同じ・無いときは id 順で決定的に並ぶ', () => {
    const rows = [{ id: 'b', sort_order: null }, { id: 'a' }]
    assert.deepEqual(sortContacts(rows).map(r => r.id), ['a', 'b'])
  })

  test('元の配列は並べ替えない', () => {
    const rows = [{ id: 'b', sort_order: 1 }, { id: 'a', sort_order: 0 }]
    sortContacts(rows)
    assert.equal(rows[0].id, 'b')
  })

  test('toFields も登録順で入力欄に出す', () => {
    const rows = [{ id: 'x', email: 'b@example.com', label: null, sort_order: 1 }, { id: 'y', email: 'a@example.com', label: null, sort_order: 0 }]
    assert.deepEqual(toFields(rows, r => r.email).map(f => f.value), ['a@example.com', 'b@example.com'])
  })
})

describe('planContactSync', () => {
  // 保存のたびに全消し→入れ直しをすると id が変わり、メール履歴の「宛先」が外れていた
  test('値が変わっていない行は id を残す（削除も挿入もしない）', () => {
    const plan = planContactSync(
      [{ id: 'e1', value: 'a@example.com' }],
      [{ value: 'a@example.com', label: '代表' }],
    )
    assert.deepEqual(plan, { deleteIds: [], updates: [{ id: 'e1', label: '代表', sort_order: 0 }], inserts: [] })
  })

  test('消した行だけ削除し、増えた行だけ挿入する', () => {
    const plan = planContactSync(
      [{ id: 'e1', value: 'a@example.com' }, { id: 'e2', value: 'b@example.com' }],
      [{ value: 'b@example.com', label: '' }, { value: 'c@example.com', label: '' }],
    )
    assert.deepEqual(plan.deleteIds, ['e1'])
    assert.deepEqual(plan.updates, [{ id: 'e2', label: null, sort_order: 0 }])
    assert.deepEqual(plan.inserts, [{ value: 'c@example.com', label: null, sort_order: 1 }])
  })

  test('並べ替えは sort_order の更新だけで済む', () => {
    const plan = planContactSync(
      [{ id: 'e1', value: 'a' }, { id: 'e2', value: 'b' }],
      [{ value: 'b', label: '' }, { value: 'a', label: '' }],
    )
    assert.deepEqual(plan.updates, [{ id: 'e2', label: null, sort_order: 0 }, { id: 'e1', label: null, sort_order: 1 }])
    assert.deepEqual(plan.deleteIds, [])
    assert.deepEqual(plan.inserts, [])
  })

  test('同じ値が既存に2行あっても1行ずつ対応させ、余りは削除する', () => {
    const plan = planContactSync(
      [{ id: 'e1', value: 'a' }, { id: 'e2', value: 'a' }],
      [{ value: 'a', label: '' }],
    )
    assert.deepEqual(plan.updates.map(u => u.id), ['e1'])
    assert.deepEqual(plan.deleteIds, ['e2'])
  })

  test('全部消したら全部削除（空欄1つだけの入力は呼び出し側で除かれる）', () => {
    const plan = planContactSync([{ id: 'e1', value: 'a' }], [])
    assert.deepEqual(plan, { deleteIds: ['e1'], updates: [], inserts: [] })
  })
})
