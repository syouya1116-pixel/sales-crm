-- =============================================================
-- 送信ログに「どの商材で送ったか」を残す
-- 2026-07-31 作成。Supabase の SQL Editor で実行する。
--
-- 【背景】
-- 送信数を商材別（Instagram / 商材B …）に見たいが、email_logs には
-- 商材が入っていなかった。顧客の持ち商材から後追いで割り出そうにも、
-- 商材を2つ以上持つ顧客はどちらで送ったのか分からない。
-- そこで送信の時点で商材を書き残すようにする。
--
-- 【貼り付け時の注意】
-- Supabase の SQL Editor は長い文を貼ると文字が欠けることがある。
-- 下の2ブロックを「1つずつ別々に」貼って実行すること。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：カラムとインデックス
--
-- 商材マスタから商材を消しても送信ログ自体は残したいので
-- ON DELETE SET NULL にする（ログごと消えると集計が狂う）。
-- ---------------------------------------------------------------

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS proposal_product_id uuid
  REFERENCES proposal_products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_product_sent_at
  ON email_logs(proposal_product_id, sent_at);


-- ---------------------------------------------------------------
-- ブロック2：過去ログの補完
--
-- 商材を1つしか持たない顧客の送信ログは、その商材で送ったとみなす。
-- 2つ以上持つ顧客は特定できないので NULL のままにする。
-- 適当に片方を入れると商材別の数字が静かにずれるため、
-- 「分からない」を残すほうがまし、という判断。
--
-- 何件埋まったかは実行後の Rows 表示で分かる。
-- ---------------------------------------------------------------

-- uuid には min() が使えないので array_agg で1件だけ取り出す
-- （HAVING count(*) = 1 なので中身は必ず1件）
UPDATE email_logs l
SET proposal_product_id = s.pid
FROM (
  SELECT company_id, (array_agg(proposal_product_id))[1] AS pid
  FROM company_proposal_products
  GROUP BY company_id
  HAVING count(*) = 1
) s
WHERE l.company_id = s.company_id
  AND l.proposal_product_id IS NULL;


-- ---------------------------------------------------------------
-- 補完の結果を見る（任意）
-- ---------------------------------------------------------------
-- SELECT COALESCE(p.name, '（商材不明）') AS 商材,
--        count(*) AS 送信数
-- FROM email_logs l
-- LEFT JOIN proposal_products p ON p.id = l.proposal_product_id
-- GROUP BY 1
-- ORDER BY 2 DESC;
