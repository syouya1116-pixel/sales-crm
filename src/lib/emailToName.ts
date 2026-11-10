import { TEAM_MEMBERS } from '@/config/team'

export const EMAIL_NAME_MAP: Record<string, string> = Object.fromEntries(
  TEAM_MEMBERS.map(m => [m.email, m.name])
)

// テンプレートの所有者セレクト用。email をキーに持たせたいので配列にして順序を固定する
export const ACCOUNTS = Object.entries(EMAIL_NAME_MAP).map(([email, name]) => ({ email, name }))

// デモの設定画面で営業担当の名前を変えたときの上書き（メール → 名前）。SiteSettingsProvider が入れる
let nameOverrides: Record<string, string> = {}
export function setNameOverrides(map: Record<string, string>) {
  nameOverrides = map
}

export function emailToName(email: string | null | undefined): string {
  if (!email) return ''
  return nameOverrides[email] ?? EMAIL_NAME_MAP[email] ?? email
}

const NAME_EMAIL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(EMAIL_NAME_MAP).map(([email, name]) => [name.replace(/\s+/g, ''), email])
)

// 営業担当名からメールアドレスを引く。CSV取込で送信ログの sent_by を埋めるのに使う。
// 表記ゆれ（全角空白・空白なし）を吸収したいので空白を除いて突き合わせる。
export function nameToEmail(name: string | null | undefined): string | null {
  if (!name) return null
  return NAME_EMAIL_MAP[name.replace(/[\s　]+/g, '')] ?? null
}
