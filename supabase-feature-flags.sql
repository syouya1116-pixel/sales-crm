-- =============================================================
-- 機能の公開設定（フィーチャーフラグ）
-- 2026-08-07 作成。Supabase の SQL Editor で実行する。
--
-- 【背景】
-- 再送機能（送信履歴での絞り込み）を作ったが、いきなり全員に開けず
-- 一旦閉じておきたい。設定ページのトグルで開け閉めできるようにする。
--
-- 1機能1行。将来ほかの機能を足すときも、この表に行を増やすだけで済む。
--
-- 【重要】resend_filter は false で入れる。
-- このSQLを流した時点で再送機能は全員使えなくなる。
-- 開けるときは設定ページ（管理者のみ）のトグルから。
--
-- 【貼り付け時の注意】
-- Supabase の SQL Editor は長い文を貼ると文字が欠けることがある。
-- 下のブロックを「1つずつ別々に」貼って実行すること。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：テーブル
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feature_flags (
  key        text PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_all ON feature_flags;

-- 他のマスタ（kpi_holidays など）と同じ扱い。
-- 設定ページ側で管理者かどうかを見ているので、ここでは絞らない。
-- 一斉送信画面が読む必要があるので、読みは全ログインユーザーに開ける
CREATE POLICY authenticated_all ON feature_flags
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- SQL Editor で作ったテーブルは GRANT が無いと permission denied になる
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags
  TO authenticated, service_role;


-- ---------------------------------------------------------------
-- ブロック2：初期値
--
-- ON CONFLICT DO NOTHING にしてあるので、流し直しても
-- すでに設定した値を false に戻してしまうことはない
-- ---------------------------------------------------------------

INSERT INTO feature_flags (key, enabled) VALUES ('resend_filter', false)
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------
-- 確認用
-- ---------------------------------------------------------------
-- SELECT * FROM feature_flags;
--
-- SQLから直接開ける場合（通常は設定ページのトグルを使う）
-- UPDATE feature_flags SET enabled = true, updated_at = now()
--   WHERE key = 'resend_filter';
