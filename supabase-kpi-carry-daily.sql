-- =============================================================
-- 繰り越しの消化を「その日のノルマを送り切ったあとの超過ぶん」で数える
-- 2026-09-29 作成。2026-10 から画面側で使う（9月以前の表示は変わらない）。
-- supabase-kpi-daily-quota.sql を流したあとに実行する。新規の関数を足すだけで、
-- 既存の関数（kpi_prod / kpi_progress / kpi_carry / kpi_daily_quota）は触らない。
--
-- 【仕様（2026-09-29 合意・案A）】
--   ・送った分は、まずその日までのノルマ（今月ぶん）に充てる
--   ・その日のノルマを超えたぶんから繰り越しを減らす
--   ・一度減った繰り越しは、翌日以降に今月ぶんが足りなくなっても戻さない
--   ・繰り越しを消化し切ったあとの超過は、今までどおり翌日以降の先行ぶんになる
--
-- 「戻さない」を満たすには1日ずつ順に充てていく必要があるので、
-- ここでは日ごとの材料（その日のノルマ・基準値・送信数）だけを返し、
-- 充て方の計算は画面側（src/lib/kpiCarry.ts の allocateCarry）でやる。
--
-- 【ノルマの値】
-- kpi_daily_quota をその日ごとに呼ぶ。アポは作成日時で朝に確定させているので、
-- 過去の日を指定しても当日に見えていたノルマがそのまま再現できる。
-- 月の途中から数え始めた商材（start_day）は、その日より前を0にする。
--
-- 【戻し方】
-- DROP FUNCTION kpi_carry_days(date); を流せば消える。画面は取得に失敗すると
-- 今までの計算（今月ぶんを送り切ってから減る）で表示するので止まらない。
-- =============================================================

CREATE OR REPLACE FUNCTION kpi_carry_days(p_date date)
RETURNS TABLE (d_rid uuid, d_pid uuid, d_day date,
  d_base numeric, d_quota numeric, d_sent int)
LANGUAGE sql STABLE AS $$
WITH
m AS (
  SELECT date_trunc('month', p_date)::date d1, to_char(p_date,'YYYY-MM') ym),
src AS (
  SELECT m.d1, m.ym,
    COALESCE(
      (SELECT k.year_month FROM kpi_targets k WHERE k.year_month = m.ym LIMIT 1),
      (SELECT max(k.year_month) FROM kpi_targets k WHERE k.year_month < m.ym)
    ) uym
  FROM m),
st AS (
  SELECT t.sales_rep_id rid, t.proposal_product_id pid,
    COALESCE(CASE WHEN v.uym = v.ym THEN t.start_day END, v.d1) s
  FROM src v JOIN kpi_targets t ON t.year_month = v.uym),
ds AS (
  SELECT d::date dy FROM src v,
    generate_series(v.d1, p_date, '1 day'::interval) d),
q AS (
  SELECT ds.dy, k.q_rid rid, k.q_pid pid, k.q_base b, k.q_quota qt
  FROM ds CROSS JOIN LATERAL kpi_daily_quota(ds.dy) k),
act AS (
  SELECT sr.id rid, l.proposal_product_id pid,
    (l.sent_at AT TIME ZONE 'Asia/Tokyo')::date sday, count(*)::int n
  FROM email_logs l JOIN sales_reps sr ON sr.email = l.sent_by
  CROSS JOIN src v
  WHERE l.sent_at >= (v.d1::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND l.sent_at < ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Tokyo')
  GROUP BY 1,2,3)
SELECT q.rid, q.pid, q.dy,
  CASE WHEN q.dy < s.s THEN 0 ELSE q.b END,
  CASE WHEN q.dy < s.s THEN 0 ELSE q.qt END,
  CASE WHEN q.dy < s.s THEN 0 ELSE COALESCE(a.n, 0) END
FROM q
JOIN st s ON s.rid = q.rid AND s.pid = q.pid
LEFT JOIN act a ON a.rid = q.rid AND a.pid = q.pid AND a.sday = q.dy
ORDER BY 1, 2, 3;
$$;

GRANT EXECUTE ON FUNCTION kpi_carry_days(date) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 確認用
-- ---------------------------------------------------------------
-- 9月の鈴木の日ごとの材料
-- SELECT sr.name, pp.name, d.*
-- FROM kpi_carry_days('2026-09-29') d
-- JOIN sales_reps sr ON sr.id = d.d_rid
-- JOIN proposal_products pp ON pp.id = d.d_pid
-- ORDER BY 1, 2, d.d_day;
