import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pickProductForLog } from './proposalProductForLog'

type TargetRow = { proposal_product_id: string }

/**
 * kpi_targets を2回引くぶんを再現したニセクライアント。
 * 1回目 … 適用中の年月を探す（lte + order + limit で終わる）
 * 2回目 … その月の目標を引く（eq + in + gt で終わる）
 */
function fakeClient(rows: TargetRow[], error: unknown = null, latestYm = '2026-08') {
  const calls: { table?: string; ids?: string[]; ym?: string; lte?: string } = {}
  const chain = {
    select: () => chain,
    lte: (_col: string, value: string) => { calls.lte = value; return chain },
    order: () => chain,
    limit: () => Promise.resolve({
      data: error ? null : (latestYm ? [{ year_month: latestYm }] : []),
      error,
    }),
    eq: (_col: string, value: string) => { calls.ym = value; return chain },
    in: (_col: string, value: string[]) => { calls.ids = value; return chain },
    gt: () => Promise.resolve({ data: error ? null : rows, error }),
  }
  const client = {
    from: (table: string) => { calls.table = table; return chain },
  } as unknown as SupabaseClient
  return { client, calls }
}

test('候補が無ければ null', async () => {
  const { client } = fakeClient([])
  assert.equal(await pickProductForLog(client, []), null)
})

test('候補が1つならそのまま返す（目標は見に行かない）', async () => {
  const { client, calls } = fakeClient([])
  assert.equal(await pickProductForLog(client, ['insta']), 'insta')
  assert.equal(calls.table, undefined)
})

test('重複を除いて1つになるならそのまま返す', async () => {
  const { client, calls } = fakeClient([])
  assert.equal(await pickProductForLog(client, ['insta', 'insta']), 'insta')
  assert.equal(calls.table, undefined)
})

// 鈴木さんのケース。Instagram と アプリ開発 の両方にチェックが入っているが、
// 今月の目標が入っているのは Instagram だけ
test('候補が複数でも、今月の目標がある商材が1つだけならそれに決まる', async () => {
  const { client, calls } = fakeClient([{ proposal_product_id: 'insta' }])
  assert.equal(await pickProductForLog(client, ['insta', 'app']), 'insta')
  assert.equal(calls.table, 'kpi_targets')
  assert.deepEqual(calls.ids, ['insta', 'app'])
})

test('目標は担当者ごとに行があるので、同じ商材が複数行でも1つに決まる', async () => {
  const rows = [{ proposal_product_id: 'insta' }, { proposal_product_id: 'insta' }]
  const { client } = fakeClient(rows)
  assert.equal(await pickProductForLog(client, ['insta', 'app']), 'insta')
})

test('目標のある商材が2つあると特定できないので null', async () => {
  const rows = [{ proposal_product_id: 'insta' }, { proposal_product_id: 'app' }]
  const { client } = fakeClient(rows)
  assert.equal(await pickProductForLog(client, ['insta', 'app']), null)
})

test('どちらにも目標が無ければ null', async () => {
  const { client } = fakeClient([])
  assert.equal(await pickProductForLog(client, ['insta', 'app']), null)
})

test('目標の取得に失敗したら null（適当な1つを選ばない）', async () => {
  const { client } = fakeClient([], { message: 'boom' })
  assert.equal(await pickProductForLog(client, ['insta', 'app']), null)
})

test('適用中の年月を探すときの上限は JST の YYYY-MM', async () => {
  const { client, calls } = fakeClient([{ proposal_product_id: 'insta' }])
  await pickProductForLog(client, ['insta', 'app'])
  assert.match(calls.lte ?? '', /^\d{4}-\d{2}$/)
})

// 9月に入っても8月の目標がそのまま効く。ここが今月固定だと、
// 進捗は出ているのに送信ログの商材だけ NULL になる
test('今月の行が無ければ引き継ぎ元の月で絞り込む', async () => {
  const { client, calls } = fakeClient([{ proposal_product_id: 'insta' }], null, '2026-08')
  assert.equal(await pickProductForLog(client, ['insta', 'app']), 'insta')
  assert.equal(calls.ym, '2026-08')
})

test('目標が1行も無ければ null（引き継ぎ元が無い）', async () => {
  const { client } = fakeClient([{ proposal_product_id: 'insta' }], null, '')
  assert.equal(await pickProductForLog(client, ['insta', 'app']), null)
})
