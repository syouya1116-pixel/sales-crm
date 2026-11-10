import { OWNER_EMAIL } from '@/config/team'

// 機能ごとの「誰に見せるか」。
// DBの feature_flags は「機能そのものを開けるか」のトグルで、こちらは公開範囲。
// 両方を満たしたときだけ画面に出す。
//
// 再送（送信履歴での絞り込み）は一旦 責任者のアカウントだけに開けている。
// 全員に開けるときは RESEND_ALLOWED_EMAILS を空配列にするだけでよい。
export const RESEND_ALLOWED_EMAILS: string[] = [OWNER_EMAIL]

// 空配列 = 制限なし（feature_flags のトグルどおり全員に出す）。
// メールが取れないうちは false を返して、判定前に一瞬出てしまうのを防ぐ。
export function canUseResendFilter(email: string | null | undefined): boolean {
  if (RESEND_ALLOWED_EMAILS.length === 0) return true
  if (!email) return false
  return RESEND_ALLOWED_EMAILS.includes(email.trim().toLowerCase())
}
