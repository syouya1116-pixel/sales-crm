-- =============================================================
-- 送信ノルマの繰り越し（前月の未消化分を翌月に持ち越す）
-- 2026-08-30 作成。supabase-kpi-carry-forward.sql を流したあとに実行する。
--
-- 【仕様】
-- 担当者×商材ごとに「繰り越しの起点（2026-08）から前月までの
-- 月間目標の合計 − 同じ期間の実績送信数」を出し、プラスなら
-- その分を今月の送信目標に足す。
--
--   ・按分しない。その月の最初の営業日にまとめて全部乗る（9/1に全乗せ）
--   ・超過達成は貯金になる。累計で見るので、前月に多く送っていれば
--     その分だけ繰り越しが減る（累計で足りていれば繰り越し0）
--   ・繰り越しは送信ノルマだけ。アポ目標・契約目標は触らない
--   ・商材ごとに独立。Instagramの未消化がアプリ開発に乗ることはない
--   ・起点より前（2026-07、2026-08の表示）の数字は変わらない
--
-- 【貼り付け方】
-- ブロック2は DROP してから作り直す。途中で止まるとKPIが一時的に
-- 取れなくなるので、ブロック2は必ず全体を一度に貼って実行すること。
-- 失敗したときの戻し方はファイル末尾に置いてある。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：繰り越し額を出す関数（新規）
--
-- p_ym（YYYY-MM）に持ち越される通数を、担当者×商材ごとに返す。
-- 起点は '2026-08-01' 固定。ここを動かすと過去の表示まで変わる。
--
-- 返す列を c_ 付きにしてあるのは、中で使っている rid / pid / amt と
-- 名前がぶつかると Postgres が ambiguous で弾くため。
--
-- 実績は act に切り出して LEFT JOIN で数える。相関サブクエリの中に
-- さらに JOIN を書く形にしていたら、SQL Editor への貼り付けで
-- 途中が欠けて syntax error になった（貼り付けで欠けるのは既知）。
-- 同じ理由で AT TIME ZONE も act の1箇所だけに寄せてある
-- ---------------------------------------------------------------

-- ※ 2026-09-28 以降の kpi_carry は supabase-kpi-carry-apo.sql（アポ調整ぶんも繰り越す）。
--   このブロックを流すとアポ調整ぶんを繰り越さない旧仕様に戻る
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
act AS (
  SELECT sr.id rid, l.proposal_product_id pid,
    (l.sent_at AT TIME ZONE 'Asia/Tokyo')::date sday
  FROM email_logs l JOIN sales_reps sr ON sr.email = l.sent_by
  WHERE l.sent_at >= '2026-08-01 00:00+09'::timestamptz),
per AS (
  SELECT t.rid, t.pid, t.ym, min(t.n) n, count(a.rid) a
  FROM tgt t
  LEFT JOIN act a ON a.rid = t.rid AND a.pid = t.pid
    AND to_char(a.sday,'YYYY-MM') = t.ym AND a.sday >= t.s
  GROUP BY 1,2,3)
SELECT rid, pid, greatest(0, sum(n) - sum(a))::numeric FROM per GROUP BY 1,2;
$$;

GRANT EXECUTE ON FUNCTION kpi_carry(text) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- ブロック2：kpi_prod を作り直す（ここは一度に貼る）
--
-- 返す列に carry_sends（そのうち繰り越し分）を足すので、
-- CREATE OR REPLACE では変えられない。DROP してから作り直す。
--
-- 変わったのは cy（月ごとの繰り越し額）と tr の cf（乗せるかどうか）、
-- tg の snd に + sum(cf) したところだけ。
-- 按分（r）は今までどおりで、繰り越しには掛けない
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS kpi_prod(date, date);

CREATE FUNCTION kpi_prod(p_from date, p_to date)
RETURNS TABLE (rep_id uuid, rep_name text, product_id uuid, product_name text,
  target_sends numeric, actual_sends int, start_day date,
  target_apts numeric, target_contracts numeric, carry_sends numeric)
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
cy AS (SELECT c.ym, k.c_rid rid, k.c_pid pid, k.c_amt amt
       FROM tc c CROSS JOIN LATERAL kpi_carry(c.ym) k),
tr AS (
  SELECT x.*, kpi_ratio(x.s, x.e, p_from, p_to) r,
    CASE WHEN (SELECT min(b.day) FROM kpi_bdays(x.s, x.e) AS b(day))
              BETWEEN p_from AND p_to
         THEN COALESCE((SELECT y.amt FROM cy y
                        WHERE y.ym = x.ym AND y.rid = x.rid AND y.pid = x.pid), 0)
         ELSE 0 END cf
  FROM trow x),
