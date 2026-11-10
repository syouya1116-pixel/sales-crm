-- 業務委託スタッフのフォーム送信モード用「取り置き（クレーム）」列
--
-- 複数のスタッフが同じ「フォーム」ステータスの顧客プールを共有するため、
-- 作業を始める前にサーバー側で取り置きして、他の人には見せないようにする。
-- これがないと全員が同じ並び順の先頭から始まり、同じ顧客に二重でフォーム送信してしまう。
--
-- form_claimed_by … 取り置いたスタッフの login_id（未取得なら NULL）
-- form_claimed_at … 取り置いた時刻。一定時間（既定60分）を過ぎたら自動的にプールへ戻る

ALTER TABLE companies ADD COLUMN IF NOT EXISTS form_claimed_by text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS form_claimed_at timestamptz;

-- 取り置き候補の絞り込み（status_id + 取り置き状態）を速くする
CREATE INDEX IF NOT EXISTS idx_companies_form_claim
  ON companies (status_id, form_claimed_at);
