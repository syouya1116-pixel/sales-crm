-- =============================================================
-- KPI：祝日を営業日から外す＋警告バー用の項目を足す
-- 2026-08-03 作成。Supabase の SQL Editor で実行する。
--
-- 【何が変わるか】
-- これまで営業日は「土日以外」だった。祝日も出社日として数えていたので、
-- 祝日の分まで目標が積まれていた。祝日テーブルを作って除外する。
--
-- あわせて kpi_progress の戻り値に2つ足す。
--   month_business_days … p_to が属する月の営業日数（「/ 20営業日」用）
--   to_is_business_day  … p_to 自体が営業日か（土日祝はバーを出さない）
--
-- 【貼り付け時の注意】
-- Supabase の SQL Editor は長い文を貼ると文字が欠けることがある。
-- 下のブロックを「1つずつ別々に」貼って実行すること。
-- ブロック1 → 2 → 3 → 4 の順。順番を飛ばすと関数が作れない。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：休業日テーブル
--
-- 1日1行。祝日・振替休日・国民の休日に加えて、
-- 会社独自の休み（夏季休暇・年末年始など）も同じテーブルに入れる。
-- ここに入っている日は営業日から外れ、その分の目標が積まれなくなる。
--
-- 設定ページ「休業日」から追加・削除できる（他のマスタと同じ扱い）。
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kpi_holidays (
  day  date PRIMARY KEY,
  name text NOT NULL DEFAULT ''
);

ALTER TABLE kpi_holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read ON kpi_holidays;
DROP POLICY IF EXISTS authenticated_all ON kpi_holidays;

-- 他のマスタ（kpi_targets など）と同じ扱い。
-- 設定ページ側で管理者かどうかを見ているので、ここでは絞らない
CREATE POLICY authenticated_all ON kpi_holidays
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- kpi_progress は SECURITY DEFINER ではないので、呼んだ側の権限で
-- このテーブルを読む。GRANT が無いと関数ごと permission denied になる
GRANT SELECT, INSERT, UPDATE, DELETE ON kpi_holidays
  TO authenticated, service_role;


-- ---------------------------------------------------------------
-- ブロック2：2026年の祝日
--
-- 春分・秋分は年ごとに官報で決まる。ここは 2026年＝3/20・9/23 で入れている。
-- 年が変わったら同じ形で足すこと。足し忘れても壊れはしないが、
-- その日が営業日として数えられて目標が1日分多く積まれる。
-- ---------------------------------------------------------------

INSERT INTO kpi_holidays (day, name) VALUES
  ('2026-01-01', '元日'),
  ('2026-01-12', '成人の日'),
  ('2026-02-11', '建国記念の日'),
  ('2026-02-23', '天皇誕生日'),
  ('2026-03-20', '春分の日'),
  ('2026-04-29', '昭和の日'),
  ('2026-05-04', 'みどりの日'),
  ('2026-05-05', 'こどもの日'),
  ('2026-05-06', '振替休日'),
  ('2026-07-20', '海の日'),
  ('2026-08-11', '山の日'),
  ('2026-09-21', '敬老の日'),
  ('2026-09-22', '国民の休日'),
  ('2026-09-23', '秋分の日'),
  ('2026-10-12', 'スポーツの日'),
  ('2026-11-03', '文化の日'),
  ('2026-11-23', '勤労感謝の日')
ON CONFLICT (day) DO NOTHING;


-- ---------------------------------------------------------------
-- ブロック3：2027年の祝日
--
-- 土日と重なる日（2026-05-03 憲法記念日＝日曜など）は入れていない。
-- どのみち営業日から外れるので、入れても結果は変わらない。
-- ---------------------------------------------------------------

INSERT INTO kpi_holidays (day, name) VALUES
  ('2027-01-01', '元日'),
  ('2027-01-11', '成人の日'),
  ('2027-02-11', '建国記念の日'),
  ('2027-02-23', '天皇誕生日'),
  ('2027-03-22', '春分の日の振替休日'),
  ('2027-04-29', '昭和の日'),
  ('2027-05-03', '憲法記念日'),
  ('2027-05-04', 'みどりの日'),
  ('2027-05-05', 'こどもの日'),
  ('2027-07-19', '海の日'),
  ('2027-08-11', '山の日'),
  ('2027-09-20', '敬老の日'),
  ('2027-09-23', '秋分の日'),
  ('2027-10-11', 'スポーツの日'),
  ('2027-11-03', '文化の日'),
  ('2027-11-23', '勤労感謝の日')
