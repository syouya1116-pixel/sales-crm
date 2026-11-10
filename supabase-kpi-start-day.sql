-- =============================================================
-- KPI目標に「いつから数えるか」を持たせる
-- 2026-08-07 作成。Supabase の SQL Editor で実行する。
--
-- 【何が問題だったか】
-- kpi_progress は月間目標を営業日で按分する。警告バーは from=月初 で
-- 叩くので、月の途中で目標を足すと「月初から積み上がった累計」が
-- そのまま残りとして乗る。8月20営業日・目標240通なら、8/25 に足した
-- 瞬間に 240 × 15/20 = 180通 が残りとして出る。
-- 最終週に1ヶ月分を積まれる形になり、数字が現実的でなくなる。
--
-- 【どう直すか】
-- kpi_targets に start_day を足し、按分の起点を行ごとに変える。
--   start_day IS NULL … 月初から（＝今までどおり。既存行は全部これ）
--   start_day あり     … その日から月末までで按分する
--
--   r = (start_day〜今日 の営業日) / (start_day〜月末 の営業日)
--
-- 実績も start_day 以降だけ数える。
-- 「目標の入力を忘れていて、その商材ではもう送っている」場合に
-- 過去分を数えると残りが即0になり、start_day を選ぶ意味が無くなるため。
-- start_day が NULL の行は今までと完全に同じ数字になる。
--
-- 【なぜ関数が4つに分かれているか】
-- SQL Editor は長い文を貼ると文字が欠ける。実際にこのSQLで1回起きた
-- （kpi_bdays(x.s,x.e) が c.e に化けた）。関数は途中で切れないので、
-- 1つの関数を小さくするしかない。そのために
-- kpi_ratio / kpi_month_bdays / kpi_prod に切り出してある。
-- 前の kpi_progress にあった計算をそのまま移しただけで、中身は同じ。
--
-- 【貼り付け方】
-- 下のブロックを「1つずつ別々に」貼って実行する。
-- 関数のブロックは、貼ったあと最後の行が $$; になっているか目視で見る。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：列を足す
--
-- NULL 許容。既存行は NULL のまま＝挙動が変わらない
-- ---------------------------------------------------------------

ALTER TABLE kpi_targets ADD COLUMN IF NOT EXISTS start_day date;


-- ---------------------------------------------------------------
-- ブロック2：按分の比率（目標1行ぶん）
--
-- s〜e が目標の対象期間（起点〜月末）、f〜t が画面で見ている期間。
-- 重なっている営業日の割合を返す。
-- greatest / least で挟んでいるので、起点より前の期間を見ても
-- はみ出した分は数えない（kpi_bdays は from > to だと0件）
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_ratio(s date, e date, f date, t date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM kpi_bdays(greatest(s, f), least(t, e)))::numeric
       / NULLIF((SELECT count(*) FROM kpi_bdays(s, e)), 0);
$$;


-- ---------------------------------------------------------------
-- ブロック3：その日が属する月の営業日数
--
-- 「3営業日 / 20営業日」の分母。前は kpi_progress の中に
-- CTE 3つで書いてあったものを、そのまま関数にしただけ
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_month_bdays(d date)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM kpi_bdays(
    date_trunc('month', d)::date,
    (date_trunc('month', d) + interval '1 month')::date - 1);
$$;


-- ---------------------------------------------------------------
-- ブロック4：商材ごとの目標と実績
--
-- ここが start_day の本体。
--   tr  … 目標1行ごとに比率を出す（前は月ごとの共通比率だった）
--   ss  … 起点が入っている行だけ。実績を絞るために使う
--   sent… 起点があれば、その日以降の送信だけ数える
--
-- ss の結合に ym を入れているのは、複数月にまたがる期間を見たときに
-- 行が増えて送信数が水増しされるのを防ぐため
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_prod(p_from date, p_to date)
RETURNS TABLE (rep_id uuid, rep_name text, product_id uuid, product_name text,
  target_sends numeric, actual_sends int, start_day date,
  target_apts numeric, target_contracts numeric)
LANGUAGE sql STABLE AS $$
WITH
tc AS (SELECT DISTINCT to_char(d,'YYYY-MM') AS ym FROM kpi_bdays(p_from,p_to) d),
trow AS (
  SELECT t.sales_rep_id rid, t.proposal_product_id pid, t.year_month ym,
    t.start_day sd, t.target_contracts n,
    t.appointments_per_contract apc, t.sends_per_appointment spa,
    COALESCE(t.start_day, (t.year_month||'-01')::date) s,
    ((t.year_month||'-01')::date + interval '1 month')::date - 1 e
  FROM kpi_targets t WHERE t.year_month IN (SELECT ym FROM tc)),
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
-- ブロック5：kpi_progress の差し替え
--
-- 送信まわりは全部ブロック4に移した。ここに残っているのは
-- アポ・契約の実績と、担当者ごとの合算だけ。
--
-- 合算は丸める前の数字を足している。商材ごとに丸めてから足すと
-- 担当者の合計が今までと1通ずれることがあるため
--
-- アポの除外条件は集計ページの「担当者別アポ数」と揃えてある。
-- ここだけ違うと同じ画面に2つの数字が出て混乱する
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_progress(p_from date, p_to date)
RETURNS jsonb LANGUAGE sql STABLE AS $$
WITH
p AS (SELECT * FROM kpi_prod(p_from, p_to)),
rt AS (SELECT rep_id rid, sum(target_sends) snd, sum(actual_sends) act,
  sum(target_apts) a, sum(target_contracts) c FROM p GROUP BY 1),
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
        round(target_sends)::int target_sends, actual_sends, start_day
      FROM p
    ) x), '[]'::jsonb),
  'rep_rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rep_name)
    FROM (
      SELECT sr.id rep_id, sr.name rep_name, (sr.email IS NOT NULL) has_email,
        round(COALESCE(t.snd,0))::int target_sends,
        COALESCE(t.act,0)::int actual_sends,
        round(COALESCE(t.a,0))::int target_apts, COALESCE(a.n,0) actual_apts,
        round(COALESCE(t.c,0),1) target_contracts, COALESCE(c.n,0) actual_contracts
      FROM sales_reps sr
      LEFT JOIN rt t ON t.rid = sr.id
      LEFT JOIN ap a ON a.rid = sr.id
      LEFT JOIN cn c ON c.rid = sr.id
    ) x), '[]'::jsonb)
);
$$;


-- ---------------------------------------------------------------
-- ブロック6：実行権限
--
-- kpi_progress は中で kpi_prod → kpi_ratio を呼ぶ。
-- SECURITY DEFINER ではないので、呼ぶ側に全部の EXECUTE が要る
-- ---------------------------------------------------------------

GRANT EXECUTE ON FUNCTION kpi_ratio(date, date, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION kpi_month_bdays(date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION kpi_prod(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION kpi_progress(date, date) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 確認用
-- ---------------------------------------------------------------
-- 既存の数字が変わっていないこと（start_day が全部 NULL なら今までと同じ）
-- SELECT kpi_progress('2026-08-01', '2026-08-07') -> 'product_rows';
--
-- 途中開始を試す（あとで戻す）
-- UPDATE kpi_targets SET start_day = '2026-08-25'
--   WHERE year_month = '2026-08' AND proposal_product_id = '<商材ID>';
-- UPDATE kpi_targets SET start_day = NULL
--   WHERE year_month = '2026-08' AND proposal_product_id = '<商材ID>';
