-- =============================================================
-- 再送の宛先を送信履歴から絞り込む
-- 2026-08-07 作成。Supabase の SQL Editor で実行する。
--
-- 【背景】
-- 「違う商材で再送したい」「同じ商材で期間をあけて再送したい」の2つを
-- やりたい。どちらも送る処理は今の一斉送信と同じで、違うのは宛先の選び方
-- だけ。そこで専用画面は作らず、一斉送信の絞り込みに「送信履歴」を足す。
--
-- email_logs は7,000件を超えていて増え続けるので、ブラウザに引いてきて
-- 数えるのは無理。条件に合う company_id だけを返す関数をDB側に置く。
--
-- 【貼り付け時の注意】
-- Supabase の SQL Editor は長い文を貼ると文字が欠けることがある。
-- 下のブロックを「1つずつ別々に」貼って実行すること。
-- 2026-08-07 の初回実行で実際に欠けた（WHERE 句の途中が丸ごと落ちた）ため、
-- 関数は改行とコメントを削って短く書いてある。読みやすさより貼り付けの確実さを優先。
-- 実行前に最後の行が $$; になっているか目視で確認すること。
-- =============================================================


-- ---------------------------------------------------------------
-- ブロック1：インデックス
--
-- 会社ごとに「この商材で送ったログがあるか」を引く形なので、
-- company_id 単独（idx_email_logs_company）だけだと商材の絞り込みで
-- 行を舐めることになる。複合で持たせる。
-- ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_email_logs_company_product
  ON email_logs(company_id, proposal_product_id);


-- ---------------------------------------------------------------
-- ブロック2：関数
--
-- 3つの条件はいずれも NULL なら「指定なし」として無視する。
--
-- 【商材が分からない履歴の扱い】
-- CRM導入前の送信をCSVで取り込んだぶん（件名が「（CSV取込）」）は
-- proposal_product_id が入っていない。2,255件・2,219社ぶんある。
-- これを一律に外すか含めるかは、条件によって答えが変わる:
--
--   ・p_sent_product   … 商材が一致しないので自動的に対象外。判定不要
--   ・p_not_sent_product … 実際には送っていたかもしれないので**外す**。
--                          含めると二重送信になる
--   ・p_days_since のみ … 商材を見ないので誤送信の余地がない。**含める**。
--                          8ヶ月放置している相手＝掘り起こしの本命でもある
--
-- なので画面にスイッチは出さず、p_not_sent_product が指定されたときだけ
-- 自動で外す（known_cnt > 0 の条件）。判断の余地を無くして操作ミスを防ぐ。
--
-- 【除外する相手】
-- 再送は「もう送った人にまた送る」ので、通常の一斉送信の安全弁が効かない。
-- 話が前に進んでいる相手に営業メールを再送すると失礼になるため、
-- ステータスで除外する。結果として対象は実質「送信済」だけになる
-- （未接触・送信予定はそもそも履歴が無いので条件に一致しない）。
-- ステータスが更新されないままアポだけ入っている場合に備えて、
-- appointments に行がある会社も外す。
-- ---------------------------------------------------------------

-- 別名の意味: cid=company_id / ls=last_sent_at / kc=商材が判明しているログ数
--             hs=p_sent_product で送った履歴がある / hn=p_not_sent_product で送った履歴がある
CREATE OR REPLACE FUNCTION resend_candidates(
  p_sent_product uuid DEFAULT NULL,
  p_not_sent_product uuid DEFAULT NULL,
  p_days_since int DEFAULT NULL)
RETURNS TABLE (company_id uuid) LANGUAGE sql STABLE AS $$
WITH a AS (
  SELECT l.company_id cid, max(l.sent_at) ls,
    count(*) FILTER (WHERE l.proposal_product_id IS NOT NULL) kc,
    bool_or(l.proposal_product_id = p_sent_product) hs,
    bool_or(l.proposal_product_id = p_not_sent_product) hn
  FROM email_logs l GROUP BY l.company_id)
SELECT a.cid FROM a
  JOIN companies c ON c.id = a.cid
  LEFT JOIN statuses s ON s.id = c.status_id
WHERE (p_sent_product IS NULL OR COALESCE(a.hs, false))
  AND (p_not_sent_product IS NULL OR (NOT COALESCE(a.hn, false) AND a.kc > 0))
  AND (p_days_since IS NULL OR a.ls <= now() - (p_days_since || ' days')::interval)
  AND COALESCE(s.name, '') NOT IN ('返信あり','商談済','案件中','契約済','契約済み','失注','禁止')
  AND NOT EXISTS (SELECT 1 FROM appointments ap WHERE ap.company_id = a.cid);
$$;


-- ---------------------------------------------------------------
-- ブロック3：実行権限
--
-- 一斉送信の画面から直接呼ぶので authenticated に付ける。anon には付けない。
-- ---------------------------------------------------------------

REVOKE ALL ON FUNCTION resend_candidates(uuid, uuid, int) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION resend_candidates(uuid, uuid, int) TO authenticated, service_role;


-- ---------------------------------------------------------------
-- 動作確認（任意）
-- ---------------------------------------------------------------
-- 90日以上あいている会社
-- SELECT count(*) FROM resend_candidates(NULL, NULL, 90);
--
-- Instagramで送信済み かつ 商材Bは未送信（商材IDは実際の値に置き換える）
-- SELECT count(*) FROM resend_candidates(
--   '<商材AのID>',
--   '<商材BのID>',
--   90);
