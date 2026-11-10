// node --test 用の解決フック。
// Next.js のビルドと違って素の Node には bundler 解決もパスエイリアスもないため、
// 最低限ここで補っている。
//   - 拡張子なしの相対 import（'./normalize'）を .ts に解決する
//   - '@/xxx' を src/xxx に解決する
//   - ブラウザ専用の Supabase クライアントをテスト用の偽物に差し替える
//     （本物は読み込むだけで環境変数を要求して落ちるため）
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(import.meta.dirname, '..')
const FAKE_SUPABASE = pathToFileURL(path.join(ROOT, 'test/fakeSupabase.ts')).href

const asUrl = filePath => ({ url: pathToFileURL(filePath).href, shortCircuit: true })

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './supabase' || specifier === './supabase.ts') {
      return { url: FAKE_SUPABASE, shortCircuit: true }
    }

    if (specifier.startsWith('@/')) {
      const base = path.join(ROOT, 'src', specifier.slice(2))
      for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return asUrl(candidate)
      }
    }

    if (specifier.startsWith('.') && !path.extname(specifier) && context.parentURL) {
      const base = path.resolve(path.dirname(new URL(context.parentURL).pathname), specifier)
      for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
        if (fs.existsSync(candidate)) return asUrl(candidate)
      }
    }

    return nextResolve(specifier, context)
  },
})
