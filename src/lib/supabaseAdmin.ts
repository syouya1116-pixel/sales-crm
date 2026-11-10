import { createClient } from '@supabase/supabase-js'

// service_role キーを使うサーバー専用クライアント（RLSをバイパスする）。
// 絶対にクライアントコンポーネントから import しないこと。
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)
