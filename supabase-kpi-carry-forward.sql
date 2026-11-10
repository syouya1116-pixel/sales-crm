-- =============================================================
-- KPI目標を「入れ直すまで前月の設定で走らせる」
-- 2026-08-30 作成。Supabase の SQL Editor で実行する。
--
-- 【何が問題だったか】
-- kpi_targets は担当者×商材×月で1行。行が無い月は目標0として扱う。
-- 9月に入った瞬間、9月の行がまだ無いので目標も日次ノルマも0になり、
-- 目標を入れ直すまで進捗バーが空になる。
--
-- 【どう直すか】
-- kpi_prod の目標取得だけを差し替える。
--   その月に行がある   … 今までどおりその行を使う
--   その月に行が無い   … それ以前で最新の月の行をそのまま使う
--
-- start_day（按分の起点）は引き継がない。「8/25から数え始める」を
-- 9月に持ち越すと按分が壊れるため、引き継いだ行は月初起点に戻す。
-- 按分の起点・終点は「見ている月」で計算する（引き継ぎ元の月ではない）。
--
-- 過去月の数字は変わらない。自分の行を持っている月はそちらが優先されるため。
-- 最初の目標より前の月は、引き継ぎ元が無いので今までどおり0。
--
-- 【貼り付け方】
-- ブロック1は長い。貼ったあと、最後の行が $$; になっているか目視で見る。
-- SQL Editor は長文を貼ると文字が欠けることがある（過去に実例あり）。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：kpi_prod の差し替え
--
-- 変わったのは src（引き継ぎ元の月を決める）と trow（その月から読む）だけ。
-- tr / tg / ss / sent と最後の SELECT は今までと同じ。
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_prod(p_from date, p_to date)
RETURNS TABLE (rep_id uuid, rep_name text, product_id uuid, product_name text,
  target_sends numeric, actual_sends int, start_day date,
  target_apts numeric, target_contracts numeric)
LANGUAGE sql STABLE AS $$
WITH
tc AS (SELECT DISTINCT to_char(d,'YYYY-MM') AS ym FROM kpi_bdays(p_from,p_to) d),
src AS (
  SELECT c.ym,
    COALESCE(
      (SELECT k.year_month FROM kpi_targets k WHERE k.year_month = c.ym LIMIT 1),
      (SELECT max(k.year_month) FROM kpi_targets k WHERE k.year_month < c.ym)
    ) uym
  FROM tc c),
trow AS (
  SELECT t.sales_rep_id rid, t.proposal_product_id pid, v.ym ym,
    CASE WHEN v.uym = v.ym THEN t.start_day END sd,
    t.target_contracts n,
    t.appointments_per_contract apc, t.sends_per_appointment spa,
    COALESCE(CASE WHEN v.uym = v.ym THEN t.start_day END, (v.ym||'-01')::date) s,
    ((v.ym||'-01')::date + interval '1 month')::date - 1 e
  FROM src v JOIN kpi_targets t ON t.year_month = v.uym),
tr AS (SELECT x.*, kpi_ratio(x.s, x.e, p_from, p_to) r FROM trow x),
tg AS (SELECT rid, pid, min(sd) sd, sum(n*r) c, sum(n*apc*r) a,
  sum(n*apc*spa*r) snd FROM tr GROUP BY 1,2),
ss AS (SELECT rid, pid, ym, s FROM tr WHERE sd IS NOT NULL),
sent AS (
  SELECT sr.id rid, l.proposal_product_id pid, count(*)::int n
  FROM email_logs l
  JOIN sales_reps sr ON sr.email = l.sent_by
  LEFT JOIN ss ON ss.rid = sr.id AND ss.pid = l.proposal_product_id
    AND ss.ym = to_char(l.sent_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM')
  WHERE l.sent_at >= (p_from::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND l.sent_at < ((p_to+1)::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND (ss.s IS NULL OR l.sent_at >= (ss.s::timestamp AT TIME ZONE 'Asia/Tokyo'))
  GROUP BY 1,2)
SELECT sr.id, sr.name, pp.id, pp.name,
  COALESCE(t.snd,0), COALESCE(s.n,0), t.sd,
  COALESCE(t.a,0), COALESCE(t.c,0)
FROM sales_reps sr
CROSS JOIN proposal_products pp
LEFT JOIN tg t ON t.rid = sr.id AND t.pid = pp.id
LEFT JOIN sent s ON s.rid = sr.id AND s.pid = pp.id
WHERE COALESCE(t.snd,0) > 0 OR COALESCE(s.n,0) > 0;
$$;


-- ---------------------------------------------------------------
-- ブロック2：実行権限
--
-- CREATE OR REPLACE では権限は消えないが、念のため流し直す
-- ---------------------------------------------------------------

GRANT EXECUTE ON FUNCTION kpi_prod(date, date) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 確認用
-- ---------------------------------------------------------------
-- 8月の数字が変わっていないこと（8月は自分の行を持っている）
-- SELECT kpi_progress('2026-08-01','2026-08-31') -> 'rep_rows';
--
-- 9月が8月の設定を引き継いでいること（実行前は空、実行後は目標が乗る）
-- SELECT kpi_progress('2026-09-01','2026-09-30') -> 'rep_rows';
--
-- 引き継ぎ元の月を確かめる
-- SELECT year_month, count(*) FROM kpi_targets GROUP BY 1 ORDER BY 1;
