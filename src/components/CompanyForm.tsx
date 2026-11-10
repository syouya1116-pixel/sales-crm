'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'
import { Company, Status, SalesRep, ProposalProduct } from '@/types'
import confetti from 'canvas-confetti'
import { ContactField, toFields, filledFields, filledValues } from '@/lib/contactFields'
import { CompanyFormValues, companyToForm, buildCompanyPayload } from '@/lib/companyForm'
import { findDuplicateContactError } from '@/lib/duplicateCheck'
import { replaceCompanyContacts, replaceProposalProducts } from '@/lib/saveContacts'
import { pickProductForLog } from '@/lib/proposalProductForLog'
import { INPUT_CLASS } from '@/lib/formStyles'
import ContactFieldRepeater from '@/components/ContactFieldRepeater'
import ContractRevenueFields from '@/components/company/ContractRevenueFields'
import { ROTATION_REP_NAMES } from '@/config/team'

type Props = {
  company?: Company
  onSuccess: (id: string) => void
}

// 業務委託スタッフ用：表示ラベル → 実際のステータス名
const STAFF_STATUS_OPTIONS = [
  { label: 'メール', statusName: '送信予定' },
  { label: 'フォーム', statusName: 'フォーム' },
]
// 業務委託スタッフの登録は提案商材をこれに固定
const STAFF_FIXED_PRODUCT = 'Instagram'
// 業務委託スタッフの登録は営業担当を交互に割り当て（src/config/team.ts）
const ROTATION_REPS = ROTATION_REP_NAMES

