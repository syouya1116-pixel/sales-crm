-- 会社名検索のかな正規化（2026-08-17）
--
-- 経緯：
--   「にこっとケア」（ひらがな＋カタカナ混在）が検索でヒットしなかった。
--   src/lib/normalizeSearch.ts の getSearchVariants() は「全部カタカナ」「全部ひらがな」の
--   2パターンしか作らないため、混在表記の会社名はどちらにも一致しない。
--   クエリ側だけを揃えても解決しないので、DB 側もカタカナに寄せて比較するようにした。
--
-- 貼り付け時の注意（[[feedback_supabase_sql_editor_paste]]）：
--   Supabase の SQL Editor は長い SQL を貼ると文字がごっそり欠けることがある。
--   特に kana_norm のかなの羅列は、欠けてもエラーにならず静かに誤った結果を返すので危険。
--   そのため関数を2つに分け、末尾に全86文字の検証クエリを置いてある。必ず実行して 0 を確認すること。

-- 1) かな正規化：空白を除去し、ひらがなをカタカナに寄せる
CREATE OR REPLACE FUNCTION kana_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
SELECT translate(regexp_replace(coalesce(t,''), '[[:space:]　]', '', 'g'),
'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ')
$$;
GRANT EXECUTE ON FUNCTION kana_norm(text) TO authenticated, service_role;

-- 2) 会社名検索：DB 側・クエリ側の両方を kana_norm に通してから比較する
CREATE OR REPLACE FUNCTION search_company_ids_by_name(search_text text)
RETURNS TABLE(id uuid) LANGUAGE sql STABLE AS $$
SELECT c.id FROM companies c
WHERE kana_norm(c.name) ILIKE '%' || kana_norm(search_text) || '%'
$$;
GRANT EXECUTE ON FUNCTION search_company_ids_by_name(text) TO authenticated, service_role;

-- 3) 検証：貼り付けでかなが欠けていないかを全86文字で確認する（必ず 0 になること）
SELECT count(*) AS 欠落文字数 FROM generate_series(12353,12438) i
WHERE kana_norm(chr(i)) <> chr(i+96);

-- 4) 検証：どの表記でも同じ会社に当たること（すべて 1 になること）
SELECT count(*) FROM search_company_ids_by_name('にこっとケア');
SELECT count(*) FROM search_company_ids_by_name('ニコットケア');
SELECT count(*) FROM search_company_ids_by_name('にこっとけあ');

-- 呼び出し元：
--   src/app/page.tsx           顧客一覧の名前検索・サジェスト
--   src/app/bulk-send/page.tsx 一斉送信の会社名フィルター（2026-08-17に ilike 直叩きから移行）