tg AS (SELECT rid, pid, min(sd) sd, sum(n*r) c, sum(n*apc*r) a,
  sum(n*apc*spa*r) + sum(cf) snd, sum(cf) cf FROM tr GROUP BY 1,2),
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
  COALESCE(t.a,0), COALESCE(t.c,0), COALESCE(t.cf,0)
FROM sales_reps sr
CROSS JOIN proposal_products pp
LEFT JOIN tg t ON t.rid = sr.id AND t.pid = pp.id
LEFT JOIN sent s ON s.rid = sr.id AND s.pid = pp.id
WHERE COALESCE(t.snd,0) > 0 OR COALESCE(s.n,0) > 0;
$$;

GRANT EXECUTE ON FUNCTION kpi_prod(date, date) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- ブロック3：kpi_progress に carry_sends を通す
--
-- 中身の計算は変わらない。画面に「うち繰り越し◯通」と出すために
-- 商材ごと・担当者ごとの繰り越し額をJSONに足しているだけ
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_progress(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH
p AS (SELECT * FROM kpi_prod(p_from, p_to)),
rt AS (SELECT rep_id rid, sum(target_sends) snd, sum(actual_sends) act,
  sum(target_apts) a, sum(target_contracts) c, sum(carry_sends) cf FROM p GROUP BY 1),
ap AS (
  SELECT c.sales_rep_id rid, count(*)::int n
  FROM appointments a
  JOIN companies c ON c.id = a.company_id
  LEFT JOIN statuses s ON s.id = c.status_id
  WHERE a.start_at >= (p_from::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND a.start_at < ((p_to+1)::timestamp AT TIME ZONE 'Asia/Tokyo')
    AND c.sales_rep_id IS NOT NULL
    AND COALESCE(s.name,'') NOT IN ('失注','契約済','契約済み','禁止')
  GROUP BY 1),
cn AS (
  SELECT c.sales_rep_id rid, count(*)::int n
  FROM companies c JOIN statuses s ON s.id = c.status_id
  WHERE s.name IN ('契約済','契約済み')
    AND c.contracted_at >= p_from AND c.contracted_at <= p_to
    AND c.sales_rep_id IS NOT NULL
  GROUP BY 1)
SELECT jsonb_build_object(
  'business_days', (SELECT count(*)::int FROM kpi_bdays(p_from, p_to)),
  'month_business_days', kpi_month_bdays(p_to),
  'to_is_business_day', (SELECT count(*) > 0 FROM kpi_bdays(p_to, p_to)),
  'product_rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rep_name, x.product_name)
    FROM (
      SELECT rep_id, rep_name, product_id, product_name,
        round(target_sends)::int target_sends, actual_sends, start_day,
        round(carry_sends)::int carry_sends
      FROM p
    ) x), '[]'::jsonb),
  'rep_rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rep_name)
    FROM (
      SELECT sr.id rep_id, sr.name rep_name, (sr.email IS NOT NULL) has_email,
        round(COALESCE(t.snd,0))::int target_sends,
        COALESCE(t.act,0)::int actual_sends,
        round(COALESCE(t.a,0))::int target_apts, COALESCE(a.n,0) actual_apts,
        round(COALESCE(t.c,0),1) target_contracts, COALESCE(c.n,0) actual_contracts,
        round(COALESCE(t.cf,0))::int carry_sends
      FROM sales_reps sr
      LEFT JOIN rt t ON t.rid = sr.id
      LEFT JOIN ap a ON a.rid = sr.id
      LEFT JOIN cn c ON c.rid = sr.id
    ) x), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION kpi_progress(date, date) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 確認用
-- ---------------------------------------------------------------
-- 8月の数字が変わっていないこと（起点より前なので繰り越し0）
-- SELECT kpi_progress('2026-08-01','2026-08-31') -> 'rep_rows';
--
-- 9月に8月の未消化分が乗っていること（carry_sends を見る）
-- SELECT kpi_progress('2026-09-01','2026-09-30') -> 'rep_rows';
--
-- 繰り越し額の内訳だけ見る
-- SELECT sr.name, pp.name, k.c_amt
-- FROM kpi_carry('2026-09') k
-- JOIN sales_reps sr ON sr.id = k.c_rid
-- JOIN proposal_products pp ON pp.id = k.c_pid;


-- ---------------------------------------------------------------
-- 戻し方（ブロック2で失敗して kpi_prod が消えたままになったとき）
-- supabase-kpi-carry-forward.sql のブロック1をそのまま流せば、
-- 繰り越しなしの状態に戻る（carry_sends は無くなるが画面は動く）
-- ---------------------------------------------------------------
