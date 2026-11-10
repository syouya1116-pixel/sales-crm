-- =============================================================
-- 顧客の「最終送信日」を companies に持たせる
-- 2026-08-10 作成。Supabase の SQL Editor で実行する。
--
-- 【背景】
-- 再送（送信履歴での絞り込み）で送った相手は、もともと「送信済」なので
-- api/gmail/bulk-send のステータス更新（送信予定 → 送信済）に引っかからない。
-- companies の行が一度も UPDATE されないため updated_at が動かず、
-- 顧客一覧（updated_at の降順）に何の変化も出ない。
-- 結果「送ったのか送っていないのか画面から判断できない」状態になっていた。
--
-- 【なぜ updated_at を直接叩かないのか】
-- supabase-updated-at-trigger.sql のトリガーは「updated_at 以外に差分が無ければ
-- 更新日時を据え置く」作りなので、updated_at だけを更新しても無視される。
-- 実体のある列（last_emailed_at）を足す必要がある。
--
-- 【なぜアプリ側ではなくトリガーなのか】
-- email_logs への INSERT は4経路ある（一斉送信API・フォーム記録・単発送信・CSV取込）。
-- アプリを4箇所直すと必ずどこかが漏れるので、DB側で1本にまとめる。
--
-- 【貼り付け時の注意】
-- Supabase の SQL Editor は長い文を貼ると文字が欠けることがある。
-- 下のブロックを「1つずつ別々に」貼って実行すること。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：列を追加する
-- ---------------------------------------------------------------

ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_emailed_at timestamptz;


-- ---------------------------------------------------------------
-- ブロック2：既存の送信履歴から埋め戻す
--
-- 【重要】updated_at トリガーを止めてから実行する。
-- 止めずに走らせると全社の updated_at が now() になり、
-- 顧客一覧（updated_at の降順）の並びが丸ごと壊れる。
-- DO ブロック1つ＝1トランザクションなので、途中で失敗しても
-- トリガーが止まったまま残ることはない。
-- ---------------------------------------------------------------

DO $$
BEGIN
  EXECUTE 'ALTER TABLE companies DISABLE TRIGGER companies_updated_at';
  UPDATE companies c SET last_emailed_at = l.ls
  FROM (SELECT company_id, max(sent_at) ls FROM email_logs GROUP BY company_id) l
  WHERE c.id = l.company_id;
  EXECUTE 'ALTER TABLE companies ENABLE TRIGGER companies_updated_at';
END $$;


-- ---------------------------------------------------------------
-- ブロック3：送信したら最終送信日を進める
--
-- last_emailed_at が実際に変わったときだけ UPDATE する。
-- 同じ値で上書きしても updated_at トリガー側が据え置きにするので
-- 実害は無いが、無駄な行更新を避けるために WHERE で弾いている。
--
-- SECURITY DEFINER にしてあるのは、フォーム記録がブラウザ（authenticated）から
-- email_logs を直接 INSERT するため。今の RLS では authenticated でも
-- companies を更新できるが、将来ポリシーを絞ったときに黙って壊れるのを防ぐ。
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_company_last_emailed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.company_id IS NOT NULL AND NEW.sent_at IS NOT NULL THEN
    UPDATE companies SET last_emailed_at = NEW.sent_at
    WHERE id = NEW.company_id
      AND (last_emailed_at IS NULL OR last_emailed_at < NEW.sent_at);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS email_logs_touch_company ON email_logs;

CREATE TRIGGER email_logs_touch_company
  AFTER INSERT ON email_logs
  FOR EACH ROW EXECUTE FUNCTION touch_company_last_emailed();


-- ---------------------------------------------------------------
-- ブロック4：履歴を消したら最終送信日を計算し直す
--
-- 顧客詳細の送信履歴は手で削除できる（EmailLogSection）。
-- 消しても last_emailed_at が残ると、送っていない日付が一覧に出続ける。
--
-- 顧客ごと削除したときは ON DELETE CASCADE でここも走るが、
-- 親の行はもう無いので 0 件更新になるだけで害はない。
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION recalc_company_last_emailed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE companies SET last_emailed_at =
    (SELECT max(sent_at) FROM email_logs WHERE company_id = OLD.company_id)
  WHERE id = OLD.company_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS email_logs_recalc_company ON email_logs;

CREATE TRIGGER email_logs_recalc_company
  AFTER DELETE ON email_logs
  FOR EACH ROW EXECUTE FUNCTION recalc_company_last_emailed();


-- ---------------------------------------------------------------
-- ブロック5（任意）：直前に送ったぶんを顧客一覧の先頭に出す
--
-- ブロック2の埋め戻しは updated_at をわざと動かさないので、
-- 実行しても「最終送信」の日付が入るだけで、一覧の並びは変わらない。
-- 「さっき再送した相手を一覧の上に出したい」ときだけ、これを実行する。
--
-- ここでもトリガーを止める必要がある。updated_at だけを更新しても
-- 「他に差分が無いので据え置き」と判定されて、何も起きないため。
--
-- interval は必要に応じて変える（直近1日ぶんが対象）。
-- ---------------------------------------------------------------

-- DO $$
-- BEGIN
--   EXECUTE 'ALTER TABLE companies DISABLE TRIGGER companies_updated_at';
--   UPDATE companies SET updated_at = last_emailed_at
--   WHERE last_emailed_at >= now() - interval '1 day';
--   EXECUTE 'ALTER TABLE companies ENABLE TRIGGER companies_updated_at';
-- END $$;


-- ---------------------------------------------------------------
-- 動作確認（任意）
-- ---------------------------------------------------------------
-- 埋め戻せた件数
-- SELECT count(*) FROM companies WHERE last_emailed_at IS NOT NULL;
--
-- 最終送信が新しい順に10社
-- SELECT name, last_emailed_at, updated_at FROM companies
--   WHERE last_emailed_at IS NOT NULL ORDER BY last_emailed_at DESC LIMIT 10;
--
-- トリガーが2本とも付いているか
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'email_logs'::regclass AND NOT tgisinternal;


-- ---------------------------------------------------------------
-- 元に戻すとき
-- ---------------------------------------------------------------
-- DROP TRIGGER IF EXISTS email_logs_touch_company ON email_logs;
-- DROP TRIGGER IF EXISTS email_logs_recalc_company ON email_logs;
-- DROP FUNCTION IF EXISTS touch_company_last_emailed();
-- DROP FUNCTION IF EXISTS recalc_company_last_emailed();
-- ALTER TABLE companies DROP COLUMN IF EXISTS last_emailed_at;
