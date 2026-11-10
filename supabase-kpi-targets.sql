-- =============================================================
-- KPI目標管理（フェーズ3）
-- 2026-07-31 作成。Supabase の SQL Editor で実行する。
--
-- 【考え方】
-- 入力するのは「月に何件契約したいか」だけ。そこから逆算する。
--   必要アポ数  = 契約目標 × appointments_per_contract（既定 4）
--   必要送信数  = 必要アポ数 × sends_per_appointment（既定 30）
-- つまり契約1件あたり送信120件が既定値。商材ごとに変えられる。
--
-- 日／週の目標は営業日数で按分する（土日を除く。祝日は考慮しない）。
-- 週が月をまたぐ場合があるので、期間内の平日を月ごとに数えて
-- 「その月の目標 × 期間内平日 ÷ 月の平日」を足し合わせている。
--
-- 【貼り付け時の注意】
-- Supabase の SQL Editor は長い文を貼ると文字が欠けることがある。
-- 下の4ブロックを「1つずつ別々に」貼って実行すること。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：営業担当にメールアドレスを持たせる
--
-- 送信実績は email_logs.sent_by（メールアドレス）に入るが、
-- アポと契約は companies.sales_rep_id（UUID）で紐づく。
-- 両者を突き合わせる鍵が無いので、マスタ側にメールを足す。
--
-- 【注意】設定ページから営業担当を追加してもメールは入らない。
-- 新しい担当を増やしたら、下と同じ UPDATE でメールを入れること。
-- 入れないとその人の送信実績が0件として出る。
-- ---------------------------------------------------------------

ALTER TABLE sales_reps
  ADD COLUMN IF NOT EXISTS email text;

-- 名前の空白は全角・半角・無しが混ざりうるので、除いて突き合わせる
UPDATE sales_reps SET email = 'yamada@example.com'
  WHERE replace(replace(name, ' ', ''), '　', '') = '山田太郎'
    AND email IS NULL;

UPDATE sales_reps SET email = 'suzuki@example.com'
  WHERE replace(replace(name, ' ', ''), '　', '') = '鈴木一郎'
    AND email IS NULL;


-- ---------------------------------------------------------------
-- ブロック2：目標テーブル
--
-- 担当者×商材×月ごとに1行。目標を設定していない組み合わせは
-- 行が無い＝目標0として扱う。
-- 係数は商材ごとに変えたいので行に持たせる（画面からは商材単位で
-- まとめて書き込む）。
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS kpi_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month text NOT NULL,
  sales_rep_id uuid NOT NULL
    REFERENCES sales_reps(id) ON DELETE CASCADE,
  proposal_product_id uuid NOT NULL
    REFERENCES proposal_products(id) ON DELETE CASCADE,
  target_contracts numeric NOT NULL DEFAULT 0,
  appointments_per_contract numeric NOT NULL DEFAULT 4,
  sends_per_appointment numeric NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year_month, sales_rep_id, proposal_product_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_targets_ym
  ON kpi_targets(year_month);

ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_all ON kpi_targets;

CREATE POLICY authenticated_all ON kpi_targets
  FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ---------------------------------------------------------------
-- ブロック3：進捗を返す関数
--
-- p_from / p_to … JST の日付（両端を含む）
--
-- 送信数は担当者×商材で出す。
-- アポ数と契約数は担当者ごとの合計だけにしている。
-- 顧客が商材を2つ持つとアポが商材ごとに二重で数えられてしまい、
-- 実態より多く見えるため。
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
  SELECT d::date AS day
  FROM generate_series(p_from, p_to, interval '1 day') d
  WHERE extract(dow FROM d) BETWEEN 1 AND 5
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
  SELECT m.ym, count(*)::int AS bdays
  FROM mrange m
  CROSS JOIN LATERAL
    generate_series(m.d1, m.d2 - 1, interval '1 day') d
  WHERE extract(dow FROM d) BETWEEN 1 AND 5
  GROUP BY m.ym
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
-- ブロック4：実行権限
-- ---------------------------------------------------------------

REVOKE ALL ON FUNCTION kpi_progress(date, date) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION kpi_progress(date, date)
  TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 動作確認（任意）
-- ---------------------------------------------------------------
-- SELECT kpi_progress('2026-07-01', '2026-07-31');
