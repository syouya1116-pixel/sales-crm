-- =============================================================
-- 繰り越しに「月末日のアポ調整ぶんの送り残し」も含める
-- 2026-09-28 作成。supabase-kpi-carry-over.sql の kpi_carry を置き換える
-- （返す列は同じなので CREATE OR REPLACE でよい。kpi_prod は触らない）。
--
-- 【変わるところ】
-- これまでは「月間目標 − 実績」だけで繰り越しを出していたので、
-- 月間目標を送り切ったあとにアポ調整で増えた日次ノルマを残しても
-- 翌月には何も乗らなかった。
-- これからは**その月の最終営業日のアポ調整の上乗せ分**を月間目標に足してから
-- 実績を引く（ユーザー指定・案D）。
--
-- 【最終営業日だけを見る理由】
-- アポ調整は毎朝「残アポ全部 ÷ 残営業日」で出し直すので、同じ不足が
-- 翌日以降のノルマにも毎日入り直す。日ごとの上乗せを全部足すと
-- 同じ不足を何度も数える（9月の試算で1人2,000通超になった）。
-- 最終営業日のノルマには、その時点で足りないアポの分が全部入っている
-- （残営業日が1日なので割られない）。そこだけを見れば二重にならない。
--
-- 【変わらないところ】
-- ・累計判定。多く送った月の超過分は貯金になり、マイナスにはしない
--   （月内に基準を超えて送った分は、月末日の上乗せ分に充たる）
-- ・商材ごとに独立。翌月の最初の営業日に全額乗る
-- ・アポ調整が効くのは 2026-09 以降（kpi_daily_quota 側で止めてある）。
--   8月ぶんの繰り越しは変わらない
-- =============================================================

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
  GROUP BY 1,2,3)
SELECT rid, pid, greatest(0, sum(n) - sum(a))::numeric FROM per GROUP BY 1,2;
$$;

GRANT EXECUTE ON FUNCTION kpi_carry(text) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 確認用：10月に乗る繰り越し額（9月の目標＋9/30のアポ調整ぶん − 9月の実績）
-- ---------------------------------------------------------------
-- SELECT sr.name, pp.name, k.c_amt
-- FROM kpi_carry('2026-10') k
-- JOIN sales_reps sr ON sr.id = k.c_rid
-- JOIN proposal_products pp ON pp.id = k.c_pid;
--
-- 戻し方：supabase-kpi-carry-over.sql の kpi_carry（ブロック1）だけを流す
