'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Trash2, Plus, Save, X, Pencil } from 'lucide-react'
import { ACCOUNTS, emailToName } from '@/lib/emailToName'
import MasterListCard from '@/components/settings/MasterListCard'
import HolidayCard from '@/components/settings/HolidayCard'
import { RESEND_ALLOWED_EMAILS } from '@/lib/featureFlags'
import { IS_DEMO } from '@/lib/demo'
import DemoCms, { DemoCmsNav } from '@/components/settings/demo/DemoCms'
import TemplateAssist from '@/components/settings/demo/TemplateAssist'

type Status = { id: string; name: string; sort_order: number }
type SalesRep = { id: string; name: string }
type ProposalProduct = { id: string; name: string; sort_order: number }
type Genre = { id: string; name: string; sort_order: number }
type AdminUser = { id: string; email: string }
type CsvAlias = { id: string; csv_header: string; field_key: string }
type EmailTemplate = { id: string; name: string; subject: string; body: string; proposal_product_id: string | null; owner_email: string | null }
type Staff = { id: string; login_id: string; display_name: string; active: boolean; created_at: string }

const FIELD_KEY_LABELS: Record<string, string> = {
  url: 'URL',
  status: 'ステータス',
  name: '会社名',
  representative_name: '代表者名',
  service_name: 'サービス名',
  phone: '電話番号',
  email: 'メールアドレス',
  sent_date: '送信日',
  genre: 'ジャンル名',
  other_url: 'その他URL',
  notes: 'メモ',
  sales_rep: '担当者',
  address: '住所',
  proposal_product: '提案商材',
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminChecked, setAdminChecked] = useState(false)

  const [statuses, setStatuses] = useState<Status[]>([])
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])
  const [proposalProducts, setProposalProducts] = useState<ProposalProduct[]>([])
  const [genres, setGenres] = useState<Genre[]>([])
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [csvAliases, setCsvAliases] = useState<CsvAlias[]>([])
  const [templates, setTemplates] = useState<EmailTemplate[]>([])

  // 業務委託スタッフ
  const [staffList, setStaffList] = useState<Staff[]>([])
  const [newStaffLoginId, setNewStaffLoginId] = useState('')
  const [newStaffName, setNewStaffName] = useState('')
  const [newStaffPassword, setNewStaffPassword] = useState('')

  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [newAliasCsvHeader, setNewAliasCsvHeader] = useState('')
  const [newAliasFieldKey, setNewAliasFieldKey] = useState('')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateSubject, setNewTemplateSubject] = useState('')
  const [newTemplateBody, setNewTemplateBody] = useState('')
  const [newTemplateProductId, setNewTemplateProductId] = useState('')
  // 空文字は共通テンプレート（一斉送信画面で全員に表示される）
  const [newTemplateOwner, setNewTemplateOwner] = useState('')
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null)
  const [saving, setSaving] = useState(false)

  // 売上目標
  // 機能の公開設定。今は再送機能だけだが、増えるなら feature_flags に行を足す
  const [resendFlag, setResendFlag] = useState(false)
  const [savingFlag, setSavingFlag] = useState(false)

  const [targetMonth, setTargetMonth] = useState(currentYearMonth())
  const [allReps, setAllReps] = useState<{ id: string; name: string }[]>([])
  const [targetInputs, setTargetInputs] = useState<Record<string, string>>({})
  const [targetMap, setTargetMap] = useState<Record<string, number>>({})
  const [totalTargetInput, setTotalTargetInput] = useState('')
  const [totalTargetSaved, setTotalTargetSaved] = useState(0)
  const [savingTarget, setSavingTarget] = useState(false)

  // 管理者チェック（DBから）
  useEffect(() => {
    if (status === 'loading') return
    if (!session?.user?.email) { router.push('/'); return }
    supabase.from('admin_users').select('id').eq('email', session.user.email).maybeSingle()
      .then(({ data }) => {
        if (!data) { router.push('/'); return }
        setIsAdmin(true)
        setAdminChecked(true)
      })
  }, [session, status, router])

  const fetchAll = async () => {
    const [s, r, p, g, a, c, t, f] = await Promise.all([
      supabase.from('statuses').select('*').order('sort_order'),
      supabase.from('sales_reps').select('*').order('name'),
      supabase.from('proposal_products').select('*').order('sort_order'),
      supabase.from('genres').select('*').order('sort_order'),
      supabase.from('admin_users').select('*').order('email'),
      supabase.from('csv_column_aliases').select('*').order('csv_header'),
      supabase.from('email_templates').select('*').order('created_at'),
      supabase.from('feature_flags').select('enabled').eq('key', 'resend_filter').maybeSingle(),
    ])
    if (s.data) setStatuses(s.data)
    if (r.data) { setSalesReps(r.data); setAllReps(r.data) }
    if (p.data) setProposalProducts(p.data)
    if (g.data) setGenres(g.data)
    if (a.data) setAdminUsers(a.data)
    if (c.data) setCsvAliases(c.data)
    if (t.data) setTemplates(t.data)
    setResendFlag(f.data?.enabled === true)
  }

  // upsert ではなく update。行は supabase-feature-flags.sql で作ってある。
  // upsert だと NOT NULL の updated_at で弾かれる場合がある
  const toggleResendFlag = async (next: boolean) => {
    setSavingFlag(true)
    const { error } = await supabase.from('feature_flags')
      .update({ enabled: next, updated_at: new Date().toISOString() })
      .eq('key', 'resend_filter')
    setSavingFlag(false)
    if (error) { alert('切り替えに失敗しました: ' + error.message); return }
    setResendFlag(next)
  }

  const loadStaff = async () => {
    const res = await fetch('/api/staff')
    if (res.ok) {
      const { staff } = await res.json()
      setStaffList(staff ?? [])
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 管理者確認後にDBから取得する
  useEffect(() => { if (adminChecked) { fetchAll(); loadStaff() } }, [adminChecked])

  const addStaff = async () => {
    if (!newStaffLoginId.trim() || !newStaffName.trim() || !newStaffPassword) return
    setSaving(true)
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginId: newStaffLoginId.trim(),
        displayName: newStaffName.trim(),
        password: newStaffPassword,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: '発行に失敗しました' }))
      alert(error || '発行に失敗しました')
      return
    }
    setNewStaffLoginId(''); setNewStaffName(''); setNewStaffPassword('')
    loadStaff()
  }

  const toggleStaffActive = async (s: Staff) => {
    const next = !s.active
    if (!next && !confirm(`${s.display_name}（${s.login_id}）を無効化しますか？\nログインできなくなりますが、作成済みのリストと集計は残ります。`)) return
    const res = await fetch(`/api/staff/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: next }),
    })
    if (res.ok) loadStaff()
    else alert('更新に失敗しました')
  }

  const resetStaffPassword = async (s: Staff) => {
    const pw = prompt(`${s.display_name} の新しいパスワードを入力してください（6文字以上）`)
    if (!pw) return
    if (pw.length < 6) { alert('パスワードは6文字以上にしてください'); return }
    const res = await fetch(`/api/staff/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    })
    if (res.ok) alert('パスワードを再発行しました')
    else alert('更新に失敗しました')
  }

  const loadTargets = useCallback(async () => {
    if (!targetMonth) return
    const [{ data }, { data: totalData }] = await Promise.all([
      supabase.from('sales_targets').select('sales_rep_id, target_revenue').eq('year_month', targetMonth),
      supabase.from('sales_total_targets').select('target_revenue').eq('year_month', targetMonth).maybeSingle(),
    ])
    if (data) {
      const map: Record<string, number> = {}
      const inputs: Record<string, string> = {}
      data.forEach((t: { sales_rep_id: string; target_revenue: number }) => {
        map[t.sales_rep_id] = t.target_revenue
        inputs[t.sales_rep_id] = String(t.target_revenue)
      })
      setTargetMap(map); setTargetInputs(inputs)
    } else { setTargetMap({}); setTargetInputs({}) }
    if (totalData) {
      setTotalTargetSaved(totalData.target_revenue)
      setTotalTargetInput(String(totalData.target_revenue))
    } else { setTotalTargetSaved(0); setTotalTargetInput('') }
  }, [targetMonth])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 対象月を変えたら目標を読み直す
  useEffect(() => { if (adminChecked) loadTargets() }, [loadTargets, adminChecked])

  // ステータス
  const addStatus = async (name: string) => {
    setSaving(true)
    const maxOrder = statuses.reduce((m, s) => Math.max(m, s.sort_order), 0)
    const { data } = await supabase.from('statuses').insert({ name, sort_order: maxOrder + 1 }).select().single()
    if (data) setStatuses(prev => [...prev, data])
    setSaving(false)
  }
  const deleteStatus = async (id: string) => {
    if (!confirm('このステータスを削除しますか？\n顧客に設定されている場合は削除できません。')) return
    const { error } = await supabase.from('statuses').delete().eq('id', id)
    if (error) { alert('削除できませんでした（顧客に使用中の可能性があります）'); return }
    setStatuses(prev => prev.filter(s => s.id !== id))
  }
  const updateStatusOrder = async (id: string, newOrder: number) => {
    await supabase.from('statuses').update({ sort_order: newOrder }).eq('id', id)
    setStatuses(prev => prev.map(s => s.id === id ? { ...s, sort_order: newOrder } : s).sort((a, b) => a.sort_order - b.sort_order))
  }

  // 営業担当
  const addRep = async (name: string) => {
    setSaving(true)
    const { data } = await supabase.from('sales_reps').insert({ name }).select().single()
    if (data) { setSalesReps(prev => [...prev, data]); setAllReps(prev => [...prev, data]) }
    setSaving(false)
  }
  const deleteRep = async (id: string) => {
    if (!confirm('この営業担当を削除しますか？')) return
    const { error } = await supabase.from('sales_reps').delete().eq('id', id)
    if (error) { alert('削除できませんでした（顧客に使用中の可能性があります）'); return }
    setSalesReps(prev => prev.filter(r => r.id !== id))
    setAllReps(prev => prev.filter(r => r.id !== id))
  }

  // 提案商材
  const addProduct = async (name: string) => {
    setSaving(true)
    const maxOrder = proposalProducts.reduce((m, p) => Math.max(m, p.sort_order), 0)
    const { data } = await supabase.from('proposal_products').insert({ name, sort_order: maxOrder + 1 }).select().single()
    if (data) setProposalProducts(prev => [...prev, data])
    setSaving(false)
  }
  const deleteProduct = async (id: string) => {
    if (!confirm('この提案商材を削除しますか？')) return
    const { error } = await supabase.from('proposal_products').delete().eq('id', id)
    if (error) { alert('削除できませんでした（顧客に使用中の可能性があります）'); return }
    setProposalProducts(prev => prev.filter(p => p.id !== id))
  }
  const updateProductOrder = async (id: string, newOrder: number) => {
    await supabase.from('proposal_products').update({ sort_order: newOrder }).eq('id', id)
    setProposalProducts(prev => prev.map(p => p.id === id ? { ...p, sort_order: newOrder } : p).sort((a, b) => a.sort_order - b.sort_order))
  }

  // ジャンル
  const addGenre = async (name: string) => {
    setSaving(true)
    const maxOrder = genres.reduce((m, g) => Math.max(m, g.sort_order), 0)
    const { data } = await supabase.from('genres').insert({ name, sort_order: maxOrder + 1 }).select().single()
    if (data) setGenres(prev => [...prev, data])
    setSaving(false)
  }
  const deleteGenre = async (id: string) => {
    if (!confirm('このジャンルを削除しますか？')) return
    await supabase.from('genres').delete().eq('id', id)
    setGenres(prev => prev.filter(g => g.id !== id))
  }
  const updateGenreOrder = async (id: string, newOrder: number) => {
    await supabase.from('genres').update({ sort_order: newOrder }).eq('id', id)
    setGenres(prev => prev.map(g => g.id === id ? { ...g, sort_order: newOrder } : g).sort((a, b) => a.sort_order - b.sort_order))
  }

  // 商材・ジャンルの名前変更（デモの設定画面だけで出す）
  const renameMaster = async (table: 'proposal_products' | 'genres', id: string, name: string) => {
    setSaving(true)
    const { error } = await supabase.from(table).update({ name }).eq('id', id)
    setSaving(false)
    if (error) { alert('変更できませんでした（同じ名前があります）'); return }
    const apply = <T extends { id: string; name: string }>(prev: T[]) => prev.map(x => x.id === id ? { ...x, name } : x)
    if (table === 'genres') setGenres(apply)
    else setProposalProducts(apply)
  }

  // 管理者
  const addAdminUser = async () => {
    if (!newAdminEmail.trim()) return; setSaving(true)
    const { data, error } = await supabase.from('admin_users').insert({ email: newAdminEmail.trim() }).select().single()
    if (error) { alert('追加できませんでした（すでに登録済みの可能性があります）'); setSaving(false); return }
    if (data) setAdminUsers(prev => [...prev, data])
    setNewAdminEmail(''); setSaving(false)
  }
  const deleteAdminUser = async (id: string, email: string) => {
    if (email === session?.user?.email) { alert('自分自身は削除できません'); return }
    if (!confirm(`${email} を管理者から削除しますか？`)) return
    await supabase.from('admin_users').delete().eq('id', id)
    setAdminUsers(prev => prev.filter(a => a.id !== id))
  }

  // CSVエイリアス
  const addAlias = async () => {
    if (!newAliasCsvHeader.trim() || !newAliasFieldKey) return; setSaving(true)
    const { data } = await supabase.from('csv_column_aliases').insert({ csv_header: newAliasCsvHeader.trim(), field_key: newAliasFieldKey }).select().single()
    if (data) setCsvAliases(prev => [...prev, data])
    setNewAliasCsvHeader(''); setNewAliasFieldKey(''); setSaving(false)
  }
  const deleteAlias = async (id: string) => {
    await supabase.from('csv_column_aliases').delete().eq('id', id)
    setCsvAliases(prev => prev.filter(a => a.id !== id))
  }

  // テンプレート
  const addTemplate = async () => {
    if (!newTemplateName.trim()) return; setSaving(true)
    const { data } = await supabase.from('email_templates').insert({ name: newTemplateName.trim(), subject: newTemplateSubject.trim(), body: newTemplateBody.trim(), proposal_product_id: newTemplateProductId || null, owner_email: newTemplateOwner || null }).select().single()
    if (data) setTemplates(prev => [...prev, data])
    setNewTemplateName(''); setNewTemplateSubject(''); setNewTemplateBody(''); setNewTemplateProductId(''); setNewTemplateOwner(session?.user?.email ?? ''); setShowTemplateForm(false); setSaving(false)
  }
  const deleteTemplate = async (id: string) => {
    if (!confirm('このテンプレートを削除しますか？')) return
    await supabase.from('email_templates').delete().eq('id', id)
    setTemplates(prev => prev.filter(t => t.id !== id))
  }
  const updateTemplate = async () => {
    if (!editingTemplate || !editingTemplate.name.trim()) return
    setSaving(true)
    const { data } = await supabase.from('email_templates').update({ name: editingTemplate.name.trim(), subject: editingTemplate.subject.trim(), body: editingTemplate.body.trim(), proposal_product_id: editingTemplate.proposal_product_id || null, owner_email: editingTemplate.owner_email || null }).eq('id', editingTemplate.id).select().single()
    if (data) setTemplates(prev => prev.map(t => t.id === data.id ? data : t))
    setEditingTemplate(null); setSaving(false)
  }

  // 売上目標
  const saveTargets = async () => {
    setSavingTarget(true)
    const upserts = allReps
      .filter(r => targetInputs[r.id] && Number(targetInputs[r.id]) >= 0)
      .map(r => ({ sales_rep_id: r.id, year_month: targetMonth, target_revenue: Number(targetInputs[r.id]) }))
    if (upserts.length > 0) await supabase.from('sales_targets').upsert(upserts, { onConflict: 'sales_rep_id,year_month' })
    if (totalTargetInput && Number(totalTargetInput) >= 0) {
      await supabase.from('sales_total_targets').upsert({ year_month: targetMonth, target_revenue: Number(totalTargetInput) }, { onConflict: 'year_month' })
    }
    await loadTargets()
    setSavingTarget(false)
  }

  const inputClass = "flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"

  if (status === 'loading' || !adminChecked || !isAdmin) return null

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">設定</h2>
        <p className="text-sm text-slate-400 mt-0.5">管理者のみアクセス可能</p>
        {IS_DEMO && (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              デモでは、会社名・色・メニュー・一覧の列・チーム・ステータス・KPIなどを自由に変えられます。変更は全員の画面に反映され、毎日の初期化で元に戻ります。
            </p>
            <DemoCmsNav />
          </div>
        )}
      </div>

      <div className="space-y-6">
        {IS_DEMO && <DemoCms />}

        <div className="premium-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">機能の公開設定</h3>
          <p className="text-xs text-slate-400 mb-4">オフにすると、対象の画面から項目ごと消えます</p>
          <label className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={resendFlag}
              disabled={savingFlag}
              onChange={e => toggleResendFlag(e.target.checked)}
              className="accent-indigo-600 mt-0.5"
            />
            <span className="flex-1">
              <span className="block text-sm text-slate-700">一斉送信の「送信履歴で絞り込む（再送）」</span>
              <span className="block text-xs text-slate-400 mt-0.5">
                過去に送った相手を、商材と経過日数で絞り込んで再送するための機能
              </span>
              <span className="block text-xs text-amber-600 mt-1">
                現在この機能は {RESEND_ALLOWED_EMAILS.join('、')} のアカウントにだけ表示されます。ここをオンにしても他のメンバーの画面には出ません（公開範囲は src/lib/featureFlags.ts）
              </span>
            </span>
          </label>
        </div>

        {!IS_DEMO && <MasterListCard
          title="ステータス"
          items={statuses}
          placeholder="新しいステータス名"
          saving={saving}
          onAdd={addStatus}
          onDelete={deleteStatus}
          onReorder={updateStatusOrder}
          showOrderNumber
        />}

        {!IS_DEMO && <MasterListCard
          title="営業担当"
          items={salesReps}
          placeholder="担当者名"
          saving={saving}
          onAdd={addRep}
          onDelete={deleteRep}
        />}

        <MasterListCard
          title="提案商材"
          items={proposalProducts}
          placeholder="商材名（例：LINE、MEO など）"
          saving={saving}
          onAdd={addProduct}
          onDelete={deleteProduct}
          onReorder={updateProductOrder}
          showOrderNumber
          id="cms-master"
          onRename={IS_DEMO ? (id, name) => renameMaster('proposal_products', id, name) : undefined}
        />

        <MasterListCard
          title="ジャンル"
          description="顧客詳細のジャンル入力時にサジェストされます"
          items={genres}
          placeholder="ジャンル名（例：美容室、整体院 など）"
          saving={saving}
          onAdd={addGenre}
          onDelete={deleteGenre}
          onReorder={updateGenreOrder}
          onRename={IS_DEMO ? (id, name) => renameMaster('genres', id, name) : undefined}
        />

        {/* 管理者アカウント */}
        <div className="premium-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">管理者アカウント</h3>
          <p className="text-xs text-slate-400 mb-4">設定ページにアクセスできるアカウントを管理します</p>
          <div className="space-y-1 mb-3">
            {adminUsers.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group">
                <span className="flex-1 text-sm text-slate-700">{a.email}</span>
                {a.email === session?.user?.email && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">自分</span>}
                <button onClick={() => deleteAdminUser(a.id, a.email)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition shrink-0"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="email" value={newAdminEmail} onChange={e => setNewAdminEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addAdminUser()} placeholder="追加するメールアドレス" className={inputClass} />
            <button onClick={addAdminUser} disabled={saving || !newAdminEmail.trim()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40"><Plus size={14} />追加</button>
          </div>
        </div>

        {/* 業務委託スタッフ */}
        <div className="premium-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">業務委託スタッフ</h3>
          <p className="text-xs text-slate-400 mb-4">リスト作成スタッフのログインID／パスワードを発行します。無効化してもリストと集計は残ります。</p>
          <div className="space-y-1 mb-4">
            {staffList.length === 0 && <p className="text-xs text-slate-300 px-3 py-2">まだスタッフがいません</p>}
            {staffList.map(s => (
              <div key={s.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group ${s.active ? '' : 'opacity-50'}`}>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-700">{s.display_name}</span>
                  <span className="text-xs text-slate-400 ml-2">{s.login_id}</span>
                </div>
                {!s.active && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">無効</span>}
                <button onClick={() => resetStaffPassword(s)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-xs text-slate-400 hover:text-slate-700 transition shrink-0">PW再発行</button>
                <button onClick={() => toggleStaffActive(s)} className="text-xs text-slate-400 hover:text-slate-700 transition shrink-0 border border-slate-200 rounded px-2 py-0.5">
                  {s.active ? '無効化' : '有効化'}
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-2 bg-slate-50 rounded-xl p-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input type="text" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} placeholder="表示名（例：山田 太郎）" className={inputClass} />
              <input type="text" value={newStaffLoginId} onChange={e => setNewStaffLoginId(e.target.value)} placeholder="ログインID" autoCapitalize="none" className={inputClass} />
            </div>
            <div className="flex gap-2">
              <input type="text" value={newStaffPassword} onChange={e => setNewStaffPassword(e.target.value)} placeholder="初期パスワード（6文字以上）" className={inputClass} />
              <button onClick={addStaff} disabled={saving || !newStaffLoginId.trim() || !newStaffName.trim() || newStaffPassword.length < 6} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40 shrink-0"><Plus size={14} />発行</button>
            </div>
          </div>
        </div>

        {/* 売上目標 */}
        <div className="premium-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">売上目標（月別）</h3>
          <div className="flex items-center gap-3 mb-4">
            <label className="text-xs text-slate-500 font-medium shrink-0">対象月</label>
            <input type="month" value={targetMonth} onChange={e => setTargetMonth(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="space-y-3 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 pb-3 border-b border-slate-100">
              <span className="text-sm font-semibold text-slate-700 sm:w-28 sm:shrink-0">全体目標</span>
              <div className="relative w-full sm:flex-1 sm:max-w-xs">
                <input type="number" min="0" placeholder="0" value={totalTargetInput} onChange={e => setTotalTargetInput(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">円</span>
              </div>
              {totalTargetSaved > 0 && <span className="text-xs text-slate-400">現在: {totalTargetSaved.toLocaleString()}円</span>}
            </div>
            {allReps.map(rep => (
              <div key={rep.id} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                <span className="text-sm font-medium text-slate-700 sm:w-28 sm:shrink-0">{rep.name}</span>
                <div className="relative w-full sm:flex-1 sm:max-w-xs">
                  <input type="number" min="0" placeholder="0" value={targetInputs[rep.id] ?? ''} onChange={e => setTargetInputs(prev => ({ ...prev, [rep.id]: e.target.value }))} className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">円</span>
                </div>
                {targetMap[rep.id] > 0 && <span className="text-xs text-slate-400">現在: {targetMap[rep.id].toLocaleString()}円</span>}
              </div>
            ))}
          </div>
          <button onClick={saveTargets} disabled={savingTarget} className="tap-target flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50">
            <Save size={14} />{savingTarget ? '保存中...' : '保存する'}
          </button>
        </div>

        {/* 休業日。KPIの営業日数から外す日を管理する（データ取得と保存はカード内で完結） */}
        <HolidayCard />

        {/* CSVエイリアス */}
        <div className="premium-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">CSVインポート 列名エイリアス</h3>
          <p className="text-xs text-slate-400 mb-4">スプシのヘッダー名が標準と異なる場合に対応する列名を登録します</p>
          {csvAliases.length > 0 && (
            <div className="space-y-1 mb-3">
              {csvAliases.map(a => (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group">
                  <span className="flex-1 text-sm text-slate-700">{a.csv_header}</span>
                  <span className="text-xs text-slate-400">→</span>
                  <span className="text-sm text-indigo-600 w-24 sm:w-32 shrink-0">{FIELD_KEY_LABELS[a.field_key] || a.field_key}</span>
                  <button onClick={() => deleteAlias(a.id)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition shrink-0"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap sm:flex-nowrap gap-2">
            <input type="text" value={newAliasCsvHeader} onChange={e => setNewAliasCsvHeader(e.target.value)} placeholder="スプシのヘッダー名（例：HP）" className={inputClass} />
            <select value={newAliasFieldKey} onChange={e => setNewAliasFieldKey(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">対応するフィールド</option>
              {Object.entries(FIELD_KEY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
            <button onClick={addAlias} disabled={saving || !newAliasCsvHeader.trim() || !newAliasFieldKey} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40"><Plus size={14} />追加</button>
          </div>
        </div>

        {/* 一斉送信テンプレート */}
        <div id="cms-templates" className="premium-card rounded-2xl p-5 scroll-mt-20">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700">一斉送信テンプレート</h3>
            <button onClick={() => { if (!showTemplateForm) setNewTemplateOwner(session?.user?.email ?? ''); setShowTemplateForm(!showTemplateForm) }} className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
              <Plus size={13} />新規作成
            </button>
          </div>
          {showTemplateForm && (
            <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
              <input type="text" value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="テンプレート名（例：初回アプローチ）" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <input type="text" value={newTemplateSubject} onChange={e => setNewTemplateSubject(e.target.value)} placeholder="件名（差し込み変数: {{会社名}} など）" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <textarea rows={6} value={newTemplateBody} onChange={e => setNewTemplateBody(e.target.value)} placeholder="本文" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              {IS_DEMO && <TemplateAssist subject={newTemplateSubject} body={newTemplateBody} onInsert={v => setNewTemplateBody(b => b + v)} />}
              <select value={newTemplateProductId} onChange={e => setNewTemplateProductId(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">提案商材（任意）</option>
                {proposalProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div>
                <select value={newTemplateOwner} onChange={e => setNewTemplateOwner(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">共通（全員に表示）</option>
                  {ACCOUNTS.map(a => <option key={a.email} value={a.email}>{a.name} 専用</option>)}
                </select>
                <p className="text-xs text-slate-400 mt-1">一斉送信画面では、ここで選んだ担当と共通のテンプレートだけが表示されます</p>
              </div>
              <div className="flex gap-2">
                <button onClick={addTemplate} disabled={saving || !newTemplateName.trim()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40"><Save size={13} />保存</button>
                <button onClick={() => setShowTemplateForm(false)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg transition"><X size={13} /></button>
              </div>
            </div>
          )}
          {templates.length === 0 ? (
            <p className="text-sm text-slate-400">テンプレートはありません</p>
          ) : (
            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.id} className="border border-slate-100 rounded-xl p-3 hover:bg-slate-50/50 group">
                  {editingTemplate?.id === t.id ? (
                    <div className="space-y-2">
                      <input type="text" value={editingTemplate.name} onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })} placeholder="テンプレート名" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <input type="text" value={editingTemplate.subject} onChange={e => setEditingTemplate({ ...editingTemplate, subject: e.target.value })} placeholder="件名" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <textarea rows={5} value={editingTemplate.body} onChange={e => setEditingTemplate({ ...editingTemplate, body: e.target.value })} placeholder="本文" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
                      {IS_DEMO && <TemplateAssist subject={editingTemplate.subject} body={editingTemplate.body} onInsert={v => setEditingTemplate({ ...editingTemplate, body: editingTemplate.body + v })} />}
                      <select value={editingTemplate.proposal_product_id || ''} onChange={e => setEditingTemplate({ ...editingTemplate, proposal_product_id: e.target.value || null })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">提案商材（任意）</option>
                        {proposalProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select value={editingTemplate.owner_email || ''} onChange={e => setEditingTemplate({ ...editingTemplate, owner_email: e.target.value || null })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">共通（全員に表示）</option>
                        {ACCOUNTS.map(a => <option key={a.email} value={a.email}>{a.name} 専用</option>)}
                      </select>
                      <div className="flex gap-2">
                        <button onClick={updateTemplate} disabled={saving || !editingTemplate.name.trim()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40"><Save size={13} />保存</button>
                        <button onClick={() => setEditingTemplate(null)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg transition"><X size={13} /></button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-slate-800 truncate">{t.name}</span>
                          <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${t.owner_email ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                            {t.owner_email ? emailToName(t.owner_email) : '共通'}
                          </span>
                        </span>
                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                          <button onClick={() => { setEditingTemplate(t); setShowTemplateForm(false) }} className="text-slate-300 hover:text-blue-500 transition"><Pencil size={13} /></button>
                          <button onClick={() => deleteTemplate(t.id)} className="text-slate-300 hover:text-red-400 transition"><Trash2 size={13} /></button>
                        </div>
                      </div>
                      {t.subject && <p className="text-xs text-slate-500 truncate">件名: {t.subject}</p>}
                      {t.body && <p className="text-xs text-slate-400 truncate mt-0.5">{t.body.slice(0, 60)}{t.body.length > 60 ? '...' : ''}</p>}
                      {t.proposal_product_id && <p className="text-xs text-blue-500 mt-0.5">提案商材: {proposalProducts.find(p => p.id === t.proposal_product_id)?.name}</p>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
