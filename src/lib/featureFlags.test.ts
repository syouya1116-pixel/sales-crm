import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canUseResendFilter, RESEND_ALLOWED_EMAILS } from './featureFlags'

describe('canUseResendFilter', () => {
  it('許可リストに入っているメールは true', () => {
    assert.equal(canUseResendFilter('yamada@example.com'), true)
  })

  it('許可リストに無いメールは false', () => {
    assert.equal(canUseResendFilter('suzuki@example.com'), false)
  })

  it('メールが取れないときは false（判定前に一瞬出さない）', () => {
    assert.equal(canUseResendFilter(null), false)
    assert.equal(canUseResendFilter(undefined), false)
    assert.equal(canUseResendFilter(''), false)
  })

  it('大文字・前後の空白が混ざっても判定できる', () => {
    assert.equal(canUseResendFilter(' Yamada@Example.com '), true)
  })

  it('許可リストは小文字で持つ（大文字が混ざると照合が壊れる）', () => {
    for (const e of RESEND_ALLOWED_EMAILS) assert.equal(e, e.toLowerCase())
  })
})
