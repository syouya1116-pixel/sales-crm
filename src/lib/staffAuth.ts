import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

// 業務委託スタッフのパスワードハッシュ化（Node標準のscryptを使用・追加パッケージ不要）
const KEYLEN = 64

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEYLEN).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const hashBuf = Buffer.from(hash, 'hex')
  const testBuf = scryptSync(password, salt, KEYLEN)
  if (hashBuf.length !== testBuf.length) return false
  return timingSafeEqual(hashBuf, testBuf)
}
