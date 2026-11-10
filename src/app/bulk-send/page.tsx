'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { emailToName } from '@/lib/emailToName'
import { getSearchVariants } from '@/lib/normalizeSearch'
import { fetchAllPaged } from '@/lib/supabaseFetch'
import { soleProposalProductId } from '@/lib/proposalProductForLog'
import { canUseResendFilter } from '@/lib/featureFlags'
import { sortContacts } from '@/lib/contactFields'
import { Status } from '@/types'
import { Send, CheckSquare, Square, Eye, X, Copy, Check, ClipboardList, ExternalLink } from 'lucide-react'

type Target = {
  companyId: string
  companyName: string
  representativeName: string
  serviceName: string
  genreName: string
  salesRepName: string
  statusName: string
  statusSortOrder: number
  companyEmailId: string
  email: string
  urls: { id: string; url: string; label: string | null }[]
  selected: boolean
}


const FETCH_LIMIT = 100

const VARIABLES = [
  { label: '{{会社名}}', key: 'companyName' },
  { label: '{{代表者名}}', key: 'representativeName' },
  { label: '{{サービス名}}', key: 'serviceName' },
  { label: '{{ジャンル名}}', key: 'genreName' },
  { label: '{{担当者名}}', key: 'salesRepName' },
]

function applyVariables(text: string, target: Target): string {
  return text
    .replace(/{{会社名}}/g, target.companyName || '')
    .replace(/{{代表者名}}/g, target.representativeName || '')
    .replace(/{{サービス名}}/g, target.serviceName || '')
    .replace(/{{ジャンル名}}/g, target.genreName || '')
    .replace(/{{担当者名}}/g, target.salesRepName || '')
}

/** 一斉送信を何件ずつAPIに渡すか（1件あたり約1〜2秒かかる） */
const SEND_CHUNK = 10

