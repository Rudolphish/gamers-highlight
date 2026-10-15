-- public スキーマの全テーブルで RLS（行レベルセキュリティ）を有効にする。ルールは書かない。
--
-- Supabase は外から叩ける Web API（Data API / PostgREST）を持っており、anon キー
-- （管理画面に表示される、秘密扱いではない鍵）とプロジェクトのURLがあれば、
-- RLS が無効なテーブルは誰でも読み書き・削除できる。2026-10-15 の脆弱性チェックで
-- 全28テーブルがこの状態だと分かり、同日に本番へ流した（Supabase コネクタ経由）。
--
-- **アプリには影響しない。** アプリは接続プーラー経由で `postgres` ロールとして接続しており、
-- このロールは RLS を無視できる（rolbypassrls = true。本番で確認済み）。
-- ルールを1つも書かないので、anon / authenticated からは何も見えず何も書けない。
--
-- **`prisma db push` で作ったテーブルには RLS が付かない。** 新しいテーブルを本番に作ったら
-- これをもう一度流す（何度流しても同じ結果になる）。確認は Supabase のアドバイザーで
-- 「RLS Disabled in Public」（ERROR）が0件であること。docs/review-checklist.md にも項目がある。
--
-- 戻すときは ENABLE を DISABLE に変えて流す。
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
