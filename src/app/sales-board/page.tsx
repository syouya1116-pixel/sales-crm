'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Trophy, Medal, Award, DollarSign, FileCheck, Target, ChevronDown, ChevronUp, Save } from 'lucide-react'
import confetti from 'canvas-confetti'
import { OWNER_EMAIL } from '@/config/team'

type Period = 'month' | 'quarter' | 'year' | 'all' | 'custom_month' | 'custom_date'

const PERIOD_LABELS: Record<Period, string> = {
  month: '今月',
  quarter: '今四半期',
  year: '今年',
  all: '全期間',
  custom_month: '月指定',
  custom_date: '日指定',
}

type CompanyDetail = {
  name: string
  instagram_revenue: number
  line_revenue: number
}

type RepStat = {
  id: string
  name: string
  count: number
  revenue: number
  positiveRevenue: number
  cancelRevenue: number
  companies: CompanyDetail[]
  cancelEntries: CompanyDetail[]
}

type TooltipInfo = {
  company: CompanyDetail
  x: number
  y: number
  isCancel?: boolean
}

const RANK_ICONS = [
  <Trophy size={18} className="text-yellow-400" key="1" />,
  <Medal size={18} className="text-slate-400" key="2" />,
  <Award size={18} className="text-amber-600" key="3" />,
]

const REP_COLORS = [
  { count: 'bg-blue-500', revenue: 'bg-emerald-500', countText: 'text-blue-600', revenueText: 'text-emerald-600', countHover: 'hover:bg-blue-400', revenueHover: 'hover:bg-emerald-400' },
  { count: 'bg-violet-500', revenue: 'bg-orange-500', countText: 'text-violet-600', revenueText: 'text-orange-600', countHover: 'hover:bg-violet-400', revenueHover: 'hover:bg-orange-400' },
  { count: 'bg-cyan-500', revenue: 'bg-pink-500', countText: 'text-cyan-600', revenueText: 'text-pink-600', countHover: 'hover:bg-cyan-400', revenueHover: 'hover:bg-pink-400' },
  { count: 'bg-indigo-500', revenue: 'bg-rose-500', countText: 'text-indigo-600', revenueText: 'text-rose-600', countHover: 'hover:bg-indigo-400', revenueHover: 'hover:bg-rose-400' },
]

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function currentDate() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function fmtRevenue(v: number): { main: string; sub: string } {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 100_000_000) return { main: `${sign}${(abs / 100_000_000).toFixed(1)}億`, sub: '円（税込）' }
  if (abs >= 10_000) return { main: `${sign}${Math.round(abs / 10_000).toLocaleString()}万`, sub: '円（税込）' }
  return { main: `${sign}${abs.toLocaleString()}`, sub: '円（税込）' }
}

function getPeriodRange(period: Period, customMonth: string, customDate: string): { from: string | null; to: string | null } {
  const now = new Date()
  if (period === 'all') return { from: null, to: null }
  if (period === 'custom_month' && customMonth) {
    const [y, m] = customMonth.split('-').map(Number)
    return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 0, 23, 59, 59).toISOString() }
  }
  if (period === 'custom_date' && customDate) {
    const [y, m, d] = customDate.split('-').map(Number)
    return { from: new Date(y, m - 1, d, 0, 0, 0).toISOString(), to: new Date(y, m - 1, d, 23, 59, 59).toISOString() }
  }
  if (period === 'month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString() }
  }
  if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3)
    return { from: new Date(now.getFullYear(), q * 3, 1).toISOString(), to: new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59).toISOString() }
  }
  return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to: new Date(now.getFullYear(), 11, 31, 23, 59, 59).toISOString() }
}

const COUNT_MAX_HEIGHT = 120
const REVENUE_MAX_HEIGHT = 200
const BLOCK_GAP = 2

