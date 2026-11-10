-- companies の updated_at 自動更新トリガー（supabase-schema.sql の関数を上書きする版）
--
-- 元の関数はどのカラムが変わったかを見ずに updated_at = now() にしていたため、
-- フォーム送信モードの「取り置き」（form_claimed_by / form_claimed_at をセットするだけの更新）でも
-- 更新日時が動き、顧客一覧（updated_at の降順）で10件が勝手に先頭へ浮上していた。
--
-- 取り置き列だけが変わった更新では更新日時を据え置く。
-- ステータス変更など実際の内容が変わったときは今までどおり now() になる。
--
-- 元に戻したいときは NEW.updated_at = now(); だけの版（supabase-schema.sql）を貼り直す。
-- トリガー（companies_updated_at）はこの関数を呼んでいるので、付け替えは不要。

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  -- 取り置き（form_claimed_*）だけの更新なら更新日時を動かさない。
  -- to_jsonb の '-' は存在しないキーでも無害なので、他テーブルで使い回しても安全。
  IF (to_jsonb(NEW) - 'form_claimed_by' - 'form_claimed_at' - 'updated_at')
     = (to_jsonb(OLD) - 'form_claimed_by' - 'form_claimed_at' - 'updated_at') THEN
    NEW.updated_at = OLD.updated_at;
    RETURN NEW;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
