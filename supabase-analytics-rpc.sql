-- =============================================================
-- 集計ページ（/analytics）をDB側集計へ移すためのSQL
-- 2026-07-30 作成 / 2026-07-31 商材フィルター対応
-- Supabase の SQL Editor で実行する。
--
-- 【背景】
-- 集計ページは顧客・送信ログ・アポを「絞り込みなしで全件」ブラウザへ取得し、
-- JavaScript で数えていた。Supabase は1リクエストの返却行数に上限があるため、
-- 上限で打ち切られた一部だけを数えた数字が表示されていた。
-- 実際、ステータス1つで 4,541 件ある状態で「顧客総数 387 件」と出ていた。
-- 送信数・返信率・アポ数・売上合計・契約率・グラフの全部が影響を受けていた。
--
-- 【方針】
-- 数えるのはDBの仕事にする。この関数が集計済みの値だけを返すので、
-- 行数の上限とは無関係になり、転送量も激減する。
--
-- 【貼り付け時の注意】
-- Supabase の SQL Editor は長い文を貼ると文字が欠けることがある
-- （過去に ENABLE ROW LEVEL SECURITY が EVEL になる事故あり）。
-- 下のブロックを「1つずつ別々に」貼って実行すること。
-- 貼った直後に文字化けが無いか目視で確認する。
--
-- 【実行順】
-- 商材フィルターを足すときは supabase-email-log-product.sql を先に流すこと。
-- email_logs.proposal_product_id が無いとブロック3で落ちる。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：email_logs のインデックス
--
-- このテーブルには当初インデックスが1本も無く、期間で絞るたびに
-- 全件走査していた。集計をDB側へ移す前提として先に張る。
-- CONCURRENTLY は付けない（SQL Editor はトランザクション内で走るため）。
-- 数千〜数万件の規模なので一瞬で終わる。
-- ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_by_sent_at ON email_logs(sent_by, sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_company ON email_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_at ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_companies_contracted_at ON companies(contracted_at);


-- ---------------------------------------------------------------
-- ブロック2：旧バージョンの関数を消す
--
-- 引数が3つ（p_from, p_to, p_bucket）だった頃の関数。
-- 商材フィルター用に4つ目を足すと別物として並んで登録され、
-- 3引数で呼んだときにどちらを使うか決められずエラーになる。
-- 消しても集計ページが一時的に動かなくなるだけで、データは消えない。
-- ---------------------------------------------------------------

DROP FUNCTION IF EXISTS
  analytics_summary(timestamptz, timestamptz, text);


-- ---------------------------------------------------------------
-- ブロック3：集計関数
--
-- p_from / p_to    … 期間（null なら全期間）
-- p_bucket         … グラフの刻み 'hour' | 'dow' | 'day' | 'month'
-- p_product_id     … 提案商材で絞る（null なら全商材）
--
-- ステータス名は「契約済」と「契約済み」の両方を同じ意味として扱う。
-- 実装側で綴りが揺れており（analytics は 契約済、sales-board は 契約済み）、
-- 片方だけ見ると売上と契約数が常に0になるため。
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION analytics_summary(
  p_from       timestamptz DEFAULT NULL,
  p_to         timestamptz DEFAULT NULL,
  p_bucket     text        DEFAULT 'month',
  p_product_id uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH
-- 期間だけで絞ったもの。商材別の内訳はこちらから作る
-- （商材で絞ったあとの内訳を出しても1行しか出ないため）
all_logs AS (
  SELECT l.sent_by, l.sent_at, l.send_type, l.company_id,
         l.proposal_product_id AS pid
  FROM email_logs l
  WHERE (p_from IS NULL OR l.sent_at >= p_from)
    AND (p_to   IS NULL OR l.sent_at <= p_to)
),
logs AS (
  SELECT * FROM all_logs
  WHERE p_product_id IS NULL OR pid = p_product_id
),
-- 顧客側の数字（顧客総数・ステータス・契約・売上・アポ）も
-- 同じ商材で絞る。送信数だけ絞ると分母と分子が食い違うため
comp AS (
  SELECT c.id, c.status_id, c.sales_rep_id, c.contracted_at,
         COALESCE(c.instagram_revenue, 0) AS ig,
         COALESCE(c.line_revenue, 0)      AS ln,
         s.name AS status_name
  FROM companies c
  LEFT JOIN statuses s ON s.id = c.status_id
  WHERE p_product_id IS NULL OR EXISTS (
    SELECT 1 FROM company_proposal_products cpp
    WHERE cpp.company_id = c.id
      AND cpp.proposal_product_id = p_product_id
  )
),
replied AS (
  SELECT id FROM comp
  WHERE status_name IN
        ('返信あり','商談済','案件中','契約済','契約済み')
),
apts AS (
  SELECT a.start_at, c.sales_rep_id
  FROM appointments a
  JOIN comp c ON c.id = a.company_id
  WHERE a.company_id IS NOT NULL
    AND COALESCE(c.status_name, '') NOT IN
        ('失注','契約済','契約済み','禁止')
    AND (p_from IS NULL OR a.start_at >= p_from)
    AND (p_to   IS NULL OR a.start_at <= p_to)
),
-- 契約日は日付だけの列なので、期間の端をJSTの日付に直してから比べる
bounds AS (
  SELECT (p_from AT TIME ZONE 'Asia/Tokyo')::date AS d_from,
         (p_to   AT TIME ZONE 'Asia/Tokyo')::date AS d_to
),
contracted AS (
  SELECT c.* FROM comp c, bounds b
  WHERE c.status_name IN ('契約済','契約済み')
    AND c.contracted_at IS NOT NULL
    AND (b.d_from IS NULL OR c.contracted_at >= b.d_from)
    AND (b.d_to   IS NULL OR c.contracted_at <= b.d_to)
),
-- グラフ用。JSTに直した時刻を先に出しておくと、下の CASE が短い行で書ける
-- （SQL Editor は長い行を貼ると文字を欠かすことがあるので行を短く保つ）
jst_logs AS (
  SELECT l.sent_at AT TIME ZONE 'Asia/Tokyo' AS t FROM logs l
),
chart_row AS (
  SELECT
    CASE p_bucket
      WHEN 'hour' THEN to_char(j.t, 'HH24') || '時'
      WHEN 'dow'  THEN substr('日月火水木金土',
                              extract(dow FROM j.t)::int + 1, 1)
      WHEN 'day'  THEN extract(day FROM j.t)::int::text || '日'
      ELSE to_char(j.t, 'YYYY/MM')
    END AS label,
    CASE p_bucket
      WHEN 'hour' THEN extract(hour FROM j.t)::int
      WHEN 'dow'  THEN (extract(dow FROM j.t)::int + 6) % 7
      WHEN 'day'  THEN extract(day FROM j.t)::int
      ELSE to_char(j.t, 'YYYYMM')::int
    END AS sort_key
  FROM jst_logs j
)
SELECT jsonb_build_object(
  'total_sent',         (SELECT count(*)::int FROM logs),
  'total_form_sent',    (SELECT count(*)::int FROM logs
                         WHERE send_type = 'form'),
  'total_companies',    (SELECT count(*)::int FROM comp),
  'total_replied',      (SELECT count(*)::int FROM replied),
  'total_appointments', (SELECT count(*)::int FROM apts),
  'total_contracted',   (SELECT count(*)::int FROM contracted),
  'total_revenue',      (SELECT COALESCE(sum(ig + ln), 0)::bigint
                         FROM contracted),

  -- 送信者ごとの送信数と、返信済みまで進んだ顧客数
  -- 顧客の紐付けは company_id を使う。旧実装は company_email_id を使っており、
  -- メールアドレスを持たないフォーム送信が返信数に一切数えられていなかった。
  'account_stats', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sent DESC)
    FROM (
      -- sent_by が NULL になるのは CSV取込だけ（2026-07 時点）。
      -- 誰の送信か復元できないので、人別の実績とは別枠だと分かる名前にしておく
      SELECT COALESCE(l.sent_by, 'CSV取込（担当不明）') AS account,
             count(*)::int AS sent,
             count(DISTINCT l.company_id) FILTER (
               WHERE l.company_id IN (SELECT id FROM replied)
             )::int AS replied
      FROM logs l
      GROUP BY 1
    ) x
  ), '[]'::jsonb),

  -- 商材別の送信数。商材フィルターを掛けても内訳は全商材ぶん返す
  -- （画面のフィルターに件数を添えたいため）。
  -- 商材が入っていないログは、フィルター前の総数と突き合わせられるよう
  -- 「（商材不明）」として必ず1行出す
  'product_stats', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sent DESC)
    FROM (
      SELECT a.pid AS id,
             COALESCE(p.name, '（商材不明）') AS name,
             count(*)::int AS sent
      FROM all_logs a
      LEFT JOIN proposal_products p ON p.id = a.pid
      GROUP BY a.pid, p.name
    ) x
  ), '[]'::jsonb),

  -- ステータス別顧客数。ステータス未設定も「未設定」として必ず数える
  -- （旧実装はマスタに無い名前を落としていたため、未設定の顧客が
  --   顧客総数からまるごと消えていた）
  'status_stats', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order, x.name)
    FROM (
      SELECT COALESCE(c.status_name, '未設定') AS name,
             count(*)::int AS count,
             COALESCE(min(s.sort_order), 9999) AS sort_order
      FROM comp c
      LEFT JOIN statuses s ON s.name = c.status_name
      GROUP BY 1
    ) x
  ), '[]'::jsonb),

  -- 営業担当別アポ数
  'rep_apt_stats', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.count DESC)
    FROM (
      SELECT COALESCE(r.name, '未設定') AS name, count(*)::int AS count
      FROM apts a
      LEFT JOIN sales_reps r ON r.id = a.sales_rep_id
      GROUP BY 1
    ) x
  ), '[]'::jsonb),

  -- グラフ。刻みは呼び出し側が決める。並び順は sort_key に持たせる
  'chart_stats', COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_key)
    FROM (
      SELECT c.label, c.sort_key, count(*)::int AS sent
      FROM chart_row c
      GROUP BY c.label, c.sort_key
    ) x
  ), '[]'::jsonb)
);
$$;


-- ---------------------------------------------------------------
-- ブロック4：実行権限
--
-- API ルートは service_role で呼ぶが、ブラウザから直接呼べるようにも
-- authenticated へ付けておく。anon には付けない。
-- ---------------------------------------------------------------

REVOKE ALL ON FUNCTION
  analytics_summary(timestamptz, timestamptz, text, uuid)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  analytics_summary(timestamptz, timestamptz, text, uuid)
  TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 動作確認（任意）
-- 顧客総数が顧客一覧の件数と一致すること、ステータス別に「未設定」が
-- 出ることを見る。
-- ---------------------------------------------------------------
-- SELECT analytics_summary(NULL, NULL, 'month', NULL);
