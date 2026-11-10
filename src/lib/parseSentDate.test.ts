import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSentDate } from './parseSentDate'

// 2026-07-31 12:00 JST を「今日」として固定する
const NOW = new Date('2026-07-31T03:00:00.000Z')

test('年ありの日付を読む', () => {
  assert.equal(parseSentDate('2026-01-07', NOW), '2026-01-07T00:00:00.000Z')
  assert.equal(parseSentDate('2026/1/7', NOW), '2026-01-07T00:00:00.000Z')
  assert.equal(parseSentDate('2026.1.7', NOW), '2026-01-07T00:00:00.000Z')
  assert.equal(parseSentDate('2026年1月7日', NOW), '2026-01-07T00:00:00.000Z')
})

test('年なしは今年として読む', () => {
  assert.equal(parseSentDate('1/7', NOW), '2026-01-07T00:00:00.000Z')
  assert.equal(parseSentDate('1-7', NOW), '2026-01-07T00:00:00.000Z')
  assert.equal(parseSentDate('1月7日', NOW), '2026-01-07T00:00:00.000Z')
})

test('年なしで未来になるなら前年にする', () => {
  // 12/25 は 2026年だとまだ来ていないので 2025年
  assert.equal(parseSentDate('12/25', NOW), '2025-12-25T00:00:00.000Z')
})

// これが今回の不具合そのもの。new Date('1/7') は 2001-01-07 を返し、
// isNaN でも弾けないので 28件の壊れたログができていた
test('年なしを2001年と解釈しない', () => {
  assert.equal(parseSentDate('1/7', NOW), '2026-01-07T00:00:00.000Z')
  assert.notEqual(new Date('1/7').toISOString().slice(0, 4), '2026')
})

test('うしろに時刻が付いていても日付だけ読む', () => {
  assert.equal(parseSentDate('2026-01-07 10:30', NOW), '2026-01-07T00:00:00.000Z')
  assert.equal(parseSentDate('2026-01-07T10:30:00Z', NOW), '2026-01-07T00:00:00.000Z')
})

test('前後の空白を無視する', () => {
  assert.equal(parseSentDate('  2026/1/7  ', NOW), '2026-01-07T00:00:00.000Z')
})

test('読めない値は null', () => {
  assert.equal(parseSentDate('', NOW), null)
  assert.equal(parseSentDate('   ', NOW), null)
  assert.equal(parseSentDate(null, NOW), null)
  assert.equal(parseSentDate(undefined, NOW), null)
  assert.equal(parseSentDate('未送信', NOW), null)
  assert.equal(parseSentDate('令和7年1月7日', NOW), null)
  assert.equal(parseSentDate('26/1/7', NOW), null) // 2桁年は曖昧なので受け付けない
})

test('存在しない日付は null', () => {
  assert.equal(parseSentDate('2026-02-30', NOW), null)
  assert.equal(parseSentDate('2026-13-01', NOW), null)
  assert.equal(parseSentDate('2/30', NOW), null)
})

test('古すぎる・未来すぎる日付は null', () => {
  assert.equal(parseSentDate('1989-12-31', NOW), null)
  assert.equal(parseSentDate('2027-01-01', NOW), null)
})

test('うるう日は年によって通ったり弾かれたりする', () => {
  assert.equal(parseSentDate('2024-02-29', NOW), '2024-02-29T00:00:00.000Z')
  assert.equal(parseSentDate('2025-02-29', NOW), null)
})
