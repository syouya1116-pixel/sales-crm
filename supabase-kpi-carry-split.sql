-- =============================================================
-- Instagram と 商材B を 50:50 に分ける（2026-10-01 作成）
--
-- 【やること】
-- 1. 10月の契約目標を担当ごとに Instagram 4件・商材B 5件にする
--    （今までの Instagram 9件を半分に。奇数の繰り上げは 商材B）
-- 2. 9月までの繰り越しも半分ずつに分ける（繰り上げは 商材B）
--
-- 【繰り越しの起点（kpi_carry_base）】
-- kpi_carry は 2026-08 からの累計を商材ごとに出すので、10月の値だけを
-- 書き換えることができない。そこで「この月に乗る繰り越しはこの額」という
-- 起点を置き、起点がある担当×商材はそこから数える。
-- 起点より前の月は見ないので、鈴木の8月の 商材B14通（目標0件の月）が
-- 10月以降の貯金に化けることもなくなる。
-- 11月以降は起点＋10月からの（目標 − 実績）の累計。マイナスにしないのは今までどおり。
--
-- 【変わらないところ】
-- kpi_carry の返す列は同じ（CREATE OR REPLACE でよい。kpi_prod は触らない）。
-- 起点が無い担当×商材は今までと同じ計算。
--
-- 戻し方：
--   DELETE FROM kpi_targets WHERE year_month = '2026-10';
--   DROP TABLE kpi_carry_base;
--   supabase-kpi-carry-apo.sql の kpi_carry を流し直す
-- =============================================================

CREATE TABLE IF NOT EXISTS kpi_carry_base (
  year_month text NOT NULL,
  sales_rep_id uuid NOT NULL,
  proposal_product_id uuid NOT NULL REFERENCES proposal_products(id),
  amount numeric NOT NULL CHECK (amount >= 0),
  UNIQUE (year_month, sales_rep_id, proposal_product_id)
);

ALTER TABLE kpi_carry_base ENABLE ROW LEVEL SECURITY;

-- 書き込みは SQL からだけ。画面からは読むだけ
DROP POLICY IF EXISTS authenticated_read ON kpi_carry_base;
CREATE POLICY authenticated_read ON kpi_carry_base
  FOR SELECT TO authenticated USING (true);


CREATE OR REPLACE FUNCTION kpi_carry(p_ym text)
RETURNS TABLE (c_rid uuid, c_pid uuid, c_amt numeric)
LANGUAGE sql STABLE AS $$
WITH
ms AS (
  SELECT to_char(d,'YYYY-MM') ym
  FROM generate_series('2026-08-01'::date, ((p_ym||'-01')::date - 1),
                       '1 month'::interval) d),
src AS (
  SELECT m.ym,
    COALESCE(
      (SELECT k.year_month FROM kpi_targets k WHERE k.year_month = m.ym LIMIT 1),
      (SELECT max(k.year_month) FROM kpi_targets k WHERE k.year_month < m.ym)
    ) uym
  FROM ms m),
tgt AS (
  SELECT t.sales_rep_id rid, t.proposal_product_id pid, v.ym ym,
    t.target_contracts * t.appointments_per_contract * t.sends_per_appointment n,
    COALESCE(CASE WHEN v.uym = v.ym THEN t.start_day END, (v.ym||'-01')::date) s
  FROM src v JOIN kpi_targets t ON t.year_month = v.uym),
-- 各月の最終営業日のアポ調整の上乗せ分
lb AS (
  SELECT m.ym, (SELECT max(b.day) FROM kpi_bdays((m.ym||'-01')::date,
      ((m.ym||'-01')::date + interval '1 month')::date - 1) AS b(day)) ld
  FROM ms m WHERE m.ym >= '2026-09'),
exm AS (
  SELECT q.q_rid rid, q.q_pid pid, l.ym, q.q_quota - q.q_base x
  FROM lb l CROSS JOIN LATERAL kpi_daily_quota(l.ld) q
  WHERE l.ld IS NOT NULL AND q.q_quota > q.q_base),
act AS (
  SELECT sr.id rid, l.proposal_product_id pid,
    (l.sent_at AT TIME ZONE 'Asia/Tokyo')::date sday
  FROM email_logs l JOIN sales_reps sr ON sr.email = l.sent_by
  WHERE l.sent_at >= '2026-08-01 00:00+09'::timestamptz),
per AS (
  SELECT t.rid, t.pid, t.ym, min(t.n) + COALESCE(min(e.x), 0) n, count(a.rid) a
  FROM tgt t
  LEFT JOIN exm e ON e.rid = t.rid AND e.pid = t.pid AND e.ym = t.ym
  LEFT JOIN act a ON a.rid = t.rid AND a.pid = t.pid
    AND to_char(a.sday,'YYYY-MM') = t.ym AND a.sday >= t.s
  GROUP BY 1,2,3),
-- その月までで最新の起点
bs AS (
  SELECT DISTINCT ON (sales_rep_id, proposal_product_id)
    sales_rep_id rid, proposal_product_id pid, year_month bym, amount
  FROM kpi_carry_base WHERE year_month <= p_ym
  ORDER BY sales_rep_id, proposal_product_id, year_month DESC),
keys AS (
  SELECT rid, pid FROM per UNION SELECT rid, pid FROM bs)
SELECT k.rid, k.pid,
  greatest(0, COALESCE(b.amount, 0) + COALESCE((
    SELECT sum(p.n) - sum(p.a) FROM per p
    WHERE p.rid = k.rid AND p.pid = k.pid
      AND (b.bym IS NULL OR p.ym >= b.bym)), 0))::numeric
FROM keys k LEFT JOIN bs b ON b.rid = k.rid AND b.pid = k.pid;
$$;

GRANT EXECUTE ON FUNCTION kpi_carry(text) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 月ごとの目標・繰越の初期値は、運用データのためここには載せていない。
-- 投入例：
--   INSERT INTO kpi_targets (year_month, sales_rep_id, proposal_product_id,
--     target_contracts, appointments_per_contract, sends_per_appointment, start_day, updated_at)
--   VALUES ('2026-10', '<営業担当ID>', '<商材ID>', 4, 4, 30, NULL, now());
--   INSERT INTO kpi_carry_base (year_month, sales_rep_id, proposal_product_id, amount)
--   VALUES ('2026-10', '<営業担当ID>', '<商材ID>', 0);
-- ---------------------------------------------------------------
