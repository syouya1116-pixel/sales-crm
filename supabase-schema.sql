-- ステータスマスタ
CREATE TABLE statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

INSERT INTO statuses (name, sort_order) VALUES
  ('未接触', 1),
  ('送信予定', 2),
  ('送信済', 3),
  ('返信あり', 4),
  ('商談済', 5),
  ('案件中', 6),
  ('契約済', 7);

-- 営業担当マスタ
CREATE TABLE sales_reps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);

-- 顧客テーブル
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status_id uuid REFERENCES statuses(id),
  representative_name text,
  service_name text,
  genre text,
  address text,
  notes text,
  sales_rep_id uuid REFERENCES sales_reps(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- URL（複数）
CREATE TABLE company_urls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url text NOT NULL,
  label text,
  sort_order int DEFAULT 0
);

-- 電話番号（複数）
CREATE TABLE company_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  phone text NOT NULL,
  label text,
  sort_order int DEFAULT 0
);

-- メールアドレス（複数）
CREATE TABLE company_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  label text,
  sort_order int DEFAULT 0
);

-- メール送信履歴
CREATE TABLE email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_email_id uuid REFERENCES company_emails(id),
  subject text,
  body text,
  sent_at timestamptz DEFAULT now(),
  sent_by text,
  gmail_message_id text
);

-- 通話ログ（手動入力）
CREATE TABLE call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direction text CHECK (direction IN ('inbound', 'outbound')),
  duration_seconds int,
  notes text,
  called_at timestamptz DEFAULT now(),
  logged_by text
);

-- カレンダーアポ
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title text,
  start_at timestamptz,
  end_at timestamptz,
  google_event_id text,
  created_by text,
  created_at timestamptz DEFAULT now()
);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 検索用インデックス
CREATE INDEX idx_companies_name ON companies USING gin(to_tsvector('simple', name));
CREATE INDEX idx_companies_status ON companies(status_id);
CREATE INDEX idx_companies_updated ON companies(updated_at DESC);
CREATE INDEX idx_company_emails_email ON company_emails(email);
CREATE INDEX idx_company_phones_phone ON company_phones(phone);
