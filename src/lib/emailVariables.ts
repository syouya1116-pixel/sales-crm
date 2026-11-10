/**
 * 差し込み変数の展開と、営業担当に対応したテンプレートの自動選択。
 *
 * ※ 同じ展開処理が bulk-send/page.tsx にもあるが、あちらは本番で毎日使う画面のため
 *   今回は触らずそのままにしている（[[project_crm]] の「あえて分割しなかったもの」）。
 */

export type TemplateVars = {
  companyName: string
  representativeName: string
  serviceName: string
  genreName: string
  salesRepName: string
}

export function applyVariables(text: string, v: TemplateVars): string {
  return text
    .replace(/{{会社名}}/g, v.companyName || '')
    .replace(/{{代表者名}}/g, v.representativeName || '')
    .replace(/{{サービス名}}/g, v.serviceName || '')
    .replace(/{{ジャンル名}}/g, v.genreName || '')
    .replace(/{{担当者名}}/g, v.salesRepName || '')
}

export type PickableTemplate = { id: string; name: string; subject: string; body: string }

/**
 * 顧客の営業担当に対応したテンプレートを名前で拾う。
 *
 * 「山田 太郎」→ 姓の「山田」を含むテンプレート（＝「インスタ山田」）を選ぶ。
 * テンプレート名から姓を消すと選べなくなるので、画面側で
 * 「適用中: インスタ山田」と出して取り違えに気づけるようにしてある。
 */
export function pickTemplateForRep(
  templates: PickableTemplate[],
  salesRepName: string,
): PickableTemplate | null {
  const surname = (salesRepName || '').trim().split(/[\s　]+/)[0]
  if (!surname) return null
  return templates.find(t => t.name.includes(surname)) ?? null
}
