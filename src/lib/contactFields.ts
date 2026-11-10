/** 連絡先（URL・電話・メール）1件分の入力値。3種類とも同じ形で扱う */
export type ContactField = { value: string; label: string }

export const emptyField = (): ContactField => ({ value: '', label: '' })

/**
 * 連絡先の行を登録順（sort_order → id）に並べた新しい配列を返す。
 *
 * Supabase の埋め込み取得は並び順を保証しない。以前は一斉送信が id 順
 * （＝ランダムな UUID 順）で「先頭のメールアドレス」を決めていて、
 * 詳細画面で1番目に見えているのと別のアドレスへ送ることがあった。
 */
export function sortContacts<T extends { id?: string; sort_order?: number | null }>(rows: T[] | undefined | null): T[] {
  return [...(rows ?? [])].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? '').localeCompare(b.id ?? ''))
}

/** DBから取れた行を入力欄の形にする（登録順に並べる）。0件のときは空欄を1つ出す */
export function toFields<T extends { id?: string; label?: string | null; sort_order?: number | null }>(
  rows: T[] | undefined | null,
  pick: (row: T) => string,
): ContactField[] {
  if (!rows || rows.length === 0) return [emptyField()]
  return sortContacts(rows).map(r => ({ value: pick(r), label: r.label || '' }))
}

/** 空欄を除いた入力値のみ */
export const filledFields = (fields: ContactField[]): ContactField[] =>
  fields.filter(f => f.value.trim())

/** 空欄を除いた文字列だけの配列（重複チェック用） */
export const filledValues = (fields: ContactField[]): string[] =>
  fields.filter(f => f.value.trim()).map(f => f.value.trim())

export type ContactSyncPlan = {
  deleteIds: string[]
  updates: { id: string; label: string | null; sort_order: number }[]
  inserts: { value: string; label: string | null; sort_order: number }[]
}

/**
 * 保存済みの行と入力内容を突き合わせ、何を消し・何を直し・何を足すかを決める。
 *
 * 全消し→入れ直しにすると行の id が毎回変わり、email_logs.company_email_id
 * （ON DELETE SET NULL）が外れてメール履歴の「宛先」が消えていた。
 * 値が同じ行は id を残したまま label と並び順だけ更新する。
 * existing / desired の value は保存形式に整形済みのものを渡すこと。
 */
export function planContactSync(
  existing: { id: string; value: string }[],
  desired: { value: string; label: string }[],
): ContactSyncPlan {
  const unused = [...existing]
  const plan: ContactSyncPlan = { deleteIds: [], updates: [], inserts: [] }
  desired.forEach((d, i) => {
    const label = d.label || null
    const idx = unused.findIndex(e => e.value === d.value)
    if (idx >= 0) {
      plan.updates.push({ id: unused[idx].id, label, sort_order: i })
      unused.splice(idx, 1)
    } else {
      plan.inserts.push({ value: d.value, label, sort_order: i })
    }
  })
  plan.deleteIds = unused.map(e => e.id)
  return plan
}
