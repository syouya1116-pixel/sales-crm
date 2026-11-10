// import type にしておくと、テスト実行時（node --test の型ストリップ）に
// パスエイリアスを解決しにいかずに済む
import type { Company } from '@/types'

/** 顧客の入力フォームの値。新規登録（CompanyForm）と編集（顧客詳細）で共通 */
export type CompanyFormValues = {
  name: string
  status_id: string
  representative_name: string
  service_name: string
  genre: string
  address: string
  notes: string
  sales_rep_id: string
  instagram_revenue: string | number
  line_revenue: string | number
  contracted_at: string
  cancel_instagram_revenue: string | number
  cancel_line_revenue: string | number
  cancelled_at: string
}

export function companyToForm(company?: Company | null): CompanyFormValues {
  return {
    name: company?.name || '',
    status_id: company?.status_id || '',
    representative_name: company?.representative_name || '',
    service_name: company?.service_name || '',
    genre: company?.genre || '',
    address: company?.address || '',
    notes: company?.notes || '',
    sales_rep_id: company?.sales_rep_id || '',
    instagram_revenue: company?.instagram_revenue ?? '',
    line_revenue: company?.line_revenue ?? '',
    contracted_at: company?.contracted_at ?? '',
    cancel_instagram_revenue: company?.cancel_instagram_revenue ?? '',
    cancel_line_revenue: company?.cancel_line_revenue ?? '',
    cancelled_at: company?.cancelled_at ?? '',
  }
}

/**
 * companies テーブルに送る値を組み立てる。
 * 契約済み以外のときに金額・日付を null で消すルールをここ1か所に集約している。
 */
export function buildCompanyPayload(form: CompanyFormValues, isContracted: boolean) {
  return {
    ...form,
    status_id: form.status_id || null,
    sales_rep_id: form.sales_rep_id || null,
    instagram_revenue: isContracted && form.instagram_revenue !== '' ? Number(form.instagram_revenue) : null,
    line_revenue: isContracted && form.line_revenue !== '' ? Number(form.line_revenue) : null,
    contracted_at: isContracted && form.contracted_at ? form.contracted_at : null,
    cancel_instagram_revenue: isContracted && form.cancel_instagram_revenue !== '' ? Number(form.cancel_instagram_revenue) : null,
    cancel_line_revenue: isContracted && form.cancel_line_revenue !== '' ? Number(form.cancel_line_revenue) : null,
    cancelled_at: isContracted && form.cancelled_at ? form.cancelled_at : null,
  }
}
