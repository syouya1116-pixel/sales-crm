-- メールテンプレートに所有者を持たせる
-- 一斉送信画面では「自分のテンプレート」と「共通テンプレート」だけを出し、
-- もう一方の担当のテンプレートは選べないようにする（誤選択での誤送信を防ぐため）。
--
-- owner_email
--   'yamada@example.com'   山田さん専用
--   'suzuki@example.com' 鈴木さん専用
--   NULL                   共通（両方に表示）
--
-- 設定は /settings（山田さんのみアクセス可）から行う。

alter table email_templates add column if not exists owner_email text;

-- 既存データの移行。この時点ではテンプレート名に担当者名が入っているので、
-- 名前から所有者を割り当てる。以降は名前を変えても owner_email は動かない。
update email_templates set owner_email = 'yamada@example.com'
  where owner_email is null and name like '%山田%';
update email_templates set owner_email = 'suzuki@example.com'
  where owner_email is null and name like '%鈴木%';

-- 確認用
-- select name, owner_email from email_templates order by created_at;
