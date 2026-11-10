export type Status = {
  id: string
  name: string
  sort_order: number
}

export type SalesRep = {
  id: string
  name: string
}

export type ProposalProduct = {
  id: string
  name: string
  sort_order: number
}

export type CompanyUrl = {
  id: string
  company_id: string
  url: string
  label: string | null
  sort_order: number
}

export type CompanyPhone = {
  id: string
  company_id: string
  phone: string
  label: string | null
  sort_order: number
}

export type CompanyEmail = {
  id: string
  company_id: string
  email: string
  label: string | null
  sort_order: number
}

export type Company = {
  id: string
  name: string
  status_id: string | null
  representative_name: string | null
  service_name: string | null
  genre: string | null
  address: string | null
  notes: string | null
  sales_rep_id: string | null
  instagram_revenue: number | null
  line_revenue: number | null
  contracted_at: string | null
  cancel_instagram_revenue: number | null
  cancel_line_revenue: number | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  // 最終送信日。email_logs の INSERT トリガーが更新する（supabase-last-emailed-at.sql）。
  // アプリ側からは書き込まない
  last_emailed_at: string | null
  statuses?: Status
  sales_reps?: SalesRep
  company_proposal_products?: { proposal_product_id: string; proposal_products: ProposalProduct }[]
  company_urls?: CompanyUrl[]
  company_phones?: CompanyPhone[]
  company_emails?: CompanyEmail[]
}

export type EmailLog = {
  id: string
  company_id: string
  company_email_id: string | null
  subject: string | null
  body: string | null
  sent_at: string
  sent_by: string | null
  gmail_message_id: string | null
  send_type: 'email' | 'form'
  // どの商材の実績として送ったか。null は集計・KPIに乗らない
  proposal_product_id: string | null
  company_emails?: CompanyEmail
  proposal_products?: { id: string; name: string } | null
}

export type CallLog = {
  id: string
  company_id: string
  direction: 'inbound' | 'outbound'
  duration_seconds: number | null
  notes: string | null
  called_at: string
  logged_by: string | null
}

export type Appointment = {
  id: string
  company_id: string
  title: string | null
  start_at: string | null
  end_at: string | null
  google_event_id: string | null
  created_by: string | null
  created_at: string
}
