-- =============================================================
-- RLS 設定（Supabase の SQL Editor で実行する）
-- 2026-07-26 適用済み。このファイルは適用した内容そのもの。
--
-- 【背景】以前のポリシーは
--     CREATE POLICY "service_only" ON companies FOR ALL USING (true);
-- と書かれていたが、TO 句がないため PUBLIC（= anon キー）にも適用されていた。
-- anon キーはブラウザに配信される＝誰でも入手できるため、ログインなしで
-- 顧客1万件超・メール・電話・個人メモ・admin_users まで
-- 読み書きできる状態だった（21 テーブル中 17 テーブルが露出）。
--
-- 【方針】全テーブルを「authenticated ロールのみ許可」に統一する。
-- ブラウザ側は NextAuth が発行する Supabase 互換 JWT（src/lib/supabaseJwt.ts）で
-- authenticated として接続する。service_role は RLS をバイパスするので影響なし。
--
-- 【前提】環境変数 SUPABASE_JWT_SECRET を .env.local と Vercel の両方に設定し、
-- アプリをデプロイしてから実行すること。順番を逆にするとアプリが DB を読めなくなる。
--
-- 【貼り付け時の注意】Supabase の SQL Editor は長い文を貼ると文字が欠けることが
-- ある（実際に ENABLE ROW LEVEL SECURITY が EVEL になる事故が起きた）。
-- 下の 2 ブロックを別々に、続けて実行すること。貼った後に文字化けがないか目視確認する。
-- =============================================================

-- ---------------------------------------------------------------
-- ブロック1：public スキーマの既存ポリシーを名前に関係なく全削除し、
--            全テーブルで RLS を有効化する。
--            （Supabase 管理画面で作られた名前不明のポリシーも巻き取るため）
--            ここまでの状態では誰も読めない。必ずブロック2 まで続けて実行する。
--            ただし、自分のSQLファイルでポリシーを作っている表（feature_flags・kpi_*・
--            demo_settings）は消さない。消すと、このファイルを最後に流したときに読めなくなる。
-- ---------------------------------------------------------------
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
  AND tablename NOT IN ('feature_flags','kpi_targets','kpi_holidays','kpi_carry_base','demo_settings') LOOP
EXECUTE 'DROP POLICY ' || quote_ident(r.policyname) || ' ON ' || quote_ident(r.tablename);
END LOOP;
FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
EXECUTE 'ALTER TABLE ' || quote_ident(r.tablename) || ' ENABLE ROW LEVEL SECURITY';
END LOOP;
END $$;

-- ---------------------------------------------------------------
-- ブロック2：ログイン済み（authenticated）にだけ開放し直す。
--            staff はこの配列に入れない。パスワードハッシュを持つため、
--            ブラウザからは一切触らせず service_role（/api/staff）経由のみとする。
--            RLS 有効かつポリシー無し ＝ authenticated からも 0 件になる。
-- ---------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['admin_users','appointments','call_logs','companies','company_emails','company_phones','company_proposal_products','company_urls','csv_column_aliases','email_logs','email_templates','genres','personal_memos','proposal_products','sales_reps','sales_targets','sales_total_targets','statuses','tasks'] LOOP
EXECUTE 'CREATE POLICY authenticated_all ON ' || quote_ident(t) || ' FOR ALL TO authenticated USING (true) WITH CHECK (true)';
END LOOP; END $$;

-- ---------------------------------------------------------------
-- 確認用
-- ---------------------------------------------------------------
-- SELECT tablename, policyname, roles::text, cmd FROM pg_policies
--   WHERE schemaname='public' ORDER BY tablename;

-- ---------------------------------------------------------------
-- 復旧用（元の「誰でも読み書きできる」状態に戻す。緊急時のみ）
-- ---------------------------------------------------------------
-- DO $$ DECLARE t text; BEGIN
-- FOREACH t IN ARRAY ARRAY['admin_users','appointments','call_logs','companies','company_emails','company_phones','company_proposal_products','company_urls','csv_column_aliases','email_logs','email_templates','genres','personal_memos','proposal_products','sales_reps','sales_targets','sales_total_targets','statuses','tasks'] LOOP
-- EXECUTE 'DROP POLICY IF EXISTS authenticated_all ON ' || quote_ident(t);
-- EXECUTE 'CREATE POLICY service_only ON ' || quote_ident(t) || ' FOR ALL USING (true) WITH CHECK (true)';
-- END LOOP; END $$;

-- ---------------------------------------------------------------
-- 残課題
-- ---------------------------------------------------------------
-- ・ログイン済みスタッフは、画面上の制限とは別に、ブラウザから全顧客データを
--   読み書きできる。最小権限化するには authenticated_all を
--   app_role / created_by で絞るポリシーに置き換える。
