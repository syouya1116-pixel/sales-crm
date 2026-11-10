-- =============================================================
-- 日次送信ノルマのアポ実績連動
-- 2026-08-30 作成。仕様合意は 2026-08-18。
-- supabase-kpi-carry-over.sql を流したあとに実行する。
--
-- 【考え方】
--   残アポ   = 月間必要アポ − 当月に実施予定のアポ（未来の予定も引く）
--   残営業日 = その日を含む月末までの営業日
--   その日のノルマ = (残アポ ÷ 残営業日) × 1アポあたり送信数
--                    ただし月初按分の基準値を下回らない（倍率は1.0未満にしない）
--
-- 【効かせる範囲】
-- 2026-09 以降だけ。8月に当てると残営業日が1日しかないので
-- 8/31のノルマが840〜1080通になってしまう（ユーザー確認済みで9月開始）。
--
-- 【1日動かさない仕組み】
-- アポは created_at がその日の0時より前のものだけ数える。
-- 今日登録したアポでノルマが下がるのは翌朝から。
-- スナップショット用のテーブルを持たずに「朝に確定」を満たすため。
-- 過去日を指定しても同じ数字が再現できる。
--
-- 【アポの数え方】
-- 実施日（start_at）がその月に入っているものを数える。当月内なら未来の
-- 予定も引く（アポは取ってあるのに追い込まれる、を避けるため）。
-- 除外ステータスは集計ページの「担当者別アポ数」と揃えてある。
--
-- 【繰り越しとの関係】
-- 倍率は按分ぶんにだけ掛ける。繰り越し（kpi_carry）は素通しで、
-- 倍率と掛け算にはしない。月初に二重で膨らむのを避けるため。
-- =============================================================

CREATE OR REPLACE FUNCTION kpi_daily_quota(p_date date)
RETURNS TABLE (q_rid uuid, q_pid uuid, q_base numeric, q_quota numeric,
  q_ratio numeric, q_apt_target numeric, q_apt_left numeric, q_bdays_left int)
LANGUAGE sql STABLE AS $$
WITH
m AS (
  SELECT date_trunc('month', p_date)::date d1,
    ((date_trunc('month', p_date) + interval '1 month')::date - 1) d2,
    to_char(p_date,'YYYY-MM') ym),
src AS (
  SELECT m.ym, m.d1, m.d2,
    COALESCE(
      (SELECT k.year_month FROM kpi_targets k WHERE k.year_month = m.ym LIMIT 1),
      (SELECT max(k.year_month) FROM kpi_targets k WHERE k.year_month < m.ym)
    ) uym
  FROM m),
tgt AS (
  SELECT t.sales_rep_id rid, t.proposal_product_id pid,
    t.target_contracts * t.appointments_per_contract apt,
    t.target_contracts * t.appointments_per_contract
      * t.sends_per_appointment snd
  FROM src v JOIN kpi_targets t ON t.year_month = v.uym),
bd AS (
  SELECT
    (SELECT count(*) FROM kpi_bdays(v.d1, v.d2))::numeric mb,
    (SELECT count(*) FROM kpi_bdays(p_date, v.d2))::numeric rb,
    (SELECT count(*) > 0 FROM kpi_bdays(p_date, p_date)) isb,
    (v.ym >= '2026-09') on_
  FROM src v),
ap AS (
  SELECT c.sales_rep_id rid, count(*)::numeric n
  FROM appointments a
  JOIN companies c ON c.id = a.company_id
  LEFT JOIN statuses s ON s.id = c.status_id
  CROSS JOIN src v
  WHERE a.start_at >= (v.d1::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND a.start_at < ((v.d2 + 1)::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND a.created_at < (p_date::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND c.sales_rep_id IS NOT NULL
    AND COALESCE(s.name,'') NOT IN ('失注','契約済','契約済み','禁止')
  GROUP BY 1),
rep AS (
  SELECT t.rid, sum(t.apt) apt,
    greatest(0, sum(t.apt) - COALESCE(min(a.n), 0)) lft
  FROM tgt t LEFT JOIN ap a ON a.rid = t.rid
  GROUP BY 1),
rt AS (
  SELECT r.rid, r.apt, r.lft,
    CASE WHEN NOT b.on_ OR r.apt <= 0 OR b.rb <= 0 OR b.mb <= 0 THEN 1
         ELSE greatest(1, (r.lft * b.mb) / (b.rb * r.apt)) END ratio
  FROM rep r CROSS JOIN bd b)
SELECT t.rid, t.pid,
  CASE WHEN b.isb THEN t.snd / NULLIF(b.mb, 0) ELSE 0 END,
  CASE WHEN b.isb THEN (t.snd / NULLIF(b.mb, 0)) * r.ratio ELSE 0 END,
  r.ratio, r.apt, r.lft, b.rb::int
FROM tgt t
JOIN rt r ON r.rid = t.rid
CROSS JOIN bd b;
$$;

GRANT EXECUTE ON FUNCTION kpi_daily_quota(date) TO authenticated, service_role;
