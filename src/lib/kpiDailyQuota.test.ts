import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  adjustCumulativeTarget, pacedTarget, quotaDelta, quotaKey, quotaMap,
  todayPortionOf, type KpiDailyQuotaRow,
} from './kpiDailyQuota'

function row(p: Partial<KpiDailyQuotaRow> = {}): KpiDailyQuotaRow {
  return {
    rep_id: 'r1', product_id: 'p1',
    base_sends: 56.8, quota_sends: 56.8, ratio: 1,
    apt_target: 36, apt_left: 36, business_days_left: 19,
    ...p,
  }
}

test('倍率1なら累計目標は変わらない', () => {
  assert.equal(adjustCumulativeTarget(1000, row()), 1000)
})

test('今日のぶんだけ差し替える（前日までは動かさない）', () => {
  // 3営業日目・累計170、今日のぶん56.8 が 120 になる
  const q = row({ quota_sends: 120, ratio: 2.111 })
  assert.equal(Math.round(adjustCumulativeTarget(170.4, q)), 234)
})

test('アポ連動の行が無ければ何もしない（SQL未実行でも壊れない）', () => {
  assert.equal(adjustCumulativeTarget(1000, undefined), 1000)
})

test('目標を下回っても0で止める', () => {
  assert.equal(adjustCumulativeTarget(10, row({ base_sends: 50, quota_sends: 0 })), 0)
})

test('増減は四捨五入して返す', () => {
  assert.equal(quotaDelta(row({ quota_sends: 120 })), 63)
  assert.equal(quotaDelta(row()), 0)
  assert.equal(quotaDelta(undefined), 0)
})

test('担当者×商材で引ける', () => {
  const m = quotaMap([row(), row({ rep_id: 'r2', quota_sends: 99 })])
  assert.equal(m.get(quotaKey('r2', 'p1'))?.quota_sends, 99)
  assert.equal(m.get(quotaKey('r9', 'p1')), undefined)
})

test('quotaMap は null でも空で返る', () => {
  assert.equal(quotaMap(null).size, 0)
})

// アポ連動後の「今日のノルマ」でペース判定する。
// 按分値のままだと、上乗せされた日に半分送っても未達扱いにならない
test('今日のぶんはアポ連動後の値を使う', () => {
  assert.equal(todayPortionOf(170, 3, row({ quota_sends: 120 })), 120)
})

test('アポ連動が無ければ営業日数で割る', () => {
  assert.equal(todayPortionOf(170, 2, undefined), 85)
})

test('営業日数が0でも割り算にならない', () => {
  assert.equal(todayPortionOf(170, 0, undefined), 170)
})

test('12時の判定は今日のぶんだけ半分にする', () => {
  // 累計234・今日のぶん120 → 234 - 120*0.5 = 174
  assert.equal(pacedTarget(234, 120, 0.5), 174)
})

test('17時は満額で見る', () => {
  assert.equal(pacedTarget(234, 120, 1), 234)
})