ON CONFLICT (day) DO NOTHING;


-- ---------------------------------------------------------------
-- ブロック4：営業日を返す関数
--
-- 「土日でも休業日でもない日」を1日1行で返す。
--
-- これを分けているのは SQL Editor 対策。
-- 営業日の判定を kpi_progress の中に3回書くと、長い
-- generate_series の行が並んで貼り付け時に文字が欠けやすくなる。
-- （実際に一度欠けて syntax error になった）
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_bdays(p_from date, p_to date)
RETURNS SETOF date
LANGUAGE sql
STABLE
AS $$
  SELECT d::date
  FROM generate_series(p_from, p_to, '1 day'::interval) d
  WHERE extract(dow FROM d) BETWEEN 1 AND 5
    AND NOT EXISTS (
      SELECT 1 FROM kpi_holidays h WHERE h.day = d::date
    );
$$;

REVOKE ALL ON FUNCTION kpi_bdays(date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION kpi_bdays(date, date)
  TO authenticated, service_role;


-- ---------------------------------------------------------------
-- ブロック5：kpi_progress を置き換える
--
-- supabase-kpi-targets.sql のブロック3と同じものに、
--   ・営業日の判定を kpi_bdays に寄せた（＝休業日が除かれる）
--   ・month_business_days / to_is_business_day
-- を足しただけ。目標の按分の考え方は変えていない。
--
-- 引数の型は前と同じなので、GRANT のやり直しは不要。
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION kpi_progress(
  p_from date,
  p_to   date
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH
days AS (
  SELECT d AS day FROM kpi_bdays(p_from, p_to) d
),
touched AS (
  SELECT DISTINCT to_char(day, 'YYYY-MM') AS ym FROM days
),
-- 月の頭と翌月の頭を先に出しておく。
-- 1行に長い式を書くと SQL Editor の貼り付けで壊れやすいので分ける
mstart AS (
  SELECT ym, (ym || '-01')::date AS d1 FROM touched
),
mrange AS (
  SELECT ym, d1, (d1 + interval '1 month')::date AS d2
  FROM mstart
),
month_days AS (
  SELECT m.ym,
         (SELECT count(*)::int FROM kpi_bdays(m.d1, m.d2 - 1)) AS bdays
  FROM mrange m
),
-- p_to が属する月の営業日数。上の month_days は「期間に営業日が
-- 1日も無い月」を拾えない（days が空になる）ので、別に数える
pm AS (
  SELECT date_trunc('month', p_to)::date AS d1
),
pmr AS (
  SELECT d1, (d1 + interval '1 month')::date AS d2 FROM pm
),
pm_days AS (
  SELECT (SELECT count(*)::int FROM kpi_bdays(p.d1, p.d2 - 1)) AS bdays
  FROM pmr p
),
period_days AS (
  SELECT to_char(day, 'YYYY-MM') AS ym, count(*)::int AS bdays
  FROM days GROUP BY 1
),
ratio AS (
  SELECT p.ym, p.bdays::numeric / NULLIF(m.bdays, 0) AS r
  FROM period_days p
  JOIN month_days m ON m.ym = p.ym
),
bounds AS (
  SELECT (p_from::timestamp AT TIME ZONE 'Asia/Tokyo') AS t_from,
         ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Tokyo') AS t_to
),
tgt AS (
  SELECT t.sales_rep_id AS rep_id,
         t.proposal_product_id AS pid,
         sum(t.target_contracts * r.r) AS contracts,
         sum(t.target_contracts
             * t.appointments_per_contract * r.r) AS apts,
         sum(t.target_contracts * t.appointments_per_contract
             * t.sends_per_appointment * r.r) AS sends
  FROM kpi_targets t
  JOIN ratio r ON r.ym = t.year_month
  GROUP BY 1, 2
),
sent AS (
  SELECT sr.id AS rep_id, l.proposal_product_id AS pid,
         count(*)::int AS n
  FROM email_logs l
  JOIN sales_reps sr ON sr.email = l.sent_by
  CROSS JOIN bounds b
  WHERE l.sent_at >= b.t_from AND l.sent_at < b.t_to
  GROUP BY 1, 2
),
-- 除外条件は集計ページの「担当者別アポ数」と揃えてある。
-- ここだけ違うと同じ画面で2つの数字が出て混乱するため。
apt AS (
  SELECT c.sales_rep_id AS rep_id, count(*)::int AS n
  FROM appointments a
  JOIN companies c ON c.id = a.company_id
  LEFT JOIN statuses s ON s.id = c.status_id
  CROSS JOIN bounds b
  WHERE a.start_at >= b.t_from AND a.start_at < b.t_to
    AND c.sales_rep_id IS NOT NULL
    AND COALESCE(s.name, '') NOT IN
        ('失注','契約済','契約済み','禁止')
  GROUP BY 1
),
ctr AS (
  SELECT c.sales_rep_id AS rep_id, count(*)::int AS n
  FROM companies c
  JOIN statuses s ON s.id = c.status_id
  WHERE s.name IN ('契約済','契約済み')
    AND c.contracted_at >= p_from
    AND c.contracted_at <= p_to
    AND c.sales_rep_id IS NOT NULL
  GROUP BY 1
),
rep_tgt AS (
  SELECT rep_id,
         sum(contracts) AS contracts,
         sum(apts) AS apts,
         sum(sends) AS sends
  FROM tgt GROUP BY 1
),
rep_sent AS (
  SELECT rep_id, sum(n)::int AS n FROM sent GROUP BY 1
)
SELECT jsonb_build_object(
  'business_days', (SELECT count(*)::int FROM days),
  'month_business_days', (SELECT bdays FROM pm_days),
  'to_is_business_day', (
    SELECT count(*) > 0 FROM kpi_bdays(p_to, p_to)
  ),
  'product_rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(x)
                     ORDER BY x.rep_name, x.product_name)
    FROM (
      SELECT sr.id AS rep_id, sr.name AS rep_name,
             pp.id AS product_id, pp.name AS product_name,
             round(COALESCE(t.sends, 0))::int AS target_sends,
             COALESCE(s.n, 0) AS actual_sends
      FROM sales_reps sr
      CROSS JOIN proposal_products pp
      LEFT JOIN tgt t
        ON t.rep_id = sr.id AND t.pid = pp.id
      LEFT JOIN sent s
        ON s.rep_id = sr.id AND s.pid = pp.id
      WHERE COALESCE(t.sends, 0) > 0 OR COALESCE(s.n, 0) > 0
    ) x
  ), '[]'::jsonb),
  'rep_rows', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rep_name)
    FROM (
      SELECT sr.id AS rep_id, sr.name AS rep_name,
             (sr.email IS NOT NULL) AS has_email,
             round(COALESCE(t.sends, 0))::int AS target_sends,
             COALESCE(s.n, 0) AS actual_sends,
             round(COALESCE(t.apts, 0))::int AS target_apts,
             COALESCE(a.n, 0) AS actual_apts,
             round(COALESCE(t.contracts, 0), 1) AS target_contracts,
             COALESCE(c.n, 0) AS actual_contracts
      FROM sales_reps sr
      LEFT JOIN rep_tgt t ON t.rep_id = sr.id
      LEFT JOIN rep_sent s ON s.rep_id = sr.id
      LEFT JOIN apt a ON a.rep_id = sr.id
      LEFT JOIN ctr c ON c.rep_id = sr.id
    ) x
  ), '[]'::jsonb)
);
$$;


-- ---------------------------------------------------------------
-- 動作確認（任意）
-- ---------------------------------------------------------------
-- 祝日が入ったか
-- SELECT * FROM kpi_holidays WHERE day >= '2026-08-01' ORDER BY day;
--
-- 8月は 21平日 － 山の日1日 ＝ 20営業日 になるはず
-- SELECT kpi_progress('2026-08-01', '2026-08-31') -> 'month_business_days';
