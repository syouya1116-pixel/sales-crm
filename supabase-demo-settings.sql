-- =============================================================
-- デモ環境（NEXT_PUBLIC_DEMO_MODE=1）だけで使う表。通常の運用では不要。
-- 設定画面の「サイトのカスタマイズ」（会社名・色・メニュー・一覧の列など）を
-- key='site' の1行に JSON でまとめて持つ。
-- 読み書きはサーバー（service_role）からだけ行うので、RLS は有効にしてポリシーは作らない。
-- =============================================================
CREATE TABLE IF NOT EXISTS demo_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE demo_settings ENABLE ROW LEVEL SECURITY;
