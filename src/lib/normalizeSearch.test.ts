import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSearch, buildIlikePattern, getSearchVariants } from './normalizeSearch.ts'

// 顧客検索の表記ゆれ吸収。ここが壊れると「登録済みの顧客が検索で出てこない」
// →二重登録につながるので、過去に実際あった検索漏れのケースを残している。

describe('normalizeSearch', () => {
  test('前後の空白を落として連続スペースを1つにまとめる', () => {
    assert.equal(normalizeSearch('  FRANK   PRODUCTS  '), 'FRANK PRODUCTS')
  })

  test('全角スペースも半角スペース1つになる', () => {
    assert.equal(normalizeSearch('トップ　ゴルフ'), 'トップ ゴルフ')
  })

  test('全角英数字を半角にする', () => {
    assert.equal(normalizeSearch('ＦＲＡＮＫ１２３'), 'FRANK123')
  })

  test('半角カタカナを全角カタカナにする', () => {
    assert.equal(normalizeSearch('ｱｲｳｴｵ'), 'アイウエオ')
    assert.equal(normalizeSearch('ｺﾝｻﾙ'), 'コンサル')
  })

  // 2026-07-26 修正。合成しないと「ﾄｯﾌﾟ」が「トッフﾟ」になり検索から漏れていた
  test('半角カタカナの濁点・半濁点を合成する', () => {
    assert.equal(normalizeSearch('ﾄｯﾌﾟ'), 'トップ')
    assert.equal(normalizeSearch('ｺﾞﾙﾌ'), 'ゴルフ')
    assert.equal(normalizeSearch('ﾄｯﾌﾟｺﾞﾙﾌ'), 'トップゴルフ')
    assert.equal(normalizeSearch('ｳﾞｨﾚｯｼﾞ'), 'ヴィレッジ')
  })

  test('半角カナ入力が全角カナ入力と同じ結果になる', () => {
    assert.equal(normalizeSearch('ｻﾝﾌﾟﾙ'), normalizeSearch('サンプル'))
    assert.equal(normalizeSearch('ﾊﾟﾝﾌﾟｷﾝ'), normalizeSearch('パンプキン'))
  })

  test('濁点の付かないカナに濁点が来ても壊さない', () => {
    assert.equal(normalizeSearch('ｱﾞ'), 'ア゛')
  })

  test('（株）・(株)・㈱ はすべて「株式会社」に揃う（ひらがな部分はカタカナ化される）', () => {
    assert.equal(normalizeSearch('（株）さんぷる'), '株式会社サンプル')
    assert.equal(normalizeSearch('(株)さんぷる'), '株式会社サンプル')
    assert.equal(normalizeSearch('㈱さんぷる'), '株式会社サンプル')
  })

  test('ひらがなはカタカナに統一する', () => {
    assert.equal(normalizeSearch('さんぷる'), 'サンプル')
  })

  test('ひらがな入力とカタカナ入力が同じ結果になる', () => {
    assert.equal(normalizeSearch('とっぷごるふ'), normalizeSearch('トップゴルフ'))
  })

  test('空文字・空白のみは空文字', () => {
    assert.equal(normalizeSearch(''), '')
    assert.equal(normalizeSearch('　  '), '')
  })
})

describe('buildIlikePattern', () => {
  test('スペースを % にしてワイルドカードで挟む', () => {
    assert.equal(buildIlikePattern('FRANK PRODUCTS'), '%FRANK%PRODUCTS%')
  })

  test('単語1つでも前後に % が付く', () => {
    assert.equal(buildIlikePattern('サンプル'), '%サンプル%')
  })

  test('空文字でも %% になる（全件ヒットするので呼び出し側で空チェックすること）', () => {
    assert.equal(buildIlikePattern(''), '%%')
  })

  test('normalizeSearch と繋ぐと「トップゴルフ」で「トップ ゴルフ」を拾える形になる', () => {
    assert.equal(buildIlikePattern(normalizeSearch('トップ ゴルフ')), '%トップ%ゴルフ%')
  })
})

describe('getSearchVariants', () => {
  test('英数字は半角と全角の両方を返す', () => {
    const variants = getSearchVariants('FRANK')
    assert.ok(variants.includes('FRANK'))
    assert.ok(variants.includes('ＦＲＡＮＫ'))
  })

  test('カタカナはひらがなも返す', () => {
    const variants = getSearchVariants('サンプル')
    assert.ok(variants.includes('サンプル'))
    assert.ok(variants.includes('さんぷる'))
  })

  test('ひらがな入力でもカタカナ・ひらがな両方を返す', () => {
    const variants = getSearchVariants('さんぷる')
    assert.ok(variants.includes('サンプル'))
    assert.ok(variants.includes('さんぷる'))
  })

  test('変換しても変わらない文字列は1件だけ返す（重複させない）', () => {
    assert.deepEqual(getSearchVariants('株式会社'), ['株式会社'])
  })

  test('空文字は空配列（OR検索を組み立てないため）', () => {
    assert.deepEqual(getSearchVariants(''), [])
    assert.deepEqual(getSearchVariants('  　'), [])
  })
})
