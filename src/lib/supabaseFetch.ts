import type { PostgrestError } from '@supabase/supabase-js'

// Supabaseは1クエリあたり10000件までしか返さない（Data API の max_rows）。
// 超えた分はエラーも警告もなく黙って切り捨てられるため、
// 全件が必要な箇所では .limit(50000) のような書き方ではなくこのヘルパーを使う。
export const SUPABASE_MAX_ROWS = 10000

// .in() に渡すIDが多すぎるとURLが長くなりすぎて Bad Request になる
const ID_CHUNK_SIZE = 200

type QueryResult<T> = { data: T[] | null; error: PostgrestError | null }

/**
 * range を繰り上げながら全件取得する。
 * makeQuery は毎回新しいクエリを組み立てて返すこと（クエリビルダーは使い回せない）。
 */
export async function fetchAllPaged<T>(
  makeQuery: (from: number, to: number) => PromiseLike<QueryResult<T>>,
  pageSize: number = SUPABASE_MAX_ROWS,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error || !data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

/** ID配列を分割して .in() で問い合わせる（URL長制限の回避） */
export async function fetchByIdChunks<T>(
  ids: string[],
  makeQuery: (chunk: string[]) => PromiseLike<QueryResult<T>>,
  chunkSize: number = ID_CHUNK_SIZE,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data } = await makeQuery(ids.slice(i, i + chunkSize))
    if (data) out.push(...data)
  }
  return out
}
