'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSiteSettings } from '@/components/SiteSettingsProvider'
import { STATUS_COLOR_OPTIONS, TEAM_COLOR_OPTIONS, sortByTeamOrder, type StatusColorKey } from '@/lib/siteSettings'
import { statusColor } from '@/lib/statusColors'
import { CmsCard, SaveButton, MoveButtons, moveItem, useSettingsSave, cmsInput } from './shared'

type SaveState = Parameters<typeof SaveButton>[0]['state']

// ---------------------------------------------------------------
// 2. チーム（営業担当）
// ---------------------------------------------------------------
type Rep = { id: string; name: string; email: string | null; color: string }

export function TeamCard() {
  const { settings, run } = useSettingsSave()
  const { setReps: publishReps } = useSiteSettings()
  const [rows, setRows] = useState<Rep[]>([])
  const [original, setOriginal] = useState<Record<string, { name: string; email: string | null }>>({})
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [state, setState] = useState<SaveState>('idle')

  const load = useCallback(async () => {
    const { data } = await supabase.from('sales_reps').select('id, name, email')
    const reps = sortByTeamOrder((data ?? []) as { id: string; name: string; email: string | null }[], settings.teamOrder)
    setRows(reps.map((r, i) => ({ ...r, color: settings.teamColors[r.id] ?? TEAM_COLOR_OPTIONS[i % TEAM_COLOR_OPTIONS.length] })))
    setOriginal(Object.fromEntries(reps.map(r => [r.id, { name: r.name, email: r.email }])))
  }, [settings.teamOrder, settings.teamColors])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const update = (id: string, patch: Partial<Rep>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const nextColor = (c: string) => TEAM_COLOR_OPTIONS[(TEAM_COLOR_OPTIONS.indexOf(c) + 1) % TEAM_COLOR_OPTIONS.length]

  const saveAll = async () => {
    if (rows.some(r => !r.name.trim())) { setState({ error: '名前が空の人がいます' }); return }
    setState('saving')
    for (const r of rows) {
      const o = original[r.id]
      const email = r.email?.trim() || null
      if (o && (o.name !== r.name.trim() || o.email !== email)) {
        const { error } = await supabase.from('sales_reps').update({ name: r.name.trim(), email }).eq('id', r.id)
        if (error) { setState({ error: `${r.name} を保存できませんでした（名前かメールが他の人と重複しています）` }); return }
      }
    }
    const ok = await run({
      teamOrder: rows.map(r => r.id),
      teamColors: Object.fromEntries(rows.map(r => [r.id, r.color])),
    })
    if (!ok) { setState({ error: '並び順・色を保存できませんでした' }); return }
    publishReps(rows.map(r => ({ id: r.id, name: r.name.trim(), email: r.email?.trim() || null })))
    setOriginal(Object.fromEntries(rows.map(r => [r.id, { name: r.name.trim(), email: r.email?.trim() || null }])))
    setState('saved')
    setTimeout(() => setState('idle'), 2000)
  }

  const add = async () => {
    if (!newName.trim()) return
    const { data, error } = await supabase.from('sales_reps')
      .insert({ name: newName.trim(), email: newEmail.trim() || null }).select('id, name, email').single()
    if (error || !data) { setState({ error: '追加できませんでした（名前かメールが重複しています）' }); return }
    setRows(rs => [...rs, { ...data, color: TEAM_COLOR_OPTIONS[rs.length % TEAM_COLOR_OPTIONS.length] }])
    setOriginal(o => ({ ...o, [data.id]: { name: data.name, email: data.email } }))
    setNewName(''); setNewEmail('')
  }

  const remove = async (r: Rep) => {
    if (!confirm(`${r.name} を削除しますか？（担当している顧客がいると削除できません）`)) return
    const { error } = await supabase.from('sales_reps').delete().eq('id', r.id)
    if (error) { setState({ error: `${r.name} は担当中の顧客や目標があるため削除できません` }); return }
    setRows(rs => rs.filter(x => x.id !== r.id))
  }

  return (
    <CmsCard id="cms-team" title="チーム（営業担当）" description="名前・メール・色・並び順を変えられます。色は顧客一覧の担当欄の印に、並び順はKPI設定の表に使います。丸をタップすると色が変わります。">
      <div className="space-y-2 mb-3">
        {rows.map((r, i) => (
          <div key={r.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2 rounded-xl border border-slate-100">
            <button type="button" onClick={() => update(r.id, { color: nextColor(r.color) })} aria-label="色を変える" className="w-6 h-6 rounded-full shrink-0 ring-2 ring-white shadow" style={{ backgroundColor: r.color }} />
            <input value={r.name} onChange={e => update(r.id, { name: e.target.value })} placeholder="名前" className={`${cmsInput} flex-1 basis-28`} />
            <input value={r.email ?? ''} onChange={e => update(r.id, { email: e.target.value })} placeholder="メール（任意）" type="email" className={`${cmsInput} flex-[2] basis-44`} />
            <MoveButtons onUp={() => setRows(moveItem(rows, i, -1))} onDown={() => setRows(moveItem(rows, i, 1))} upDisabled={i === 0} downDisabled={i === rows.length - 1} />
            <button type="button" onClick={() => remove(r)} aria-label="削除" className="text-slate-300 hover:text-red-400 p-1 shrink-0"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="flex flex-col sm:flex-row gap-2 bg-slate-50 rounded-xl p-3 mb-4">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="追加する人の名前" className={cmsInput} />
        <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="メール（任意）" type="email" className={cmsInput} />
        <button type="button" onClick={add} disabled={!newName.trim()} className="flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40 shrink-0"><Plus size={14} />追加</button>
      </div>
      <SaveButton state={state} onClick={saveAll} />
    </CmsCard>
  )
}

// ---------------------------------------------------------------
// 3. ステータス（名前・色・並び順）
// ---------------------------------------------------------------
type StatusRow = { id: string; name: string; originalName: string; color: StatusColorKey | '' }

export function StatusCard() {
  const { settings, run } = useSettingsSave()
  const [rows, setRows] = useState<StatusRow[]>([])
  const [newName, setNewName] = useState('')
  const [state, setState] = useState<SaveState>('idle')

  const load = useCallback(async () => {
    const { data } = await supabase.from('statuses').select('id, name, sort_order').order('sort_order')
    setRows((data ?? []).map(s => ({ id: s.id, name: s.name, originalName: s.name, color: settings.statusColors[s.name] ?? '' })))
  }, [settings.statusColors])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const update = (id: string, patch: Partial<StatusRow>) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  const badge = (r: StatusRow) => r.color ? STATUS_COLOR_OPTIONS[r.color].cls : statusColor(r.originalName)

  const saveAll = async () => {
    if (rows.some(r => !r.name.trim())) { setState({ error: '名前が空のステータスがあります' }); return }
    setState('saving')
    for (const [i, r] of rows.entries()) {
      const { error } = await supabase.from('statuses').update({ name: r.name.trim(), sort_order: i + 1 }).eq('id', r.id)
      if (error) { setState({ error: `「${r.name}」を保存できませんでした（同じ名前があります）` }); return }
    }
    const colors: Record<string, StatusColorKey> = {}
    for (const r of rows) if (r.color) colors[r.name.trim()] = r.color
    if (!await run({ statusColors: colors })) { setState({ error: '色を保存できませんでした' }); return }
    setRows(rs => rs.map(r => ({ ...r, name: r.name.trim(), originalName: r.name.trim() })))
    setState('saved')
    setTimeout(() => setState('idle'), 2000)
  }

  const add = async () => {
    if (!newName.trim()) return
    const { data, error } = await supabase.from('statuses')
      .insert({ name: newName.trim(), sort_order: rows.length + 1 }).select('id, name').single()
    if (error || !data) { setState({ error: '追加できませんでした（同じ名前があります）' }); return }
    setRows(rs => [...rs, { id: data.id, name: data.name, originalName: data.name, color: '' }])
    setNewName('')
  }

  const remove = async (r: StatusRow) => {
    if (!confirm(`「${r.originalName}」を削除しますか？（このステータスの顧客がいると削除できません）`)) return
    const { error } = await supabase.from('statuses').delete().eq('id', r.id)
    if (error) { setState({ error: `「${r.originalName}」は使っている顧客がいるため削除できません` }); return }
    setRows(rs => rs.filter(x => x.id !== r.id))
  }

  return (
    <CmsCard id="cms-status" title="ステータス" description="名前・色・並び順を変えられます。並び順は顧客一覧の絞り込みや詳細画面の選択肢の順です。「契約済み」「禁止」は集計や送信除外に使うので、名前を変えるとそれらの対象から外れます。">
      <div className="space-y-2 mb-3">
        {rows.map((r, i) => (
          <div key={r.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 p-2 rounded-xl border border-slate-100">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 max-w-[8rem] truncate ${badge(r)}`}>{r.name || '（空）'}</span>
            <input value={r.name} onChange={e => update(r.id, { name: e.target.value })} className={`${cmsInput} flex-1 basis-32`} aria-label="ステータス名" />
            <select value={r.color} onChange={e => update(r.id, { color: e.target.value as StatusColorKey | '' })} className={`${cmsInput} sm:w-32 basis-24 flex-1 sm:flex-none`} aria-label="色">
              <option value="">標準の色</option>
              {(Object.keys(STATUS_COLOR_OPTIONS) as StatusColorKey[]).map(k => <option key={k} value={k}>{STATUS_COLOR_OPTIONS[k].label}</option>)}
            </select>
            <MoveButtons onUp={() => setRows(moveItem(rows, i, -1))} onDown={() => setRows(moveItem(rows, i, 1))} upDisabled={i === 0} downDisabled={i === rows.length - 1} />
            <button type="button" onClick={() => remove(r)} aria-label="削除" className="text-slate-300 hover:text-red-400 p-1 shrink-0"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="新しいステータス名" className={cmsInput} />
        <button type="button" onClick={add} disabled={!newName.trim()} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40 shrink-0"><Plus size={14} />追加</button>
      </div>
      <SaveButton state={state} onClick={saveAll} />
    </CmsCard>
  )
}

// ---------------------------------------------------------------
// 7. KPI（契約目標・1契約あたりのアポ数・1アポあたりの送信数）
// ---------------------------------------------------------------
type KpiRow = {
  repId: string; repName: string; productId: string; productName: string
  contracts: string; apo: string; sends: string
}

function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function KpiCard() {
  const { settings } = useSiteSettings()
  const [month, setMonth] = useState(thisMonth())
  const [rows, setRows] = useState<KpiRow[]>([])
  const [inherited, setInherited] = useState<string | null>(null)
  const [state, setState] = useState<SaveState>('idle')

  const load = useCallback(async (ym: string) => {
    const [reps, products, current, prev] = await Promise.all([
      supabase.from('sales_reps').select('id, name'),
      supabase.from('proposal_products').select('id, name, sort_order').order('sort_order'),
      supabase.from('kpi_targets').select('*').eq('year_month', ym),
      supabase.from('kpi_targets').select('year_month').lt('year_month', ym).order('year_month', { ascending: false }).limit(1),
    ])
    // その月の目標が無ければ、直前の月の目標を引き継いで表示する（集計側も同じ扱い）
    let targets = current.data ?? []
    let from: string | null = null
    if (targets.length === 0 && prev.data?.[0]) {
      from = prev.data[0].year_month
      targets = (await supabase.from('kpi_targets').select('*').eq('year_month', from)).data ?? []
    }
    setInherited(from)
    const list: KpiRow[] = []
    for (const r of sortByTeamOrder(reps.data ?? [], settings.teamOrder)) {
      for (const p of products.data ?? []) {
        const t = targets.find(x => x.sales_rep_id === r.id && x.proposal_product_id === p.id)
        list.push({
          repId: r.id, repName: r.name, productId: p.id, productName: p.name,
          contracts: String(t?.target_contracts ?? 0),
          apo: String(t?.appointments_per_contract ?? 4),
          sends: String(t?.sends_per_appointment ?? 30),
        })
      }
    }
    setRows(list)
  }, [settings.teamOrder])

  // 読み込みは await のあとで setState するので、同期的な連鎖描画にはならない
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(month) }, [month, load])

  const update = (i: number, patch: Partial<KpiRow>) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const num = (v: string) => Math.max(0, Number(v) || 0)

  const save = async () => {
    setState('saving')
    const { error } = await supabase.from('kpi_targets').upsert(
      rows.map(r => ({
        year_month: month, sales_rep_id: r.repId, proposal_product_id: r.productId,
        target_contracts: num(r.contracts), appointments_per_contract: num(r.apo) || 1, sends_per_appointment: num(r.sends) || 1,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'year_month,sales_rep_id,proposal_product_id' },
    )
    if (error) { setState({ error: '保存できませんでした' }); return }
    setInherited(null)
    setState('saved')
    setTimeout(() => setState('idle'), 2000)
  }

  const numInput = 'w-full min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <CmsCard id="cms-kpi" title="KPI目標" description="契約目標 × 1契約に必要なアポ数 × 1アポに必要な送信数 ＝ 月の送信目標です。営業日（休業日の設定を除く）で割って、毎日のノルマとして上部のバーに出ます。">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="text-xs text-slate-500 font-medium">対象月</label>
        <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {inherited && <span className="text-xs text-amber-600">この月は未設定のため {inherited} の目標を表示しています</span>}
      </div>
      <div className="space-y-2 mb-4">
        {rows.map((r, i) => {
          const monthly = num(r.contracts) * num(r.apo) * num(r.sends)
          return (
            <div key={`${r.repId}-${r.productId}`} className="rounded-xl border border-slate-100 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
                <span className="text-sm font-medium text-slate-700">{r.repName}<span className="text-slate-400 font-normal"> ／ {r.productName}</span></span>
                <span className="text-xs text-slate-500">月の送信目標 <b className="text-slate-800">{Math.round(monthly).toLocaleString()}</b> 通</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="block min-w-0"><span className="block text-[11px] text-slate-400 mb-0.5">契約目標</span>
                  <input type="number" min="0" step="0.5" value={r.contracts} onChange={e => update(i, { contracts: e.target.value })} className={numInput} /></label>
                <label className="block min-w-0"><span className="block text-[11px] text-slate-400 mb-0.5">アポ／契約</span>
                  <input type="number" min="1" step="0.5" value={r.apo} onChange={e => update(i, { apo: e.target.value })} className={numInput} /></label>
                <label className="block min-w-0"><span className="block text-[11px] text-slate-400 mb-0.5">送信／アポ</span>
                  <input type="number" min="1" value={r.sends} onChange={e => update(i, { sends: e.target.value })} className={numInput} /></label>
              </div>
            </div>
          )
        })}
      </div>
      <SaveButton state={state} onClick={save} />
    </CmsCard>
  )
}
