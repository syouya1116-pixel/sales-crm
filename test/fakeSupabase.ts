// テスト用のニセ Supabase クライアント。
// duplicateCheck.ts が使う 3 つの呼び出しだけを、本物と同じ挙動で再現している。
//   1. from('company_emails').select(...).ilike('email', 値)
//   2. rpc('search_phones_normalized', { search_text })
//   3. from('company_urls').select(...).ilike('url', '%値%')［.neq() / .limit() も繋げられる］
// test/hooks.mjs の resolve フックで './supabase' をこのファイルに差し替える。

type Row = Record<string, string>

export const db: { company_emails: Row[]; company_phones: Row[]; company_urls: Row[] } = {
  company_emails: [],
  company_phones: [],
  company_urls: [],
}

export function resetDb(): void {
  db.company_emails = []
  db.company_phones = []
  db.company_urls = []
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** PostgreSQL の ILIKE（% がワイルドカード・大文字小文字を無視） */
function ilikeMatch(value: string, pattern: string): boolean {
  const source = '^' + pattern.split('%').map(escapeRegExp).join('.*') + '$'
  return new RegExp(source, 'i').test(value)
}

/** search_phones_normalized RPC と同じく、数字以外を除去して部分一致する */
function phoneMatch(stored: string, query: string): boolean {
  const digits = (s: string) => s.replace(/\D/g, '')
  return digits(stored).includes(digits(query))
}

type Result = { data: Row[]; error: null }

/**
 * ilike のあとに .neq() / .limit() を繋げられるようにしたクエリ。
 * 本物と同じく、await した時点で初めて結果が確定する（thenable）。
 */
type Query = PromiseLike<Result> & {
  neq(column: string, value: string): Query
  limit(n: number): Query
}

function makeQuery(rows: Row[]): Query {
  return {
    neq: (column, value) => makeQuery(rows.filter(row => row[column] !== value)),
    limit: n => makeQuery(rows.slice(0, n)),
    then: (onfulfilled, onrejected) =>
      Promise.resolve<Result>({ data: rows, error: null }).then(onfulfilled, onrejected),
  }
}

export const supabase = {
  from(table: keyof typeof db) {
    return {
      select(_columns: string) {
        return {
          ilike(column: string, pattern: string) {
            return makeQuery(db[table].filter(row => ilikeMatch(row[column] ?? '', pattern)))
          },
        }
      },
    }
  },

  rpc(fn: string, args: { search_text: string }) {
    if (fn !== 'search_phones_normalized') {
      throw new Error(`テストで未対応のRPCが呼ばれました: ${fn}`)
    }
    const data = db.company_phones
      .filter(row => phoneMatch(row.phone ?? '', args.search_text))
      .map(row => ({ company_id: row.company_id }))
    return Promise.resolve({ data, error: null })
  },
}
