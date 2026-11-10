import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allocateCarry, carryDone, carryLeft, usesDailyCarry, type CarryDay } from './kpiCarry'

// 9月の鈴木（今月ぶん1080 + 繰越103 = 月間目標1183）で確かめる
const CARRY = 103

test('今月ぶんを送り切るまでは繰り越しは減らない', () => {
  // 実績620通 → 月間残り563
  assert.equal(carryLeft(CARRY, 563), 103)
  // 実績1079通 → 月間残り104。あと1通で今月ぶんが終わる
  assert.equal(carryLeft(CARRY, 104), 103)
})

test('今月ぶんを送り切った時点から減り始める', () => {
  // 実績1080通 → 月間残り103。ここが境目
  assert.equal(carryLeft(CARRY, 103), 103)
  // 実績1100通 → 月間残り83
  assert.equal(carryLeft(CARRY, 83), 83)
})

test('月間目標に届けば0になる', () => {
  assert.equal(carryLeft(CARRY, 0), 0)
  assert.equal(carryDone(CARRY, 0), true)
})

test('目標を超えて送ってもマイナスにはならない', () => {
  assert.equal(carryLeft(CARRY, -50), 0)
})

test('繰り越しが無い担当者は常に0', () => {
  assert.equal(carryLeft(0, 500), 0)
  assert.equal(carryDone(0, 0), false)
})

test('月間ぶんが取れないときは満額を出す（消化済みに見せない）', () => {
  assert.equal(carryLeft(CARRY, undefined), 103)
  assert.equal(carryDone(CARRY, undefined), false)
})

// ---- 2026-10 からの充て方（その日のノルマを超えたぶんから繰り越しが減る）

// 1日50通・繰り越し100通。アポ調整なし
const day = (sent: number, quota = 50, base = 50): CarryDay => ({ day: '', base, quota, sent })

test('10月からだけ日ごとの充て方に切り替わる', () => {
  assert.equal(usesDailyCarry('2026-09'), false)
  assert.equal(usesDailyCarry('2026-10'), true)
  assert.equal(usesDailyCarry('2027-01'), true)
})

test('その日のノルマを超えたぶんで繰り越しが減る', () => {
  const r = allocateCarry(100, [day(80)])
  assert.equal(r.carryLeft, 70)
  assert.equal(r.due, 50)
  assert.equal(r.paid, 50)
})

test('ノルマに届かない日は繰り越しは減らない', () => {
  const r = allocateCarry(100, [day(30)])
  assert.equal(r.carryLeft, 100)
  assert.equal(r.due - r.paid, 20)
})

test('一度減った繰り越しは翌日に足りなくても戻らない', () => {
  // 1日目80通で繰越70。2日目30通 → 今日の残り20、繰越は70のまま
  const r = allocateCarry(100, [day(80), day(30)])
  assert.equal(r.carryLeft, 70)
  assert.equal(r.due - r.paid, 20)
})

test('前日の不足は翌日の超過から先に埋める', () => {
  // 1日目30通（20不足）。2日目100通 → まず今月ぶん70、残り30で繰越が減る
  const r = allocateCarry(100, [day(30), day(100)])
  assert.equal(r.carryLeft, 70)
  assert.equal(r.due - r.paid, 0)
})

test('繰り越しを消化し切ったあとの超過は先行ぶんになる', () => {
  const r = allocateCarry(30, [day(100)])
  assert.equal(r.carryLeft, 0)
  assert.equal(r.paid - r.due, 20)
})

test('休業日に送ったぶんはそのまま繰り越しを減らす', () => {
  const r = allocateCarry(100, [day(50), day(20, 0, 0)])
  assert.equal(r.carryLeft, 80)
})

test('アポ調整の上乗せは当日だけで、翌日には持ち越さない', () => {
  // 1日目はノルマ80（基準50＋アポ30）で60通 → 今月ぶんに60、繰越は減らない
  // 2日目は基準どおり50。届いていてほしい累計は 50 + 50 = 100
  const r = allocateCarry(100, [day(60, 80), day(40)])
  assert.equal(r.due, 100)
  assert.equal(r.paid, 100)
  assert.equal(r.carryLeft, 100)
})