export default function CompanyForm({ company, onSuccess }: Props) {
  const { data: session } = useSession()
  const isStaff = session?.user?.role === 'staff'
  const [statuses, setStatuses] = useState<Status[]>([])
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])
  const [proposalProducts, setProposalProducts] = useState<ProposalProduct[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formSent, setFormSent] = useState(false)
  // 業務委託スタッフ用：メールアドレスがなくフォームURLで対応する場合のチェック
  const [useFormUrl, setUseFormUrl] = useState(false)

  const [form, setForm] = useState<CompanyFormValues>(companyToForm(company))
  const patchForm = (patch: Partial<CompanyFormValues>) => setForm(prev => ({ ...prev, ...patch }))

  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(
    company?.company_proposal_products?.map(cp => cp.proposal_product_id) || []
  )

  const [urls, setUrls] = useState<ContactField[]>(toFields(company?.company_urls, u => u.url))
  const [phones, setPhones] = useState<ContactField[]>(toFields(company?.company_phones, p => p.phone))
  const [emails, setEmails] = useState<ContactField[]>(toFields(company?.company_emails, e => e.email))

  useEffect(() => {
    const fetch = async () => {
      const [s, r, p] = await Promise.all([
        supabase.from('statuses').select('*').order('sort_order'),
        supabase.from('sales_reps').select('*').order('name'),
        supabase.from('proposal_products').select('*').order('sort_order'),
      ])
      if (s.data) setStatuses(s.data)
      if (r.data) setSalesReps(r.data)
      if (p.data) setProposalProducts(p.data)
    }
    fetch()
  }, [])

  // 業務委託スタッフの新規登録は「メール」(送信予定)を初期選択にする
  // （セッションと選択肢の読み込みがどちらも終わってから決めるため effect で行う）
  useEffect(() => {
    if (!isStaff || company || form.status_id || statuses.length === 0) return
    const defaultStatus = statuses.find(s => s.name === STAFF_STATUS_OPTIONS[0].statusName)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 読み込み完了後に一度だけ初期値を入れる
    if (defaultStatus) setForm(f => ({ ...f, status_id: defaultStatus.id }))
  }, [isStaff, company, form.status_id, statuses])

  const selectedStatus = statuses.find(s => s.id === form.status_id)
  const isContracted = selectedStatus?.name === '契約済み'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const validEmails = filledFields(emails)

    // 業務委託スタッフの必須チェック（特集名・URL・メールアドレス）
    // 「フォームURL入力」にチェックが入っている場合はメールアドレスを免除
    if (isStaff) {
      if (!form.genre.trim()) {
        setError('特集名を入力してください')
        setSaving(false)
        return
      }
      if (filledFields(urls).length === 0) {
        setError('URLを入力してください')
        setSaving(false)
        return
      }
      if (!useFormUrl && validEmails.length === 0) {
        setError('メールアドレスを入力してください（メールアドレスがない場合は「フォームURL入力」にチェックを入れてください）')
        setSaving(false)
        return
      }
    }

    // 重複チェックのルールは顧客詳細ページと共通。判定は src/lib/duplicateCheck.ts に集約。
    const dupError = await findDuplicateContactError({
      emails: filledValues(emails),
      phones: filledValues(phones),
      urls: filledValues(urls),
    }, company?.id)
    if (dupError) {
      setError(dupError)
      setSaving(false)
      return
    }

    // 業務委託スタッフの新規登録：営業担当を山田・鈴木で交互に自動割り当て
    // （直近に登録された顧客の担当を見て、その逆をセット）
    let autoSalesRepId: string | null = null
    if (isStaff && !company) {
      const repA = salesReps.find(r => r.name === ROTATION_REPS[0])
      const repB = salesReps.find(r => r.name === ROTATION_REPS[1])
      const { data: last } = await supabase
        .from('companies')
        .select('sales_rep_id')
        .not('sales_rep_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      autoSalesRepId = (last?.sales_rep_id === repA?.id ? repB?.id : repA?.id) ?? null
    }

    const payload = {
      ...buildCompanyPayload(form, !!isContracted),
      sales_rep_id: isStaff && !company ? autoSalesRepId : (form.sales_rep_id || null),
      // スタッフ側では入力欄を出していない項目は未設定で保存
      service_name: isStaff ? null : form.service_name,
      address: isStaff ? null : form.address,
      notes: isStaff ? null : form.notes,
    }

    let companyId = company?.id
    if (company) {
      await supabase.from('companies').update(payload).eq('id', company.id)
    } else {
      // 新規登録時のみ作成者(ログインユーザー/スタッフ)を記録
      const { data } = await supabase
        .from('companies')
        .insert({ ...payload, created_by: session?.user?.email || null })
        .select()
        .single()
      companyId = data?.id
    }

    if (!companyId) { setSaving(false); return }

    // 提案商材：スタッフ側は選択UIを出さず Instagram に固定
    const staffProductId = proposalProducts.find(p => p.name === STAFF_FIXED_PRODUCT)?.id
    const productIds = isStaff ? (staffProductId ? [staffProductId] : []) : selectedProductIds
    const productError = await replaceProposalProducts(companyId, productIds)
    if (productError) {
      setError(productError)
      setSaving(false)
      return
    }

    const contactError = await replaceCompanyContacts(companyId, { urls, phones, emails })
    if (contactError) {
      setError(contactError)
      setSaving(false)
      return
    }

    // 新規登録時にフォーム送信済みチェックが入っていれば記録 + 送信予定→送信済に自動変更
    if (!company && formSent) {
      await supabase.from('email_logs').insert({
        company_id: companyId,
        subject: '（フォーム送信）',
        sent_by: session?.user?.email || null,
        send_type: 'form',
        // 今まさに保存した商材から1つに絞る。
        // 複数でも今月の目標が入っているものが1つだけならそれで確定する
        proposal_product_id: await pickProductForLog(supabase, productIds),
      })
      if (selectedStatus?.name === '送信予定') {
        const sentStatus = statuses.find(s => s.name === '送信済')
        if (sentStatus) {
          await supabase.from('companies').update({ status_id: sentStatus.id }).eq('id', companyId)
        }
      }
    }

    if (isContracted) {
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 }, colors: ['#3b82f6', '#8b5cf6', '#10b981'], gravity: 0.8, scalar: 0.8, drift: 0 })
    }

    setSaving(false)
    onSuccess(companyId)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="premium-card rounded-2xl p-6 space-y-5">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">基本情報</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">会社名 <span className="text-red-500">*</span></label>
            <input required type="text" value={form.name} onChange={e => patchForm({ name: e.target.value })} className={INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">ステータス</label>
            <select value={form.status_id} onChange={e => patchForm({ status_id: e.target.value })} className={INPUT_CLASS}>
              {isStaff ? (
                STAFF_STATUS_OPTIONS.map(o => {
                  const s = statuses.find(x => x.name === o.statusName)
                  return s ? <option key={s.id} value={s.id}>{o.label}</option> : null
                })
              ) : (
                <>
                  <option value="">未設定</option>
                  {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </>
              )}
            </select>
          </div>
          {!isStaff && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">営業担当</label>
              <select value={form.sales_rep_id} onChange={e => patchForm({ sales_rep_id: e.target.value })} className={INPUT_CLASS}>
                <option value="">未設定</option>
                {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          {!isStaff && (
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-2">提案商材</label>
              <div className="flex flex-wrap gap-2">
                {proposalProducts.map(p => {
                  const checked = selectedProductIds.includes(p.id)
                  return (
                    <label key={p.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition select-none ${checked ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked}
                        onChange={() => setSelectedProductIds(prev =>
                          prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                        )}
                      />
                      {checked && <span className="text-indigo-500 text-xs">✓</span>}
                      {p.name}
                    </label>
                  )
                })}
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-500 mb-1">代表者名</label>
            <input type="text" value={form.representative_name} onChange={e => patchForm({ representative_name: e.target.value })} className={INPUT_CLASS} />
          </div>
          {!isStaff && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">サービス名</label>
              <input type="text" value={form.service_name} onChange={e => patchForm({ service_name: e.target.value })} className={INPUT_CLASS} />
            </div>
          )}
          <div>
            {/* スタッフ側は「特集名」表記（中身はジャンルと同じ genre カラム） */}
            <label className="block text-xs text-gray-500 mb-1">
              {isStaff ? '特集名' : 'ジャンル名'}
              {isStaff && <span className="text-red-500"> *</span>}
            </label>
            <input required={isStaff} type="text" value={form.genre} onChange={e => patchForm({ genre: e.target.value })} className={INPUT_CLASS} />
          </div>
          {!isStaff && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">住所</label>
              <input type="text" value={form.address} onChange={e => patchForm({ address: e.target.value })} className={INPUT_CLASS} />
            </div>
          )}
        </div>
        {isContracted && (
          <div className="border-t border-gray-100 pt-4 mt-2">
            <ContractRevenueFields values={form} onChange={patchForm} />
          </div>
        )}
      </div>

      <div className="premium-card rounded-2xl p-6">
        <ContactFieldRepeater
          title="電話番号"
          inputType="tel"
          valuePlaceholder="電話番号"
          labelPlaceholder="ラベル（例：代表）"
          fields={phones}
          onChange={setPhones}
        />
      </div>

      <div className="premium-card rounded-2xl p-6">
        <ContactFieldRepeater
          title={
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              メールアドレス
              {isStaff && !useFormUrl && <span className="text-red-500 normal-case"> *</span>}
            </h2>
          }
          inputType="email"
          valuePlaceholder="メールアドレス"
          labelPlaceholder="ラベル（例：担当者）"
          fields={emails}
          onChange={setEmails}
          requiredFirst={isStaff && !useFormUrl}
        >
          {isStaff && (
            <label className="flex items-center gap-2.5 mb-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useFormUrl}
                onChange={ev => setUseFormUrl(ev.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600"
              />
              <span className="text-sm text-slate-700">フォームURL入力</span>
              <span className="text-xs text-slate-400">メールアドレスがない場合はこちら</span>
            </label>
          )}
        </ContactFieldRepeater>
      </div>

      <div className="premium-card rounded-2xl p-6">
        <ContactFieldRepeater
          title={
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              URL
              {isStaff && <span className="text-red-500"> *</span>}
            </h2>
          }
          inputType="url"
          valuePlaceholder="https://example.com"
          labelPlaceholder="ラベル（例：HP）"
          fields={urls}
          onChange={setUrls}
          requiredFirst={isStaff}
        />
      </div>

      {/* 備考 */}
      {!isStaff && (
        <div className="premium-card rounded-2xl p-6">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">備考</label>
          <textarea value={form.notes} onChange={e => patchForm({ notes: e.target.value })} rows={8} placeholder="自由記述..." className={INPUT_CLASS + ' resize-y'} />
        </div>
      )}

      {!company && !isStaff && (
        <div className="premium-card rounded-2xl p-5">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={formSent}
              onChange={e => setFormSent(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600"
            />
            <div>
              <p className="text-sm text-slate-700">登録時に問い合わせフォームを送信済み</p>
              <p className="text-xs text-slate-400 mt-0.5">チェックするとメール履歴にフォーム送信として記録されます</p>
            </div>
          </label>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600 whitespace-pre-line">
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <button type="submit" disabled={saving} className="tap-target w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50 shadow-sm">
          {saving ? '保存中...' : '保存する'}
        </button>
      </div>
    </form>
  )
}
