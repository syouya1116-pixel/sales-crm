'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'
import { Company, CallLog, EmailLog, Appointment } from '@/types'
import confetti from 'canvas-confetti'
import { Trash2, ArrowLeft, Save } from 'lucide-react'
import { ContactField, toFields, filledValues } from '@/lib/contactFields'
import { CompanyFormValues, companyToForm, buildCompanyPayload } from '@/lib/companyForm'
import { findDuplicateContactError } from '@/lib/duplicateCheck'
import { replaceCompanyContacts, replaceProposalProducts } from '@/lib/saveContacts'
import { pickProductForLog } from '@/lib/proposalProductForLog'
import ContactFieldRepeater from '@/components/ContactFieldRepeater'
import CompanyBasicInfoCard from '@/components/company/CompanyBasicInfoCard'
import EmailLogSection from '@/components/company/EmailLogSection'
import CallLogSection from '@/components/company/CallLogSection'
import AppointmentSection from '@/components/company/AppointmentSection'
import { INPUT_CLASS } from '@/lib/formStyles'
import { statusColor } from '@/lib/statusColors'

type Option = { id: string; name: string }

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { data: session } = useSession()

  const [company, setCompany] = useState<Company | null>(null)
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  const [statuses, setStatuses] = useState<Option[]>([])
  const [salesReps, setSalesReps] = useState<Option[]>([])
  const [proposalProducts, setProposalProducts] = useState<Option[]>([])
  const [genres, setGenres] = useState<Option[]>([])

  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formLogging, setFormLogging] = useState(false)
  /** 送信ログに残す商材の初期値。持ち商材が複数でも今月の目標から1つに決まればそれ */
  const [autoProductId, setAutoProductId] = useState<string | null>(null)

  const [form, setForm] = useState<CompanyFormValues>(companyToForm(null))
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [urlFields, setUrlFields] = useState<ContactField[]>([{ value: '', label: '' }])
  const [phoneFields, setPhoneFields] = useState<ContactField[]>([{ value: '', label: '' }])
  const [emailFields, setEmailFields] = useState<ContactField[]>([{ value: '', label: '' }])

  const patchForm = (patch: Partial<CompanyFormValues>) => setForm(prev => ({ ...prev, ...patch }))

  const fetchCompany = async () => {
    const { data } = await supabase
      .from('companies')
      .select(`*, statuses(id, name), sales_reps(id, name), company_proposal_products(proposal_product_id, proposal_products(id, name)), company_urls(*), company_phones(*), company_emails(*)`)
      .eq('id', id)
      .single()
    if (data) setCompany(data)
    setLoading(false)
  }

  const fetchLogs = async () => {
    const [callsRes, emailsRes, aptsRes] = await Promise.all([
      supabase.from('call_logs').select('*').eq('company_id', id).order('called_at', { ascending: false }),
      supabase.from('email_logs').select('*, company_emails(email), proposal_products(id, name)').eq('company_id', id).order('sent_at', { ascending: false }),
      supabase.from('appointments').select('*').eq('company_id', id).order('start_at', { ascending: false }),
    ])
    if (callsRes.data) setCallLogs(callsRes.data)
    if (emailsRes.data) setEmailLogs(emailsRes.data)
    if (aptsRes.data) setAppointments(aptsRes.data)
  }

  useEffect(() => {
    fetchCompany()
    fetchLogs()
    Promise.all([
      supabase.from('statuses').select('id, name').order('sort_order'),
      supabase.from('sales_reps').select('id, name').order('name'),
      supabase.from('proposal_products').select('id, name').order('sort_order'),
      supabase.from('genres').select('id, name').order('sort_order'),
    ]).then(([s, r, p, g]) => {
      if (s.data) setStatuses(s.data)
      if (r.data) setSalesReps(r.data)
      if (p.data) setProposalProducts(p.data)
      if (g.data) setGenres(g.data)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 取得関数は描画のたびに作り直されるため、表示中の会社IDの変化だけを見る
  }, [id])

  // 顧客データをフォームに反映
  useEffect(() => {
    if (!company) return
    setForm(companyToForm(company))
    setUrlFields(toFields(company.company_urls, u => u.url))
    setPhoneFields(toFields(company.company_phones, p => p.phone))
    setEmailFields(toFields(company.company_emails, e => e.email))
    setSelectedProductIds(company.company_proposal_products?.map(cp => cp.proposal_product_id) || [])
  }, [company])

  // 送信ログに残す商材の候補。画面で選び直しただけの未保存状態は拾わない
  const companyProducts: Option[] = (company?.company_proposal_products ?? [])
    .filter(cp => cp.proposal_products?.id)
    .map(cp => ({ id: cp.proposal_products.id, name: cp.proposal_products.name }))

  // 候補が複数でも、今月の目標が入っている商材が1つだけならそれを初期値にする
  useEffect(() => {
    const ids = companyProducts.map(p => p.id)
    if (ids.length === 0) {
      setAutoProductId(null)
      return
    }
    let alive = true
    pickProductForLog(supabase, ids).then(pid => { if (alive) setAutoProductId(pid) })
    return () => { alive = false }
    // 商材の組み合わせが変わったときだけ引き直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyProducts.map(p => p.id).sort().join(',')])

  const statusName = statuses.find(s => s.id === form.status_id)?.name || ''
  const isBanned = statusName === '禁止'
  const isContracted = statusName === '契約済み'

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    // 重複チェックのルールは新規登録（CompanyForm）と共通。判定は src/lib/duplicateCheck.ts に集約。
    const dupError = await findDuplicateContactError({
      emails: filledValues(emailFields),
      phones: filledValues(phoneFields),
      urls: filledValues(urlFields),
    }, id)
    if (dupError) {
      setError(dupError)
      setSaving(false)
      return
    }

    const { error: updateErr } = await supabase
      .from('companies')
      .update(buildCompanyPayload(form, isContracted))
      .eq('id', id)
    if (updateErr) {
      setError(`保存に失敗しました：${updateErr.message}`)
      setSaving(false)
      return
    }

    const productError = await replaceProposalProducts(id, selectedProductIds)
    if (productError) {
      setError(productError)
      setSaving(false)
      return
    }

    const contactError = await replaceCompanyContacts(id, {
      urls: urlFields, phones: phoneFields, emails: emailFields,
    })
    if (contactError) {
      setError(contactError)
      setSaving(false)
      return
    }

    if (isContracted) {
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 }, colors: ['#3b82f6', '#8b5cf6', '#10b981'], gravity: 0.8, scalar: 0.8, drift: 0 })
    }

    setSaving(false)
    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 2000)
    fetchCompany()
  }

  // フォーム送信を記録し、「送信予定」なら「送信済」に自動変更する
  // 商材はメール履歴セクションの「実績商材」で選んだものを受け取る。
  // 選択欄を出していない（持ち商材が1つ以下の）ときは自動判定の結果がそのまま来る
  const handleFormLog = async (proposalProductId: string | null) => {
    setFormLogging(true)
    setError(null)
    const { error: logErr } = await supabase.from('email_logs').insert({
      company_id: id,
      subject: '（フォーム送信）',
      sent_by: session?.user?.email || null,
      send_type: 'form',
      proposal_product_id: proposalProductId,
    })
    if (logErr) {
      setError(`フォーム送信の記録に失敗しました：${logErr.message}`)
      setFormLogging(false)
      return
    }
    if (statusName === '送信予定') {
      const sentStatus = statuses.find(s => s.name === '送信済')
      if (sentStatus) {
        const { error: stErr } = await supabase.from('companies').update({ status_id: sentStatus.id }).eq('id', id)
        if (stErr) {
          setError(`記録はできましたが、ステータスの変更に失敗しました：${stErr.message}`)
        } else {
          patchForm({ status_id: sentStatus.id })
        }
      }
    }
    fetchLogs()
    setFormLogging(false)
  }

  const handleDelete = async () => {
    if (!confirm('この顧客を削除しますか？')) return
    const { error: delErr } = await supabase.from('companies').delete().eq('id', id)
    if (delErr) {
      setError(`削除に失敗しました：${delErr.message}`)
      return
    }
    router.push('/')
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">読み込み中...</div>
  if (!company) return <div className="p-6 text-sm text-slate-400">顧客が見つかりません</div>

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      {/* ステータスバナー */}
      {isContracted && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2.5">
          <span className="text-emerald-500 text-lg">🎉</span>
          <div>
            <p className="text-sm font-semibold text-emerald-800">契約済みクライアント</p>
            <p className="text-xs text-emerald-600 mt-0.5">このクライアントは契約が完了しています</p>
          </div>
        </div>
      )}
      {isBanned && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2.5">
          <span className="text-red-500 text-lg">🚫</span>
          <div>
            <p className="text-sm font-semibold text-red-800">送信・連絡禁止</p>
            <p className="text-xs text-red-600 mt-0.5">このクライアントへのメール送信は禁止されています</p>
          </div>
        </div>
      )}

      {/* ページヘッダー。スマホでは会社名と操作ボタンを上下に分ける */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.push('/')} className="flex items-center gap-1.5 shrink-0 text-sm text-slate-500 hover:text-slate-800 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg px-3 min-h-11 lg:min-h-0 lg:py-1.5 transition">
            <ArrowLeft size={14} />一覧に戻る
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="text-xl font-bold text-slate-800 truncate">{company.name}</h1>
            {statusName && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${statusColor(statusName)}`}>
                {statusName}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={form.status_id}
            onChange={e => patchForm({ status_id: e.target.value })}
            className="flex-1 lg:flex-none text-xs px-3 min-h-11 lg:min-h-0 lg:py-1.5 rounded-lg border border-slate-200 bg-white/80 text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
          >
            <option value="">未設定</option>
            {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 min-h-11 lg:min-h-0 lg:py-1.5 text-sm font-medium transition disabled:opacity-50"
          >
            <Save size={13} />{saving ? '保存中...' : saveSuccess ? '保存済み ✓' : '保存'}
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center justify-center gap-1.5 text-red-400 hover:text-red-600 border border-red-200 hover:border-red-300 rounded-lg px-3 min-h-11 lg:min-h-0 lg:py-1.5 text-sm transition"
          >
            <Trash2 size={13} />削除
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 whitespace-pre-line">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 左カラム */}
        <div className="lg:col-span-1 space-y-4">
          <CompanyBasicInfoCard
            form={form}
            onChange={patchForm}
            salesReps={salesReps}
            genres={genres}
            proposalProducts={proposalProducts}
            selectedProductIds={selectedProductIds}
            onProductsChange={setSelectedProductIds}
            isContracted={isContracted}
          />
        </div>

        {/* 右カラム */}
        <div className="lg:col-span-2 space-y-4">
          <EmailLogSection
            companyId={id}
            companyEmails={company.company_emails ?? []}
            logs={emailLogs}
            isBanned={isBanned}
            companyProducts={companyProducts}
            autoProductId={autoProductId}
            formLogging={formLogging}
            onFormLog={handleFormLog}
            onRefresh={fetchLogs}
            onError={setError}
          />

          <CallLogSection companyId={id} logs={callLogs} onRefresh={fetchLogs} />

          <AppointmentSection
            companyId={id}
            appointments={appointments}
            onAppointmentsChange={updater => setAppointments(updater)}
            currentUserEmail={session?.user?.email}
            onRefresh={fetchLogs}
          />

          {/* 連絡先 */}
          <div className="premium-card rounded-2xl p-5 space-y-4">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">連絡先</h2>
            <ContactFieldRepeater
              compact
              title="電話番号"
              inputType="tel"
              valuePlaceholder="電話番号"
              fields={phoneFields}
              onChange={setPhoneFields}
            />
            <ContactFieldRepeater
              compact
              title="メールアドレス・問い合わせフォーム"
              valuePlaceholder="メール/URL"
              fields={emailFields}
              onChange={setEmailFields}
            />
            <ContactFieldRepeater
              compact
              title="URL"
              inputType="url"
              valuePlaceholder="https://..."
              fields={urlFields}
              onChange={setUrlFields}
            />
          </div>

          {/* 備考 */}
          <div className="premium-card rounded-2xl p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">備考</h2>
            <textarea
              rows={12}
              value={form.notes}
              onChange={e => patchForm({ notes: e.target.value })}
              placeholder="自由記述..."
              className={INPUT_CLASS + ' resize-y'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
