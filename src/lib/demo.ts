// デモ環境（公開用の体験サイト）かどうか。
// NEXT_PUBLIC_DEMO_MODE=1 のときだけ有効になり、未設定なら通常のCRMとまったく同じ動きをする。
//
// デモでは次のように振る舞う:
// - ログイン画面にワンクリックの「デモログイン」を出す（サイトパスワード・Googleログイン不要）
// - Gmail 送信・Google カレンダー連携は外部へ一切送らず、成功したことにして履歴だけ残す
// - データは毎日 /api/demo/reset で架空データに戻る
import { OWNER_EMAIL, TEAM_MEMBERS } from '@/config/team'

export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1'

// デモの管理者としてログインするアカウント（架空）
export const DEMO_ADMIN_EMAIL = OWNER_EMAIL
export const DEMO_ADMIN_NAME = TEAM_MEMBERS[0].name

// デモのスタッフアカウント（架空）。ログイン画面に表示して誰でも入れるようにする
export const DEMO_STAFF_LOGIN_ID = 'demo-staff'
export const DEMO_STAFF_PASSWORD = 'demo-staff-2026'

// 外部に送らなかった送信・予定に付ける識別子
export function demoExternalId(kind: 'mail' | 'event') {
  return `demo-${kind}-${crypto.randomUUID()}`
}
