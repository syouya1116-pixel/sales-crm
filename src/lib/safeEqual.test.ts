import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeEqual, tooManyAttempts } from './safeEqual'

test('safeEqual: 一致・不一致', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abd', 'abc'), false)
  assert.equal(safeEqual('abcd', 'abc'), false)
})

test('safeEqual: 正解側が未設定・空なら必ず false', () => {
  assert.equal(safeEqual(undefined, undefined), false)
  assert.equal(safeEqual('', ''), false)
  assert.equal(safeEqual('x', undefined), false)
  assert.equal(safeEqual('x', ''), false)
})

test('safeEqual: 文字列以外は false', () => {
  assert.equal(safeEqual(null, 'abc'), false)
  assert.equal(safeEqual(123, '123'), false)
  assert.equal(safeEqual({}, 'abc'), false)
})

test('tooManyAttempts: max 回までは通し、超えたら止め、時間が過ぎたら戻る', () => {
  const key = 'test-' + Math.random()
  const t0 = 1_000_000
  for (let i = 0; i < 3; i++) assert.equal(tooManyAttempts(key, 3, 1000, t0), false)
  assert.equal(tooManyAttempts(key, 3, 1000, t0 + 10), true)
  assert.equal(tooManyAttempts(key, 3, 1000, t0 + 1001), false)
})