export default function BulkSendPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [statuses, setStatuses] = useState<Status[]>([])
  const [nameSearch, setNameSearch] = useState('')
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [salesRepFilter, setSalesRepFilter] = useState('')
  const [salesReps, setSalesReps] = useState<{ id: string; name: string }[]>([])
  const [proposalProductFilter, setProposalProductFilter] = useState('')
  const [proposalProducts, setProposalProducts] = useState<{ id: string; name: string }[]>([])
  // 再送（送信履歴での絞り込み）。チェックを入れたときだけ resend_candidates を通す。
  // feature_flags.resend_filter が false のあいだは欄ごと出さない。
  // 使えないものをグレーアウトで見せると「なぜ押せないのか」の問い合わせが増えるため
  const [resendFlagOn, setResendFlagOn] = useState(false)
  const [resendMode, setResendMode] = useState(false)
  const [resendSentProduct, setResendSentProduct] = useState('')
  const [resendNotSentProduct, setResendNotSentProduct] = useState('')
  // 間隔を意識せずに送るのを防ぐため必須。3ヶ月を既定にしている
  const [resendDays, setResendDays] = useState('90')
  // トグルがONでも、公開範囲（featureFlags）に入っていない人には欄ごと出さない
  const resendEnabled = resendFlagOn && canUseResendFilter(session?.user?.email)
  const [templates, setTemplates] = useState<{ id: string; name: string; subject: string; body: string; proposal_product_id: string | null; owner_email: string | null }[]>([])
  const [templateProposalProductId, setTemplateProposalProductId] = useState<string | null>(null)
  const [selectedTemplateName, setSelectedTemplateName] = useState<string | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendProgress, setSendProgress] = useState<{ done: number; total: number } | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [results, setResults] = useState<{ email: string; success: boolean }[]>([])
  const [loading, setLoading] = useState(false)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Target | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const subjectRef = useRef<HTMLInputElement>(null)
  const cursorPosRef = useRef<{ start: number; end: number } | null>(null)
  const activeFieldRef = useRef<'subject' | 'body'>('body')

  // フォームモード
  const [formMode, setFormMode] = useState(false)
  const [formIndex, setFormIndex] = useState(0)
  const [recordingForm, setRecordingForm] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // 前回送信した件名・本文の復元は意図的に持たない。
  // 内容が入った状態で開くとテンプレートを選ぶ必要が無いように見え、商材が空のまま送られる。
  // 内容はテンプレートから入るので、テンプレート選択を唯一の入り口にしている。

  useEffect(() => {
    const fetch = async () => {
      const [{ data: statusData }, { data: repData }, { data: ppData }, { data: flagData }] = await Promise.all([
        supabase.from('statuses').select('*').order('sort_order'),
        supabase.from('sales_reps').select('*').order('name'),
        supabase.from('proposal_products').select('*').order('sort_order'),
        supabase.from('feature_flags').select('enabled').eq('key', 'resend_filter').maybeSingle(),
      ])
      if (statusData) setStatuses(statusData)
      if (repData) setSalesReps(repData)
      if (ppData) setProposalProducts(ppData)
      // 行が無い／読めないときは閉じたままにする。開ける側を明示的な操作だけに限る
      setResendFlagOn(flagData?.enabled === true)
    }
    fetch()
  }, [])

  // テンプレートは自分のもの（owner_email が自分）と共通（owner_email が null）だけを読む。
  // もう一方の担当のテンプレートが選択肢に並んでいると、選び間違いがそのまま誤送信になる。
  // ログイン中のメールが確定してからでないと絞れないので、他のマスタとは別の effect にしている。
  useEffect(() => {
    const email = session?.user?.email
    if (!email) return
    const fetchTemplates = async () => {
      const { data } = await supabase
        .from('email_templates')
        .select('*')
        .or(`owner_email.is.null,owner_email.eq."${email}"`)
        .order('created_at')
      if (data) setTemplates(data)
    }
    fetchTemplates()
  }, [session?.user?.email])

  const toggleStatusFilter = (id: string) => {
    setStatusFilters(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const fetchTargets = async (isFormMode = false) => {
    setLoading(true)
    setTotalCount(null)
    setFetchError(null)
    setFormMode(false)
    setFormIndex(0)

    try {
      let preFilterIds: string[] | null = null

      // 会社名は顧客一覧と同じ RPC に通す。ilike 直叩きだと DB 側の表記を正規化できないので
      // 「にこっとケア」のようなひらがな・カタカナ混在の名前や、DB 側にスペースが入った名前を取りこぼす
      if (nameSearch.trim()) {
        const variants = getSearchVariants(nameSearch)
        const results = await Promise.all(
          variants.map(v =>
            fetchAllPaged<{ id: string }>((from, to) =>
              supabase.rpc('search_company_ids_by_name', { search_text: v }).range(from, to)
            )
          )
        )
        const idSet = new Set<string>()
        results.forEach(rows => rows.forEach(row => idSet.add(row.id)))
        preFilterIds = [...idSet]
        if (preFilterIds.length === 0) {
          setTargets([])
          setTotalCount(0)
          return
        }
      }

      if (proposalProductFilter) {
        const allPpIds: string[] = []
        const PP_PAGE = 1000
        let ppOffset = 0
        while (true) {
          const { data: ppPage, error: ppError } = await supabase
            .from('company_proposal_products')
            .select('company_id')
            .eq('proposal_product_id', proposalProductFilter)
            .range(ppOffset, ppOffset + PP_PAGE - 1)
          if (ppError) throw ppError
          if (!ppPage || ppPage.length === 0) break
          allPpIds.push(...ppPage.map((r: { company_id: string }) => r.company_id))
          if (ppPage.length < PP_PAGE) break
          ppOffset += PP_PAGE
        }
        const ids = allPpIds
        if (ids.length === 0) {
          setTargets([])
          setTotalCount(0)
          return
        }
        preFilterIds = preFilterIds === null
          ? ids
          : preFilterIds.filter(id => new Set(ids).has(id))
        if (preFilterIds.length === 0) {
          setTargets([])
          setTotalCount(0)
          return
        }
      }

      // 再送。送信履歴の条件に合う会社をDB側で絞り、他の絞り込みと同じ preFilterIds に流す。
      // 除外（話が進んでいる相手・アポあり）と、商材不明の履歴しか無い会社の扱いは関数側で完結している
      if (resendEnabled && resendMode) {
        const { data: rcData, error: rcError } = await supabase.rpc('resend_candidates', {
          p_sent_product: resendSentProduct || null,
          p_not_sent_product: resendNotSentProduct || null,
          p_days_since: resendDays ? Number(resendDays) : null,
        })
        if (rcError) throw rcError
        // rpc の戻りは any なので、明示的に string[] にしないと preFilterIds の型が絞れない
        const ids: string[] = ((rcData || []) as { company_id: string }[]).map(r => r.company_id)
        if (ids.length === 0) {
          setTargets([])
          setTotalCount(0)
          return
        }
        const idSet = new Set<string>(ids)
        preFilterIds = preFilterIds === null ? ids : preFilterIds.filter(id => idSet.has(id))
        if (preFilterIds.length === 0) {
          setTargets([])
          setTotalCount(0)
          return
        }
      }

      const COMPANY_SELECT ='id, name, representative_name, service_name, genre, sales_reps(name), statuses(name, sort_order), company_emails(id, email, label, sort_order), company_urls(id, url, label, sort_order)'
      type CRow = { id: string; name: string; representative_name: string | null; service_name: string | null; genre: string | null; sales_reps: { name: string } | null; statuses: { name: string; sort_order: number } | null; company_emails: { id: string; email: string; sort_order: number | null }[]; company_urls: { id: string; url: string; label: string | null; sort_order: number | null }[] }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let fetchedRows: any[] = []
      let fetchedCount: number | null = null

      if (preFilterIds !== null && preFilterIds.length > 200) {
        // IDが多い場合はバッチ取得してURL長制限を回避
        const BATCH = 200
        for (let bi = 0; bi < preFilterIds.length; bi += BATCH) {
          let bq = supabase.from('companies').select(COMPANY_SELECT).in('id', preFilterIds.slice(bi, bi + BATCH)).limit(BATCH)
          if (statusFilters.length > 0) bq = bq.in('status_id', statusFilters)
          if (salesRepFilter) bq = bq.eq('sales_rep_id', salesRepFilter)
          const { data: bd, error: be } = await bq
          if (be) throw be
          if (bd) fetchedRows.push(...bd)
        }
        fetchedRows.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'))
        fetchedCount = fetchedRows.length
        fetchedRows = fetchedRows.slice(0, FETCH_LIMIT)
      } else {
        let query = supabase
          .from('companies')
          .select(COMPANY_SELECT, { count: 'exact' })
          .order('name')
          .limit(FETCH_LIMIT)
        if (statusFilters.length > 0) query = query.in('status_id', statusFilters)
        if (salesRepFilter) query = query.eq('sales_rep_id', salesRepFilter)
        if (preFilterIds !== null) query = query.in('id', preFilterIds)
        const { data, count, error } = await query
        if (error) throw error
        fetchedCount = count
        fetchedRows = data || []
      }

      if (fetchedCount !== null) setTotalCount(fetchedCount)
      if (fetchedRows.length > 0) {
        const list: Target[] = []
        for (const c of fetchedRows as CRow[]) {
          if (c.statuses?.name === '禁止') continue
          // 「先頭」は詳細画面の1番目と同じ＝登録順（sort_order）。id 順だとランダムになる
          const emails = sortContacts(c.company_emails)
          const e = emails[0]
          // フォームモードはメールなし顧客も含める
          if (!isFormMode && !e) continue
          const urls = sortContacts(c.company_urls)
          list.push({
            companyId: c.id,
            companyName: c.name || '',
            representativeName: c.representative_name || '',
            serviceName: c.service_name || '',
            genreName: c.genre || '',
            salesRepName: c.sales_reps?.name || '',
            statusName: c.statuses?.name || '',
            statusSortOrder: c.statuses?.sort_order ?? 999,
            companyEmailId: e?.id || '',
            email: e?.email || '',
            urls,
            selected: true,
          })
        }
        setTargets(list)
        if (isFormMode) {
          setFormMode(true)
          setFormIndex(0)
        }
      }
    } catch {
      setFetchError('データの取得に失敗しました。条件を絞り込んで再度お試しください。')
      setTargets([])
      setTotalCount(null)
    } finally {
      setLoading(false)
      setSent(false)
    }
  }

  const copyText = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {}
  }

  const handleFormRecord = async () => {
    const formTarget = sorted[formIndex]?.target
    if (!formTarget || !session?.user?.email) return
    setRecordingForm(true)

    // 商材はテンプレートに紐づいたものを優先。無いテンプレートのときだけ顧客から推定する
    const loggedProductId = templateProposalProductId
      || await soleProposalProductId(supabase, formTarget.companyId)

    await supabase.from('email_logs').insert({
      company_id: formTarget.companyId,
      subject: subject ? applyVariables(subject, formTarget) : '（フォーム送信）',
      sent_by: session.user.email,
      send_type: 'form',
      proposal_product_id: loggedProductId,
    })

    // フォーム → 送信済 に自動変更
    const sentStatus = statuses.find(s => s.name === '送信済')
    if (sentStatus) {
      await supabase.from('companies').update({ status_id: sentStatus.id }).eq('id', formTarget.companyId)
    }

    setRecordingForm(false)
    setFormIndex(i => i + 1)
  }

  const toggleAll = () => {
    const allSelected = targets.every(t => t.selected)
    setTargets(targets.map(t => ({ ...t, selected: !allSelected })))
    setSent(false)
  }

  const toggle = (i: number) => {
    setTargets(targets.map((t, j) => j === i ? { ...t, selected: !t.selected } : t))
    setSent(false)
  }

  const saveCursor = (field: 'subject' | 'body') => {
    const el = field === 'subject' ? subjectRef.current : textareaRef.current
    if (el) {
      activeFieldRef.current = field
      cursorPosRef.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 }
    }
  }

  const insertVariable = (variable: string) => {
    const pos = cursorPosRef.current
    const field = activeFieldRef.current
    const currentValue = field === 'subject' ? subject : body
    const setValue = field === 'subject' ? setSubject : setBody
    const ref = field === 'subject' ? subjectRef : textareaRef

    const insertAt = pos ?? { start: currentValue.length, end: currentValue.length }
    const before = currentValue.slice(0, insertAt.start)
    const after = currentValue.slice(insertAt.end)
    const newValue = before + variable + after
    setValue(newValue)
    const newCursor = insertAt.start + variable.length
    cursorPosRef.current = { start: newCursor, end: newCursor }
    setTimeout(() => {
      if (ref.current) {
        ref.current.focus()
        ref.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  const handleSend = async () => {
    const selected = targets.filter(t => t.selected)
    if (!selected.length || !subject || !body) return
    // 商材が決まっていない送信は集計・KPIのどちらにも出てこない。ボタン側でも止めているが念のため
    if (!templateProposalProductId) return
    if (resendBlocked) return
    if (!confirm(`${selected.length}件のメールを送信します。よろしいですか？`)) return

    setSending(true)
    const payload = selected.map(t => ({
      companyId: t.companyId,
      companyEmailId: t.companyEmailId,
      email: t.email,
      subject: applyVariables(subject, t),
      body: applyVariables(body, t),
      statusName: t.statusName,
    }))

    // 1回のリクエストで全件送ると、1件1秒待つ関係で100件だと数分かかり、
    // タイムアウトや通信断のときに画面が「送信中」のまま固まって何通送れたか分からなかった。
    // 少しずつ送って結果を積み上げ、失敗したらそこで止める。
    const collected: { email: string; success: boolean }[] = []
    setResults([])
    setSendError(null)
    setSendProgress({ done: 0, total: payload.length })
    for (let i = 0; i < payload.length; i += SEND_CHUNK) {
      const chunk = payload.slice(i, i + SEND_CHUNK)
      try {
        const res = await fetch('/api/gmail/bulk-send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets: chunk, proposalProductId: templateProposalProductId }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        collected.push(...(data.results || []))
      } catch (e) {
        // この塊は途中まで送れている可能性がある。残りは送っていない
        collected.push(...chunk.map(t => ({ email: t.email, success: false })))
        setSendError(
          `${i + 1}〜${i + chunk.length}件目の送信中にエラーが起きたため、ここで止めました（${e instanceof Error ? e.message : '通信エラー'}）。` +
          `この範囲は一部送れている可能性があるので、各顧客のメール履歴で確認してください。` +
          (i + chunk.length < payload.length ? `${i + chunk.length + 1}件目以降は送っていません。` : ''),
        )
        break
      }
      setResults([...collected])
      setSendProgress({ done: collected.length, total: payload.length })
    }
    setResults([...collected])
    setSendProgress(null)
    setSending(false)
    setSent(true)
    // 送信内容の保存はしない（復元しないので持つ意味がない）。古いキーが残っていても読む側がいないので無害
    localStorage.removeItem(`bulkSendDraft_${session?.user?.email}`)
  }

  // 再送で日数が空のまま絞り込む／送るのを止める。空だと直前に送った相手にも当たってしまう
  const resendBlocked = resendEnabled && resendMode && !resendDays
  const selectedCount = targets.filter(t => t.selected).length
  const previewTarget = preview || targets.find(t => t.selected)

  // ステータス×営業担当でグループ化（フォームモードでも同じ順序で処理）
  type Group = { statusName: string; salesRepName: string; groupKey: string; items: { target: Target; index: number }[] }
  const groups: Group[] = []
  const groupMap = new Map<string, Group>()
  const sorted = [...targets]
    .map((t, i) => ({ target: t, index: i }))
    .sort((a, b) => {
      if (a.target.statusSortOrder !== b.target.statusSortOrder) return a.target.statusSortOrder - b.target.statusSortOrder
      if (a.target.salesRepName !== b.target.salesRepName) return a.target.salesRepName.localeCompare(b.target.salesRepName, 'ja')
      return a.target.companyName.localeCompare(b.target.companyName, 'ja')
    })
  for (const item of sorted) {
    const key = `${item.target.statusSortOrder}__${item.target.salesRepName}`
    if (!groupMap.has(key)) {
      const g: Group = { statusName: item.target.statusName, salesRepName: item.target.salesRepName, groupKey: key, items: [] }
      groupMap.set(key, g)
      groups.push(g)
    }
    groupMap.get(key)!.items.push(item)
  }

  const toggleGroup = (g: Group) => {
    const allSelected = g.items.every(({ target }) => target.selected)
    setTargets(prev => prev.map((t, i) => {
      const inGroup = g.items.some(item => item.index === i)
      return inGroup ? { ...t, selected: !allSelected } : t
    }))
    setSent(false)
  }

  if (status === 'loading') return null

  // フォームモード用
  const formTarget = sorted[formIndex]?.target
  const currentSortedIndex = formIndex
  const formDone = formIndex >= sorted.length

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">一斉送信</h2>
          {session?.user?.email && (
            <p className="text-sm text-slate-400 mt-0.5">送信元: {emailToName(session.user.email)}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 左：送信先選択 */}
        <div className="space-y-4">
          <div className="premium-card rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">送信先を選択</h2>
            <div className="space-y-3 mb-3">
              <input
                type="text"
                value={nameSearch}
                onChange={e => setNameSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchTargets()}
                placeholder="会社名で絞り込む"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div>
                <p className="text-xs text-slate-400 mb-1.5">ステータス（複数選択可）</p>
                <div className="flex flex-wrap gap-1.5">
                  {statuses.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStatusFilter(s.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        statusFilters.includes(s.id)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400 hover:text-slate-700'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
              {resendEnabled && (
              <div className="border border-slate-200 rounded-lg px-3 py-2.5">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resendMode}
                    onChange={e => setResendMode(e.target.checked)}
                    className="accent-indigo-600"
                  />
                  <span className="font-semibold text-slate-700">送信履歴で絞り込む（再送）</span>
                </label>
                {resendMode && (
                  <div className="mt-2.5 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={resendSentProduct}
                        onChange={e => setResendSentProduct(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">送信済みの商材（指定なし）</option>
                        {proposalProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select
                        value={resendNotSentProduct}
                        onChange={e => setResendNotSentProduct(e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">未送信の商材（指定なし）</option>
                        {proposalProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      最終送信から
                      <input
                        type="number"
                        min={1}
                        value={resendDays}
                        onChange={e => setResendDays(e.target.value)}
                        className={`w-20 border rounded-lg px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 ${
                          resendDays ? 'border-slate-200 focus:ring-blue-500' : 'border-red-300 focus:ring-red-400'
                        }`}
                      />
                      日以上あいている相手
                    </div>
                    {!resendDays && (
                      <p className="text-xs text-red-500">
                        日数を入れてください。空のままだと昨日送った相手にも再送されてしまいます
                      </p>
                    )}
                    <p className="text-xs text-slate-400 leading-relaxed">
                      返信あり・商談済・案件中・契約済・失注・禁止のステータスと、アポイントのある会社は自動で除外されます
                    </p>
                  </div>
                )}
              </div>
              )}
              <div className="flex flex-wrap gap-2">
                <select
                  value={salesRepFilter}
                  onChange={e => setSalesRepFilter(e.target.value)}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">すべての担当者</option>
                  {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <select
                  value={proposalProductFilter}
                  onChange={e => setProposalProductFilter(e.target.value)}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">すべての提案商材</option>
                  {proposalProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button onClick={() => fetchTargets(false)} disabled={loading || resendBlocked} className="bg-slate-700 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50">
                  絞り込む
                </button>
                <button
                  onClick={() => fetchTargets(true)}
                  disabled={loading || resendBlocked}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-2 rounded-lg text-sm transition flex items-center gap-1.5"
                  title="メールなしの顧客も含めてフォーム送信モードで絞り込む"
                >
                  <ClipboardList size={14} />
                  フォーム
                </button>
              </div>
            </div>

            {fetchError && (
              <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                {fetchError}
              </div>
            )}
            {totalCount !== null && totalCount > FETCH_LIMIT && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                {totalCount.toLocaleString()}件ヒットしましたが、上位{FETCH_LIMIT.toLocaleString()}件のみ表示しています。ステータスで絞り込んでください。
              </div>
            )}

            {targets.length > 0 && (
              <>
                {!formMode && (
                  <div className="flex items-center justify-between mb-2">
                    <button onClick={toggleAll} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700">
                      {targets.every(t => t.selected) ? <CheckSquare size={14} /> : <Square size={14} />}
                      全選択/解除
                    </button>
                    <span className="text-xs text-slate-400">{selectedCount}件選択中</span>
                  </div>
                )}
                {formMode && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-orange-600 font-medium flex items-center gap-1">
                      <ClipboardList size={12} /> フォームモード
                    </span>
                    <span className="text-xs text-slate-400">{Math.min(formIndex, sorted.length)} / {sorted.length} 件完了</span>
                  </div>
                )}
                <div className="max-h-96 overflow-y-auto border border-slate-100 rounded-lg">
                  {groups.map(g => (
                    <div key={g.groupKey}>
                      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100 sticky top-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-600">{g.statusName || '（未設定）'}</span>
                          <span className="text-xs text-slate-400">/ {g.salesRepName || '（担当なし）'}</span>
                          <span className="text-xs text-slate-300">{g.items.length}件</span>
                        </div>
                        {!formMode && (
                          <button
                            onClick={() => toggleGroup(g)}
                            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
                          >
                            {g.items.every(({ target }) => target.selected) ? <CheckSquare size={12} /> : <Square size={12} />}
                            一括選択
                          </button>
                        )}
                      </div>
                      <div className="space-y-0">
                        {g.items.map(({ target: t, index: i }) => {
                          const sortedPos = sorted.findIndex(s => s.index === i)
                          const isDone = formMode && sortedPos < currentSortedIndex && sortedPos >= 0
                          const isCurrent = formMode && sortedPos === currentSortedIndex
                          return (
                            <div
                              key={`${t.companyId}-${t.companyEmailId}`}
                              className={`flex items-center gap-2 px-3 py-1.5 border-b border-slate-50 last:border-0 transition-colors ${
                                isCurrent ? 'bg-orange-50 border-l-2 border-l-orange-400' :
                                isDone ? 'bg-green-50/50' :
                                'hover:bg-slate-50'
                              }`}
                            >
                              {!formMode && (
                                <input type="checkbox" checked={t.selected} onChange={() => toggle(i)} className="rounded" />
                              )}
                              {formMode && (
                                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${isDone ? 'bg-green-400' : isCurrent ? 'bg-orange-400' : 'bg-slate-200'}`} />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs font-medium truncate ${isDone ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.companyName}</p>
                                <p className="text-xs text-slate-400 truncate">{t.email || '（メールなし）'}</p>
                              </div>
                              {!formMode && (
                                <button
                                  type="button"
                                  onClick={e => { e.preventDefault(); setPreview(t) }}
                                  className="text-slate-300 hover:text-blue-500 shrink-0"
                                >
                                  <Eye size={13} />
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {loading && <p className="text-sm text-slate-400 text-center py-4">読み込み中...</p>}
          </div>
        </div>

        {/* 右：フォームモード or メール作成 */}
        <div className="space-y-4">
          {formMode ? (
            <div className="premium-card rounded-2xl p-5">
              {/* ヘッダー */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <ClipboardList size={15} className="text-orange-500" />
                  フォーム送信モード
                </h2>
                <div className="flex items-center gap-3">
                  {!formDone && (
                    <span className="text-xs text-slate-400">{formIndex + 1} / {sorted.length}</span>
                  )}
                  <button
                    onClick={() => { setFormMode(false); setFormIndex(0) }}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-0.5"
                  >
                    <X size={13} /> 終了
                  </button>
                </div>
              </div>

              {/* プログレスバー */}
              {!formDone && (
                <div className="w-full bg-slate-100 rounded-full h-1.5 mb-4">
                  <div
                    className="bg-orange-400 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: sorted.length > 0 ? `${(formIndex / sorted.length) * 100}%` : '0%' }}
                  />
                </div>
              )}

              {/* テンプレート選択 */}
              {!formDone && templates.length > 0 && (
                <div className="mb-4">
                  <select
                    defaultValue=""
                    onChange={e => {
                      const t = templates.find(t => t.id === e.target.value)
                      if (t) { setSubject(t.subject); setBody(t.body); setTemplateProposalProductId(t.proposal_product_id ?? null); setSelectedTemplateName(t.name) }
                      e.target.value = ''
                    }}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-orange-400"
                  >
                    <option value="">テンプレートを選択...</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {selectedTemplateName && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                      <Check size={12} className="shrink-0" />
                      <span>読み込み中: <span className="font-semibold">{selectedTemplateName}</span></span>
                    </div>
                  )}
                </div>
              )}

              {formDone ? (
                /* 完了 */
                <div className="text-center py-10">
                  <div className="text-3xl mb-3">🎉</div>
                  <p className="text-slate-700 font-semibold mb-1">全{sorted.length}件完了！</p>
                  <p className="text-xs text-slate-400">すべてのフォーム送信を記録しました</p>
                  <button
                    onClick={() => { setFormMode(false); setFormIndex(0) }}
                    className="mt-5 bg-slate-700 hover:bg-slate-800 text-white px-5 py-2 rounded-lg text-sm transition"
                  >
                    終了する
                  </button>
                </div>
              ) : formTarget ? (
                <>
                  {/* 会社情報 */}
                  <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <p className="text-sm font-bold text-slate-800 mb-0.5">{formTarget.companyName}</p>
                    <p className="text-xs text-slate-400 mb-2">{formTarget.statusName} / {formTarget.salesRepName || '担当なし'}</p>
                    {formTarget.urls.length > 0 ? (
                      <div className="space-y-1.5">
                        {formTarget.urls.map(u => (
                          <div key={u.id} className="flex items-center gap-1.5">
                            <p className="text-xs text-blue-500 truncate flex-1">
                              {u.label ? <span className="text-slate-400 mr-1">[{u.label}]</span> : null}{u.url}
                            </p>
                            <button
                              onClick={() => copyText(u.url, `url-${u.id}`)}
                              className="shrink-0 flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-1.5 py-0.5"
                            >
                              {copiedField === `url-${u.id}` ? <><Check size={10} className="text-green-500" />済</> : <><Copy size={10} />URL</>}
                            </button>
                            <a
                              href={u.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-slate-300 hover:text-blue-500"
                            >
                              <ExternalLink size={13} />
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">URLが登録されていません</p>
                    )}
                  </div>

                  {/* 件名 */}
                  {subject ? (
                    <div className="mb-3">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-slate-500">件名</label>
                        <button
                          onClick={() => copyText(applyVariables(subject, formTarget), 'subject')}
                          className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-2 py-0.5"
                        >
                          {copiedField === 'subject' ? <><Check size={10} className="text-green-500" />コピー済</> : <><Copy size={10} />コピー</>}
                        </button>
                      </div>
                      <p className="text-sm text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2 select-all">
                        {applyVariables(subject, formTarget)}
                      </p>
                    </div>
                  ) : null}

                  {/* 本文 */}
                  {body ? (
                    <div className="mb-4 -mx-5">
                      <div className="flex items-center justify-between mb-1 px-5">
                        <label className="text-xs text-slate-500">本文</label>
                        <button
                          onClick={() => copyText(applyVariables(body, formTarget), 'body')}
                          className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-2 py-0.5"
                        >
                          {copiedField === 'body' ? <><Check size={10} className="text-green-500" />コピー済</> : <><Copy size={10} />コピー</>}
                        </button>
                      </div>
                      <p className="text-sm text-slate-700 bg-white border-t border-b border-slate-200 px-5 py-2 whitespace-pre-wrap max-h-52 overflow-y-auto select-all">
                        {applyVariables(body, formTarget)}
                      </p>
                    </div>
                  ) : null}

                  {!subject && !body && (
                    <div className="mb-4 px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                      件名・本文が未入力です。「× 終了」でモードを抜けてから入力してください。
                    </div>
                  )}

                  {/* ナビゲーション */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setFormIndex(i => Math.max(0, i - 1))}
                      disabled={formIndex === 0}
                      className="flex items-center gap-1 px-3 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition"
                    >
                      ← 戻る
                    </button>
                    <button
                      onClick={() => setFormIndex(i => i + 1)}
                      className="flex-1 py-2.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition"
                    >
                      スキップ
                    </button>
                    <button
                      onClick={handleFormRecord}
                      disabled={recordingForm}
                      className="flex-1 py-2.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-medium transition disabled:opacity-50"
                    >
                      {recordingForm ? '記録中...' : '記録して次へ →'}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <>
              {/* 通常メール作成パネル */}
              <div className="premium-card rounded-2xl p-5">
                <h2 className="text-sm font-semibold text-slate-700 mb-4">メール作成</h2>

                {templates.length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs text-slate-400 mb-2">テンプレートから読み込む</p>
                    <select
                      defaultValue=""
                      onChange={e => {
                        const t = templates.find(t => t.id === e.target.value)
                        if (t) { setSubject(t.subject); setBody(t.body); setTemplateProposalProductId(t.proposal_product_id ?? null); setSelectedTemplateName(t.name); setSent(false) }
                        e.target.value = ''
                      }}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">テンプレートを選択...</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    {selectedTemplateName && (
                      <div className="mt-2 flex items-center gap-1.5 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5">
                        <Check size={12} className="shrink-0" />
                        <span>読み込み中: <span className="font-semibold">{selectedTemplateName}</span></span>
                        <button onClick={() => { setSubject(''); setBody(''); setTemplateProposalProductId(null); setSelectedTemplateName(null) }} className="ml-auto text-indigo-400 hover:text-indigo-600"><X size={11} /></button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mb-4">
                  <p className="text-xs text-slate-400 mb-2">差し込み変数（クリックで本文に挿入）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {VARIABLES.map(v => (
                      <button
                        key={v.key}
                        type="button"
                        onClick={() => insertVariable(v.label)}
                        className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1 rounded-full transition font-medium"
                      >
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">件名</label>
                    <input
                      ref={subjectRef}
                      type="text"
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      onBlur={() => saveCursor('subject')}
                      onSelect={() => saveCursor('subject')}
                      placeholder="例: {{会社名}} 様へのご提案"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">本文</label>
                    <textarea
                      ref={textareaRef}
                      rows={12}
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      onBlur={() => saveCursor('body')}
                      onSelect={() => saveCursor('body')}
                      placeholder={"例:\n{{代表者名}} 様\n\nお世話になっております。\n{{会社名}}様のサービスについて..."}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>
              </div>

              {previewTarget && subject && body && (
                <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-slate-600">プレビュー: {previewTarget.companyName}</p>
                    {preview && <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>}
                  </div>
                  <p className="text-xs text-slate-500 mb-1">件名</p>
                  <p className="text-sm font-medium text-slate-800 mb-3">{applyVariables(subject, previewTarget)}</p>
                  <p className="text-xs text-slate-500 mb-1">本文</p>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{applyVariables(body, previewTarget)}</p>
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={sending || sent || selectedCount === 0 || !subject || !body || !templateProposalProductId || resendBlocked}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition shadow-sm ${sent ? 'bg-green-100 text-green-700 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'}`}
              >
                <Send size={15} />
                {sending ? (sendProgress ? `送信中... ${sendProgress.done} / ${sendProgress.total}件` : '送信中...') : sent ? '送信済み（内容を変更すると再送信できます）' : resendBlocked ? '再送の日数を入れてください' : !templateProposalProductId ? 'テンプレートを選択してください' : `${selectedCount}件に送信する`}
              </button>

              {sendError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{sendError}</div>
              )}

              {results.length > 0 && (
                <div className="premium-card rounded-2xl p-5">
                  <h2 className="text-sm font-semibold text-slate-700 mb-3">送信結果</h2>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {results.map((r, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={r.success ? 'text-green-500' : 'text-red-500'}>{r.success ? '✓' : '✗'}</span>
                        <span className="text-slate-600">{r.email}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-2">
                    成功: {results.filter(r => r.success).length} / 失敗: {results.filter(r => !r.success).length}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
