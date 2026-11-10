-- =============================================================
-- supabase-schema.sql のあとに追加した表と列。
-- supabase-schema.sql → このファイル → そのほかの supabase-*.sql → supabase-rls.sql の順で流す。
-- 何度流しても壊れないよう IF NOT EXISTS で書いている。
-- =============================================================

-- 営業担当にログイン用メールを紐づける（KPI・送信実績の集計で使う）
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS email text UNIQUE;

-- 契約・解約の金額（商材ごと）と、登録した人
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS instagram_revenue int,
  ADD COLUMN IF NOT EXISTS line_revenue int,
  ADD COLUMN IF NOT EXISTS contracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_instagram_revenue int,
  ADD COLUMN IF NOT EXISTS cancel_line_revenue int,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by text;

-- 送信の種類（メール / 問い合わせフォーム）
ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS send_type text NOT NULL DEFAULT 'email'
  CHECK (send_type IN ('email', 'form'));
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_company ON email_logs(company_id);

-- 提案する商材のマスタ
CREATE TABLE IF NOT EXISTS proposal_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 顧客ごとの提案商材（多対多）
CREATE TABLE IF NOT EXISTS company_proposal_products (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  proposal_product_id uuid NOT NULL REFERENCES proposal_products(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, proposal_product_id)
);
CREATE INDEX IF NOT EXISTS idx_cpp_product ON company_proposal_products(proposal_product_id);

-- 業種のマスタ
CREATE TABLE IF NOT EXISTS genres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 管理者（設定画面に入れる人）
CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- 業務委託スタッフ（ID/パスワードでログイン）。
-- パスワードは scrypt のハッシュと salt だけを持つ。ブラウザからは触らせない（RLS でポリシー無し）
CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- メールテンプレート（担当者ごと・商材ごと）
CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  proposal_product_id uuid REFERENCES proposal_products(id) ON DELETE SET NULL,
  owner_email text,
  created_at timestamptz DEFAULT now()
);

-- CSV取込で、見出しの言い回しを項目に対応づける（例：「会社名」「企業名」→ name）
CREATE TABLE IF NOT EXISTS csv_column_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  csv_header text NOT NULL UNIQUE,
  field_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- タスク（個人 / チーム共有）。未完了のまま日付を過ぎたら当日に繰り越す
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  is_shared boolean NOT NULL DEFAULT false,
  scheduled_date date,
  original_date date,
  created_by text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_date);

-- 個人メモ（本人だけが読み書き。/api/memos でメールを照合する）
CREATE TABLE IF NOT EXISTS personal_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_personal_memos_owner ON personal_memos(created_by);

-- 売上目標（担当者別・月別）と、チーム全体の月の売上目標
CREATE TABLE IF NOT EXISTS sales_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_rep_id uuid NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
  year_month text NOT NULL,
  target_revenue int NOT NULL DEFAULT 0,
  UNIQUE (sales_rep_id, year_month)
);

CREATE TABLE IF NOT EXISTS sales_total_targets (
  year_month text PRIMARY KEY,
  target_revenue int NOT NULL DEFAULT 0
);

-- カレンダー同期で取り込んだ予定は、顧客に紐づかないこともある
ALTER TABLE appointments ALTER COLUMN company_id DROP NOT NULL;
