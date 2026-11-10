import type { SupabaseClient } from '@supabase/supabase-js'

/** JST の「YYYY-MM」。kpi_targets.year_month と同じ形式 */
export function currentYearMonthJst(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date())
}

/**
 * 目標として実際に使われている年月を返す。
 *
 * その月の行が無ければ、それ以前で最新の月の設定がそのまま生き続ける。
 * DB側（kpi_prod）が同じ引き継ぎをしているので、ここだけ「今月」で固定すると
 * 月初に目標を入れ直すまでのあいだ、進捗は出ているのに送信ログの商材だけが
 * 静かに NULL で記録される。引き継ぎ元は必ず両方で揃えること。
 *
 * 行が1つも無ければ null（＝商材を決めない）。
 */
export async function effectiveTargetYearMonth(
  client: SupabaseClient,
  yearMonth: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('kpi_targets')
    .select('year_month')
    .lte('year_month', yearMonth)
    .order('year_month', { ascending: false })
    .limit(1)

  if (error || !data) return null
  const rows = data as { year_month: string }[]
  return rows.length > 0 ? rows[0].year_month : null
}

/**
 * 送信ログ（email_logs.proposal_product_id）に残す商材を、候補の中から1つに絞る。
 *
 * 候補が1つならそれ。複数のときは「適用中のKPI目標が入っている商材」だけに絞り直して、
 * それでも1つに決まらなければ null を返す。
 * 「適用中」は今月の行があれば今月、無ければ引き継ぎ元の月（effectiveTargetYearMonth）。
 *
 * 顧客の提案商材には「後々送るかもしれない商材」にもチェックを入れる運用がある。
 * 複数持ちというだけで諦めると、送信実績が商材別集計から丸ごと漏れて
 * 警告バーの残り件数が減らなくなる。目標の無い商材はそもそも集計対象外なので、
 * 候補から外しても数字は動かない。
 *
 * それでも決まらないときに適当な1つを選ばないのは、別商材で送ったぶんが
 * 他商材の実績として静かに数えられるほうが被害が大きいため。
 */
export async function pickProductForLog(
  client: SupabaseClient,
  productIds: string[],
): Promise<string | null> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return null
  if (ids.length === 1) return ids[0]

  const yearMonth = await effectiveTargetYearMonth(client, currentYearMonthJst())
  if (!yearMonth) return null

  const { data, error } = await client
    .from('kpi_targets')
    .select('proposal_product_id')
    .eq('year_month', yearMonth)
    .in('proposal_product_id', ids)
    .gt('target_contracts', 0)

  if (error || !data) return null

  // 目標は担当者×商材×月で入るので、同じ商材の行が担当者の数だけ出る
  const targeted = [...new Set(
    (data as { proposal_product_id: string }[]).map(r => r.proposal_product_id),
  )]
  return targeted.length === 1 ? targeted[0] : null
}

/**
 * 顧客の持ち商材から、送信ログに残す商材を推定する。
 * 画面で商材を選ばせていない経路（新規登録時のフォーム送信チェックなど）の既定値。
 */
export async function soleProposalProductId(
  client: SupabaseClient,
  companyId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('company_proposal_products')
    .select('proposal_product_id')
    .eq('company_id', companyId)

  if (error || !data) return null
  return pickProductForLog(
    client,
    (data as { proposal_product_id: string }[]).map(r => r.proposal_product_id),
  )
}
