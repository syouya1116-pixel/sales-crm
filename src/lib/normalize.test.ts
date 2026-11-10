import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  toHalfWidth,
  normalizeEmail,
  normalizePhone,
  normalizeUrl,
  normalizeCompanyName,
  normalizeCompanyNameStrict,
  sanitizeEmailForSave,
  sanitizeForSave,
  isPhoneSearchable,
} from './normalize.ts'

// ここが壊れると「重複が素通りする」「無関係な顧客を重複扱いして登録できなくなる」
// のどちらかが静かに起きる。過去に実際どちらも起きているので、実データ由来の
// ケースを中心にテストしている。

describe('toHalfWidth', () => {
  test('全角英数字を半角にする', () => {
    assert.equal(toHalfWidth('ＡＢＣａｂｃ０１２'), 'ABCabc012')
  })

  test('日本語や記号はそのまま', () => {
    assert.equal(toHalfWidth('株式会社テスト＆Ｃｏ'), '株式会社テスト＆Co')
  })

  test('全角ハイフンは対象外（電話の正規化で別途落とす）', () => {
    assert.equal(toHalfWidth('０３－１２３４'), '03－1234')
  })
})

describe('normalizeEmail', () => {
  test('全角・大文字・前後スペースを吸収して同じ値になる', () => {
    assert.equal(normalizeEmail(' ＡＢＣ@Example.COM '), 'abc@example.com')
    assert.equal(normalizeEmail('abc@example.com'), 'abc@example.com')
  })

  test('全角スペースも除去する', () => {
    assert.equal(normalizeEmail('abc　@　example.com'), 'abc@example.com')
  })

  test('途中のスペースも除去する（コピペ由来の混入対策）', () => {
    assert.equal(normalizeEmail('info @ example.com'), 'info@example.com')
  })

  test('空文字は空文字', () => {
    assert.equal(normalizeEmail(''), '')
  })
})

describe('normalizePhone', () => {
  test('ハイフン有無・括弧を無視して同じ値になる', () => {
    assert.equal(normalizePhone('03-1234-5678'), '0312345678')
    assert.equal(normalizePhone('0312345678'), '0312345678')
    assert.equal(normalizePhone('(03) 1234-5678'), '0312345678')
  })

  test('全角数字・全角ハイフンを吸収する', () => {
    assert.equal(normalizePhone('０３－１２３４－５６７８'), '0312345678')
  })

  test('国番号の + は残す', () => {
    assert.equal(normalizePhone('+81-3-1234-5678'), '+81312345678')
  })

  test('数字が一切ないと空文字になる（RPCに渡すと全件ヒットするので危険）', () => {
    assert.equal(normalizePhone('担当者に確認'), '')
  })
})

describe('normalizeUrl', () => {
  test('プロトコル・www・末尾スラッシュの違いを吸収する', () => {
    const expected = 'example.co.jp'
    assert.equal(normalizeUrl('https://www.example.co.jp/'), expected)
    assert.equal(normalizeUrl('http://example.co.jp'), expected)
    assert.equal(normalizeUrl('WWW.EXAMPLE.CO.JP'), expected)
    assert.equal(normalizeUrl('https://example.co.jp///'), expected)
  })

  test('パスは残す（別ページを同一URL扱いしない）', () => {
    assert.equal(normalizeUrl('https://example.co.jp/contact'), 'example.co.jp/contact')
    assert.notEqual(normalizeUrl('https://example.co.jp/contact'), normalizeUrl('https://example.co.jp/about'))
  })

  test('全角で入力されたURLを吸収する', () => {
    assert.equal(normalizeUrl('ｈｔｔｐｓ：／／ｗｗｗ．ｅｘａｍｐｌｅ．ｃｏ．ｊｐ／'), 'example.co.jp')
  })

  test('www は先頭のみ落とす（サブドメインの www を含む語は壊さない）', () => {
    assert.equal(normalizeUrl('https://shop.www.example.com'), 'shop.www.example.com')
  })

  test('空文字は空文字（呼び出し側でスキップ判定に使っている）', () => {
    assert.equal(normalizeUrl('   '), '')
  })
})

describe('normalizeCompanyName', () => {
  test('主要な法人格を除去する', () => {
    assert.equal(normalizeCompanyName('株式会社さんぷる'), 'さんぷる')
    assert.equal(normalizeCompanyName('合同会社テスト'), 'テスト')
    assert.equal(normalizeCompanyName('有限会社テスト'), 'テスト')
    assert.equal(normalizeCompanyName('一般社団法人テスト'), 'テスト')
    assert.equal(normalizeCompanyName('NPO法人テスト'), 'テスト')
  })

  test('後株でも除去する', () => {
    assert.equal(normalizeCompanyName('さんぷる株式会社'), 'さんぷる')
  })

  test('スペースは残る（完全一致照合には Strict を使うこと）', () => {
    assert.equal(normalizeCompanyName('株式会社トップ ゴルフ'), 'トップ ゴルフ')
  })
})

describe('normalizeCompanyNameStrict', () => {
  test('法人格・スペース・大文字小文字の違いをすべて吸収する', () => {
    const expected = 'トップゴルフ'
    assert.equal(normalizeCompanyNameStrict('株式会社トップ ゴルフ'), expected)
    assert.equal(normalizeCompanyNameStrict('トップ　ゴルフ'), expected)
    assert.equal(normalizeCompanyNameStrict('トップゴルフ株式会社'), expected)
  })

  test('英字は小文字に揃う', () => {
    assert.equal(normalizeCompanyNameStrict('株式会社 Sample Co'), 'sampleco')
  })
})

describe('sanitizeEmailForSave', () => {
  test('全角とスペースは直すが大文字は保存時に残す（表示用）', () => {
    assert.equal(sanitizeEmailForSave(' Ｉｎｆｏ@Example.com '), 'Info@Example.com')
  })

  test('照合用の normalizeEmail とは結果が違う', () => {
    const input = 'Info@Example.com'
    assert.equal(sanitizeEmailForSave(input), 'Info@Example.com')
    assert.equal(normalizeEmail(input), 'info@example.com')
  })
})

describe('sanitizeForSave', () => {
  test('全角を半角にして前後の空白だけ落とす', () => {
    assert.equal(sanitizeForSave(' ０３－１２３４－５６７８ '), '03－1234－5678')
  })

  test('途中のスペースは残す（住所や会社名で意味を持つため）', () => {
    assert.equal(sanitizeForSave('TOP GOLF'), 'TOP GOLF')
  })
})

describe('isPhoneSearchable', () => {
  test('6桁以上なら照合してよい', () => {
    assert.equal(isPhoneSearchable('0312345678'), true)
    assert.equal(isPhoneSearchable('123456'), true)
  })

  test('6桁未満は照合しない（部分一致で無関係な顧客に大量ヒットするため）', () => {
    assert.equal(isPhoneSearchable('12345'), false)
    assert.equal(isPhoneSearchable('03'), false)
  })

  test('空文字は必ず false（RPCに渡すと全件ヒットして全員が重複扱いになる）', () => {
    assert.equal(isPhoneSearchable(''), false)
  })

  test('+ は桁数に数えない', () => {
    assert.equal(isPhoneSearchable('+81312'), false)
    assert.equal(isPhoneSearchable('+813123'), true)
  })
})