export default function SalesBoardPage() {
  const { status, data: session } = useSession()
  const router = useRouter()
  const isAdmin = session?.user?.email === OWNER_EMAIL
  const [period, setPeriod] = useState<Period>('month')
  const [customMonth, setCustomMonth] = useState(currentYearMonth())
  const [customDate, setCustomDate] = useState(currentDate())
  const [repStats, setRepStats] = useState<RepStat[]>([])
  const [loading, setLoading] = useState(true)
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null)

  // 目標設定
  const [showTargetPanel, setShowTargetPanel] = useState(false)
  const [targetMonth, setTargetMonth] = useState(currentYearMonth())
  const [targetInputs, setTargetInputs] = useState<Record<string, string>>({})
  const [targetMap, setTargetMap] = useState<Record<string, number>>({})
  const [savingTarget, setSavingTarget] = useState(false)
  const [allReps, setAllReps] = useState<{ id: string; name: string }[]>([])
  const [totalTargetInput, setTotalTargetInput] = useState('')
  const [totalTargetSaved, setTotalTargetSaved] = useState(0)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  const load = useCallback(async () => {
    if (status !== 'authenticated') return
    setLoading(true)

    const { from, to } = getPeriodRange(period, customMonth, customDate)
    const { data: statusList } = await supabase.from('statuses').select('id, name')
    const contractedId = statusList?.find(s => s.name === '契約済み')?.id
    if (!contractedId) { setLoading(false); return }

    const { data: salesReps } = await supabase.from('sales_reps').select('id, name').order('name')
    if (salesReps) setAllReps(salesReps)

    // 契約クエリ（contracted_at が期間内 & status = 契約済み）
    let contractQuery = supabase
      .from('companies')
      .select('name, sales_rep_id, instagram_revenue, line_revenue')
      .eq('status_id', contractedId)
    if (from) contractQuery = contractQuery.gte('contracted_at', from)
    if (to) contractQuery = contractQuery.lte('contracted_at', to)

    // キャンセルクエリ（cancelled_at が期間内）
    let cancelQuery = supabase
      .from('companies')
      .select('name, sales_rep_id, instagram_revenue, line_revenue, cancel_instagram_revenue, cancel_line_revenue')
      .not('cancelled_at', 'is', null)
      .or('cancel_instagram_revenue.gt.0,cancel_line_revenue.gt.0')
    if (from) cancelQuery = cancelQuery.gte('cancelled_at', from)
    if (to) cancelQuery = cancelQuery.lte('cancelled_at', to)

    const [{ data: contractedCompanies }, { data: cancelledCompanies }] = await Promise.all([
      contractQuery,
      cancelQuery,
    ])

    if (!contractedCompanies || !salesReps) { setLoading(false); return }

    const stats: RepStat[] = salesReps.map(rep => {
      const repContracts = contractedCompanies
        .filter(c => c.sales_rep_id === rep.id)
        .map(c => ({ name: c.name, instagram_revenue: c.instagram_revenue || 0, line_revenue: c.line_revenue || 0 }))

      const repCancels = (cancelledCompanies || [])
        .filter(c => c.sales_rep_id === rep.id)
        .map(c => ({
          name: c.name,
          instagram_revenue: c.cancel_instagram_revenue || 0,
          line_revenue: c.cancel_line_revenue || 0,
          isFullCancel:
            (c.cancel_instagram_revenue || 0) + (c.cancel_line_revenue || 0) >=
            (c.instagram_revenue || 0) + (c.line_revenue || 0),
        }))

      const positiveRevenue = repContracts.reduce((sum, c) => sum + c.instagram_revenue + c.line_revenue, 0)
      const cancelRevenue = repCancels.reduce((sum, c) => sum + c.instagram_revenue + c.line_revenue, 0)
      const fullCancelCount = repCancels.filter(c => c.isFullCancel).length

      return {
        id: rep.id,
        name: rep.name,
        count: repContracts.length - fullCancelCount,
        revenue: positiveRevenue - cancelRevenue,
        positiveRevenue,
        cancelRevenue,
        companies: repContracts,
        cancelEntries: repCancels.map(({ name, instagram_revenue, line_revenue }) => ({ name, instagram_revenue, line_revenue })),
      }
    })
    stats.sort((a, b) => b.revenue - a.revenue || b.count - a.count)
    setRepStats(stats)
    setLoading(false)
  }, [status, period, customMonth, customDate])

  const loadTargets = useCallback(async () => {
    if (!targetMonth) return
    const [{ data }, { data: totalData }] = await Promise.all([
      supabase.from('sales_targets').select('sales_rep_id, target_revenue').eq('year_month', targetMonth),
      supabase.from('sales_total_targets').select('target_revenue').eq('year_month', targetMonth).maybeSingle(),
    ])
    if (data) {
      const map: Record<string, number> = {}
      const inputs: Record<string, string> = {}
      data.forEach(t => {
        map[t.sales_rep_id] = t.target_revenue
        inputs[t.sales_rep_id] = String(t.target_revenue)
      })
      setTargetMap(map)
      setTargetInputs(inputs)
    }
    if (totalData) {
      setTotalTargetSaved(totalData.target_revenue)
      setTotalTargetInput(String(totalData.target_revenue))
    } else {
      setTotalTargetSaved(0)
      setTotalTargetInput('')
    }
  }, [targetMonth])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 期間を変えたら再集計する
  useEffect(() => { load() }, [load])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 対象月を変えたら目標を読み直す
  useEffect(() => { loadTargets() }, [loadTargets])

  // グラフ表示用の目標（閲覧中の月に対応）
  const graphTargetMonth = period === 'custom_month' ? customMonth : period === 'month' ? currentYearMonth() : null

  const [graphTargetMap, setGraphTargetMap] = useState<Record<string, number>>({})
  const [graphTotalTarget, setGraphTotalTarget] = useState(0)
  useEffect(() => {
    if (!graphTargetMonth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 月指定でない期間はグラフの目標線を消す
      setGraphTargetMap({}); setGraphTotalTarget(0); return
    }
    supabase.from('sales_targets').select('sales_rep_id, target_revenue').eq('year_month', graphTargetMonth)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, number> = {}
          data.forEach(t => { map[t.sales_rep_id] = t.target_revenue })
          setGraphTargetMap(map)
        }
      })
    supabase.from('sales_total_targets').select('target_revenue').eq('year_month', graphTargetMonth).maybeSingle()
      .then(({ data }) => { setGraphTotalTarget(data?.target_revenue ?? 0) })
  }, [graphTargetMonth])

  const saveTargets = async () => {
    setSavingTarget(true)
    const upserts = allReps
      .filter(r => targetInputs[r.id] && Number(targetInputs[r.id]) >= 0)
      .map(r => ({ sales_rep_id: r.id, year_month: targetMonth, target_revenue: Number(targetInputs[r.id]) }))
    if (upserts.length > 0) {
      await supabase.from('sales_targets').upsert(upserts, { onConflict: 'sales_rep_id,year_month' })
    }
    if (totalTargetInput && Number(totalTargetInput) >= 0) {
      await supabase.from('sales_total_targets').upsert(
        { year_month: targetMonth, target_revenue: Number(totalTargetInput) },
        { onConflict: 'year_month' }
      )
    }
    await loadTargets()
    if (graphTargetMonth === targetMonth) {
      const map: Record<string, number> = {}
      upserts.forEach(u => { map[u.sales_rep_id] = u.target_revenue })
      setGraphTargetMap(map)
      if (totalTargetInput && Number(totalTargetInput) >= 0) {
        setGraphTotalTarget(Number(totalTargetInput))
      }
    }
    setSavingTarget(false)
  }

  // グラフ用スケール計算
  const rawMaxPos = Math.max(...repStats.map(r => r.positiveRevenue), 0)
  const rawMaxNeg = Math.max(...repStats.map(r => r.cancelRevenue), 0)
  const hasNegative = rawMaxNeg > 0
  const totalMaxRevenue = rawMaxPos + rawMaxNeg || 1
  const posAreaH = Math.round(REVENUE_MAX_HEIGHT * (rawMaxPos / totalMaxRevenue))
  const negAreaH = hasNegative ? REVENUE_MAX_HEIGHT - posAreaH - 2 : 0
  const maxPosRevenue = Math.max(rawMaxPos, 1)
  const maxNegRevenue = Math.max(rawMaxNeg, 1)

  const maxCount = Math.max(...repStats.map(r => Math.max(r.count, 0)), 1)
  const totalRevenue = repStats.reduce((s, r) => s + r.revenue, 0)
  const totalCount = repStats.reduce((s, r) => s + r.count, 0)
  const blockH = Math.min(Math.floor((COUNT_MAX_HEIGHT - (maxCount - 1) * BLOCK_GAP) / Math.max(maxCount, 1)), 28)

  const totalAchieved = graphTargetMonth != null && graphTotalTarget > 0 && totalRevenue >= graphTotalTarget

  // 全体目標達成時にconfettiを1回だけ発火
  const confettiFiredRef = useRef(false)
  useEffect(() => {
    if (graphTotalTarget > 0 && totalRevenue >= graphTotalTarget && !confettiFiredRef.current) {
      confettiFiredRef.current = true
      confetti({ particleCount: 180, spread: 90, origin: { y: 0.4 }, colors: ['#f59e0b', '#fbbf24', '#10b981', '#3b82f6', '#ec4899'] })
    }
    if (!(graphTotalTarget > 0 && totalRevenue >= graphTotalTarget)) {
      confettiFiredRef.current = false
    }
  }, [graphTotalTarget, totalRevenue])

  if (status === 'loading' || loading) {
    return (
      <div className="p-6">
        <div className="py-24 text-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-400">読み込み中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6" onClick={() => setTooltip(null)}>
      {/* ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">売上ボード</h2>
          <p className="text-sm text-slate-400 mt-0.5">営業担当別の契約件数・売上実績</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap bg-slate-100 rounded-xl p-1 gap-1">
            {(['month', 'quarter', 'year', 'all', 'custom_month', 'custom_date'] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${period === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          {period === 'custom_month' && (
            <input type="month" value={customMonth} onChange={e => setCustomMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          )}
          {period === 'custom_date' && (
            <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          )}
        </div>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <FileCheck size={15} className="text-blue-500" />
            <p className="text-xs text-slate-400 font-medium">契約件数合計 <span className="text-slate-300">({PERIOD_LABELS[period]})</span></p>
          </div>
          <p className={`text-3xl font-bold ${totalCount < 0 ? 'text-red-500' : 'text-slate-800'}`}>{totalCount}</p>
          <p className="text-xs text-slate-400 mt-1">件</p>
        </div>
        <div className={`rounded-2xl border shadow-sm p-5 transition-all ${totalAchieved ? 'bg-gradient-to-br from-amber-50 to-yellow-50 border-amber-300 shadow-amber-100' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={15} className={totalAchieved ? 'text-amber-500' : 'text-emerald-500'} />
            <p className="text-xs text-slate-400 font-medium">売上合計 <span className="text-slate-300">({PERIOD_LABELS[period]})</span></p>
            {totalAchieved && <span className="ml-auto text-xs font-bold text-amber-500 animate-bounce">🎉 目標達成！</span>}
          </div>
          <p className={`text-3xl font-bold ${totalAchieved ? 'text-amber-600' : totalRevenue < 0 ? 'text-red-500' : 'text-slate-800'}`}>{fmtRevenue(totalRevenue).main}</p>
          <p className="text-xs text-slate-400 mt-1">{fmtRevenue(totalRevenue).sub}</p>
          {graphTargetMonth && graphTotalTarget > 0 && (
            <div className={`mt-3 pt-3 border-t ${totalAchieved ? 'border-amber-200' : 'border-slate-100'}`}>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-slate-400">目標: {(graphTotalTarget / 10000).toFixed(0)}万円</span>
                <span className={`font-bold ${totalAchieved ? 'text-amber-500' : 'text-red-400'}`}>
                  達成率 {Math.max(Math.round((totalRevenue / graphTotalTarget) * 100), 0)}%
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all ${totalAchieved ? 'animate-pulse' : 'bg-red-400'}`}
                  style={{
                    width: `${Math.min(Math.max(Math.round((totalRevenue / graphTotalTarget) * 100), 0), 100)}%`,
                    background: totalAchieved ? 'linear-gradient(to right, #f59e0b, #fbbf24, #f59e0b, #fbbf24)' : undefined,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 縦棒グラフ */}
      <div className="premium-card rounded-2xl p-6 relative mb-4">
        <div className="flex items-center gap-2 mb-6">
          <Trophy size={15} className="text-yellow-400" />
          <h3 className="text-sm font-semibold text-slate-700">担当別ランキング</h3>
          <span className="text-xs text-slate-400">({PERIOD_LABELS[period]})</span>
          <div className="ml-auto flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-500 inline-block" />件数</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />売上</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />キャンセル</span>
            {graphTargetMonth && <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: 'linear-gradient(to top, #f59e0b, #fbbf24)' }} />達成</span>}
          </div>
        </div>

        {repStats.length === 0 || repStats.every(r => r.companies.length === 0 && r.cancelEntries.length === 0) ? (
          <p className="text-sm text-slate-400 py-8 text-center">データがありません</p>
        ) : (<>
          {/* ランクバッジ行 */}
          <div className="flex justify-around gap-4 mb-4">
            {repStats.map((r, i) => {
              const targetRevenue = graphTargetMap[r.id] || 0
              const repAchieved = targetRevenue > 0 && r.revenue >= targetRevenue
              return (
                <div key={r.id} className="flex-1 flex flex-col items-center gap-1">
                  {RANK_ICONS[i] ?? <span className="text-sm font-bold text-slate-400">{i + 1}</span>}
                  <span className="text-xs font-semibold text-slate-500">#{i + 1}</span>
                  {repAchieved && (
                    <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-300 rounded-full px-2 py-0.5 animate-pulse">🏆 達成</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* 棒グラフ行 */}
          <div className="flex justify-around gap-4">
            {repStats.map((r, i) => {
              const colors = REP_COLORS[i % REP_COLORS.length]
              const targetRevenue = graphTargetMap[r.id] || 0
              const repAchieved = targetRevenue > 0 && r.revenue >= targetRevenue

              return (
                <div key={r.id} className="flex gap-2 flex-1 justify-center items-end">
                  {/* 件数ブロック列 */}
                  <div className="flex flex-col items-center" style={{ width: '40%' }}>
                    <div className="flex flex-col-reverse gap-px w-full" style={{ height: `${REVENUE_MAX_HEIGHT}px`, justifyContent: 'flex-start' }}>
                      {r.companies.map((c, j) => (
                        <div key={j}
                          className={`w-full rounded-sm ${colors.count} ${colors.countHover} cursor-pointer transition-colors`}
                          style={{ height: `${blockH}px`, flexShrink: 0 }}
                          onMouseEnter={e => { e.stopPropagation(); const rect = (e.target as HTMLElement).getBoundingClientRect(); setTooltip({ company: c, x: rect.left + rect.width / 2, y: rect.top }) }}
                          onMouseLeave={() => setTooltip(null)}
                        />
                      ))}
                    </div>
                    <span className={`text-xs font-bold mt-2 ${r.count < 0 ? 'text-red-500' : colors.countText}`}>{r.count}件</span>
                    <span className="text-xs text-slate-400">件数</span>
                  </div>

                  {/* 売上ブロック列 */}
                  <div className="flex flex-col items-center" style={{ width: '40%' }}>
                    <div style={{ height: `${REVENUE_MAX_HEIGHT}px`, width: '100%', display: 'flex', flexDirection: 'column' }}>
                      {/* プラスエリア（契約ブロック・下から積み上げ） */}
                      <div style={{ height: `${posAreaH}px`, display: 'flex', flexDirection: 'column-reverse', justifyContent: 'flex-start', gap: '1px' }}>
                        {r.companies.map((c, j) => {
                          const rev = c.instagram_revenue + c.line_revenue
                          const h = Math.max(Math.round((rev / maxPosRevenue) * posAreaH), rev > 0 ? 6 : 0)
                          return (
                            <div key={j}
                              className={`w-full rounded-sm cursor-pointer transition-colors ${repAchieved ? 'hover:opacity-80' : `${colors.revenue} ${colors.revenueHover}`}`}
                              style={{
                                height: `${h}px`,
                                flexShrink: 0,
                                background: repAchieved ? 'linear-gradient(to top, #d97706, #fbbf24)' : undefined,
                              }}
                              onMouseEnter={e => { e.stopPropagation(); const rect = (e.target as HTMLElement).getBoundingClientRect(); setTooltip({ company: c, x: rect.left + rect.width / 2, y: rect.top }) }}
                              onMouseLeave={() => setTooltip(null)}
                            />
                          )
                        })}
                      </div>
                      {/* ゼロライン */}
                      {hasNegative && (
                        <div style={{ height: '2px', background: '#94a3b8', flexShrink: 0 }} />
                      )}
                      {/* マイナスエリア（キャンセルブロック・上から積み下げ） */}
                      {hasNegative && (
                        <div style={{ height: `${negAreaH}px`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', gap: '1px' }}>
                          {r.cancelEntries.map((c, j) => {
                            const rev = c.instagram_revenue + c.line_revenue
                            const h = Math.max(Math.round((rev / maxNegRevenue) * negAreaH), rev > 0 ? 6 : 0)
                            return (
                              <div key={j}
                                className="w-full rounded-sm cursor-pointer hover:opacity-80 transition-colors"
                                style={{ height: `${h}px`, flexShrink: 0, background: '#ef4444' }}
                                onMouseEnter={e => { e.stopPropagation(); const rect = (e.target as HTMLElement).getBoundingClientRect(); setTooltip({ company: c, x: rect.left + rect.width / 2, y: rect.top, isCancel: true }) }}
                                onMouseLeave={() => setTooltip(null)}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <span className={`text-xs font-bold mt-2 ${repAchieved ? 'text-amber-500' : r.revenue < 0 ? 'text-red-500' : colors.revenueText}`}>
                      {r.revenue !== 0 ? fmtRevenue(r.revenue).main : '0'}
                    </span>
                    <span className="text-xs text-slate-400">売上</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* 名前行 */}
          <div className="flex justify-around gap-4 mt-4">
            {repStats.map(r => {
              const targetRevenue = graphTargetMap[r.id] || 0
              const repAchieved = targetRevenue > 0 && r.revenue >= targetRevenue
              return (
                <div key={r.id} className="flex-1 text-center">
                  <p className="text-sm font-semibold text-slate-700">{r.name}</p>
                  {targetRevenue > 0 && graphTargetMonth ? (
                    <p className={`text-xs mt-0.5 font-medium ${repAchieved ? 'text-amber-500' : 'text-slate-400'}`}>
                      目標 {(targetRevenue / 10000).toFixed(0)}万円
                    </p>
                  ) : (
                    <p className="text-xs mt-0.5 text-slate-300">—</p>
                  )}
                </div>
              )
            })}
          </div>
        </>)}

        {/* ツールチップ */}
        {tooltip && (
          <div className="fixed z-50 bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y - 8, transform: 'translate(-50%, -100%)' }}>
            <p className="font-semibold mb-1">
              {tooltip.company.name}
              {tooltip.isCancel && <span className="text-red-300 ml-1">（キャンセル）</span>}
            </p>
            {tooltip.isCancel ? (
              <>
                {tooltip.company.instagram_revenue > 0 && <p className="text-red-300">Instagram: -{tooltip.company.instagram_revenue.toLocaleString()}円</p>}
                {tooltip.company.line_revenue > 0 && <p className="text-red-300">LINE: -{tooltip.company.line_revenue.toLocaleString()}円</p>}
              </>
            ) : (
              <>
                {tooltip.company.instagram_revenue > 0 && <p className="text-slate-300">Instagram: {tooltip.company.instagram_revenue.toLocaleString()}円</p>}
                {tooltip.company.line_revenue > 0 && <p className="text-slate-300">LINE: {tooltip.company.line_revenue.toLocaleString()}円</p>}
                {tooltip.company.instagram_revenue === 0 && tooltip.company.line_revenue === 0 && <p className="text-slate-400">売上未入力</p>}
              </>
            )}
          </div>
        )}
      </div>

      {/* 目標設定パネル（管理者のみ） */}
      {isAdmin && <div className="premium-card rounded-2xl" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setShowTargetPanel(!showTargetPanel)}
          className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-slate-50 rounded-2xl transition"
        >
          <Target size={15} className="text-red-400" />
          <span className="text-sm font-semibold text-slate-700">目標設定</span>
          <span className="text-xs text-slate-400 ml-1">（月別売上目標）</span>
          <div className="ml-auto">{showTargetPanel ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}</div>
        </button>

        {showTargetPanel && (
          <div className="px-6 pb-6 border-t border-slate-100">
            <div className="flex items-center gap-3 mt-4 mb-4">
              <label className="text-xs text-slate-500 font-medium">対象月</label>
              <input type="month" value={targetMonth} onChange={e => setTargetMonth(e.target.value)}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-3 mb-4">
              <div className="flex items-center gap-4 pb-3 border-b border-slate-100">
                <span className="text-sm font-semibold text-slate-700 w-24 shrink-0">全体目標</span>
                <div className="relative flex-1 max-w-xs">
                  <input
                    type="number" min="0" placeholder="0"
                    value={totalTargetInput}
                    onChange={e => setTotalTargetInput(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">円</span>
                </div>
                {totalTargetSaved > 0 && (
                  <span className="text-xs text-slate-400">現在: {totalTargetSaved.toLocaleString()}円</span>
                )}
              </div>
              {allReps.map(rep => (
                <div key={rep.id} className="flex items-center gap-4">
                  <span className="text-sm font-medium text-slate-700 w-24 shrink-0">{rep.name}</span>
                  <div className="relative flex-1 max-w-xs">
                    <input
                      type="number" min="0" placeholder="0"
                      value={targetInputs[rep.id] ?? ''}
                      onChange={e => setTargetInputs(prev => ({ ...prev, [rep.id]: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">円</span>
                  </div>
                  {targetMap[rep.id] > 0 && (
                    <span className="text-xs text-slate-400">現在: {targetMap[rep.id].toLocaleString()}円</span>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={saveTargets}
              disabled={savingTarget}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              <Save size={14} />
              {savingTarget ? '保存中...' : '保存する'}
            </button>
          </div>
        )}
      </div>}
    </div>
  )
}
