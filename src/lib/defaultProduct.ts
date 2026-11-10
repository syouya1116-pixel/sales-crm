// 集計ページ・KPI進捗を開いた直後に表示する商材。
//
// 主力商材なので、絞り込みなし（全商材）で開くより最初からこれを出したほうが
// 見たい数字にすぐ辿り着ける、という運用上の理由で既定にしている。
// 商材名で引くのは form-queue / CompanyForm の Instagram 固定と同じやり方。

export const DEFAULT_PRODUCT_NAME = 'Instagram'

/**
 * マスタから既定の商材IDを探す。
 * 見つからなければ null＝「全商材」にフォールバックする
 * （商材名を変えたり消したりしても画面が壊れないように）。
 */
export function defaultProductId(
  products: { id: string; name: string }[],
): string | null {
  return products.find(p => p.name === DEFAULT_PRODUCT_NAME)?.id ?? null
}
