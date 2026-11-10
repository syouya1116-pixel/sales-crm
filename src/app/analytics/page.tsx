'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { emailToName } from '@/lib/emailToName'
import { defaultProductId } from '@/lib/defaultProduct'
import type { AnalyticsSummary } from '@/app/api/analytics/summary/route'
import KpiPanel from '@/components/KpiPanel'
import { BarChart2, Mail, Building2, TrendingUp, DollarSign, Calendar, Users, UserPlus, Package } from 'lucide-react'

type Period = 'today' | 'week' | 'month' | 'custom_month' | 'custom_date' | 'all'

type AccountStat = {
  account: string
  sent: number
  replied: number
}

type StatusStat = {
  name: string
  count: number
}

type ChartStat = {
  label: string
  sent: number
}

type RepAptStat = {
  name: string
  count: number
}

type ProductStat = {
  id: string | null
  name: string
  sent: number
}

const PERIOD_LABELS: Record<Period, string> = {
  today: '本日',
  week: '今週',
  month: '今月',
  custom_month: '月指定',
  custom_date: '日指定',
  all: '全期間',
}

function toJST(date: Date, endOfDay = false): string {
  const d = new Date(date)
  if (endOfDay) d.setHours(23, 59, 59, 999)
  else d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function getPeriodRange(period: Period, customMonth: string, customDate: string): { from: string | null; to: string | null } {
  const now = new Date()
  if (period === 'all') return { from: null, to: null }
  if (period === 'today') {
    return {
      from: toJST(new Date(now.getFullYear(), now.getMonth(), now.getDate())),
      to: toJST(new Date(now.getFullYear(), now.getMonth(), now.getDate()), true),
    }
  }
  if (period === 'week') {
    const day = now.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const mon = new Date(now)
    mon.setDate(now.getDate() + diff)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    return { from: toJST(mon), to: toJST(sun, true) }
  }
  if (period === 'custom_month' && customMonth) {
    const [y, m] = customMonth.split('-').map(Number)
    return {
      from: toJST(new Date(y, m - 1, 1)),
      to: toJST(new Date(y, m, 0), true),
    }
  }
  if (period === 'custom_date' && customDate) {
    const [y, m, d] = customDate.split('-').map(Number)
    return {
      from: toJST(new Date(y, m - 1, d)),
      to: toJST(new Date(y, m - 1, d), true),
    }
  }
  return {
    from: toJST(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toJST(new Date(now.getFullYear(), now.getMonth() + 1, 0), true),
  }
}

// グラフの刻み。DB側で集計するので、どの粒度で数えるかだけ渡す
function bucketOf(period: Period): 'hour' | 'dow' | 'day' | 'month' {
  if (period === 'today') return 'hour'
  if (period === 'week') return 'dow'
  if (period === 'all') return 'month'
  return 'day'
}

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function AnalyticsPage() {
  const { status } = useSession()
  const router = useRouter()
  // 初期表示は「本日 × Instagram」。まず今日の数字を見る運用に合わせている
  const [period, setPeriod] = useState<Period>('today')
  const [customMonth, setCustomMonth] = useState(currentYearMonth())
  const [customDate, setCustomDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [accountStats, setAccountStats] = useState<AccountStat[]>([])
  const [statusStats, setStatusStats] = useState<StatusStat[]>([])
  const [chartStats, setChartStats] = useState<ChartStat[]>([])
  const [repAptStats, setRepAptStats] = useState<RepAptStat[]>([])
  const [totalSent, setTotalSent] = useState(0)
  const [totalFormSent, setTotalFormSent] = useState(0)
  const [totalCompanies, setTotalCompanies] = useState(0)
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [totalAppointments, setTotalAppointments] = useState(0)
  const [totalContracted, setTotalContracted] = useState(0)
  const [staffCreationStats, setStaffCreationStats] = useState<{ login_id: string; display_name: string; active: boolean; count: number; formCount: number }[]>([])
  const [productStats, setProductStats] = useState<ProductStat[]>([])
  const [products, setProducts] = useState<{ id: string; name: string }[]>([])
  const [productId, setProductId] = useState<string | null>(null)
  // 商材マスタを読み終わるまで集計を叩かない。
  // 初期表示を Instagram に絞る以上、先に全商材ぶんで1回叩いてから
  // 絞り直すと重い集計を毎回2度走らせることになるため
  const [productReady, setProductReady] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  // 絞り込みの選択肢はマスタから出す（送信ゼロの商材も選べるように）。
  // 併せて初期選択の商材（Instagram）をここで決める
  useEffect(() => {
    if (status !== 'authenticated') return
    supabase.from('proposal_products').select('id, name').order('sort_order')
      .then(({ data }) => {
        const list = data ?? []
        setProducts(list)
        setProductId(defaultProductId(list))
        setProductReady(true)
      })
  }, [status])

  const load = useCallback(async () => {
    if (status !== 'authenticated') return
    if (!productReady) return
    if (period === 'custom_month' && !customMonth) return
    if (period === 'custom_date' && !customDate) return
    setLoading(true)

    const { from, to } = getPeriodRange(period, customMonth, customDate)

    // 業務委託スタッフ別リスト作成数（サーバー集計）
    {
      const sp = new URLSearchParams()
      if (from) sp.set('from', from)
      if (to) sp.set('to', to)
      fetch(`/api/staff/stats?${sp.toString()}`)
        .then(r => (r.ok ? r.json() : { stats: [] }))
        .then(d => setStaffCreationStats(d.stats ?? []))
        .catch(() => setStaffCreationStats([]))
    }

    // 集計本体はDB側（analytics_summary 関数）でやる。
    // 以前はここで顧客・送信ログ・アポを絞り込みなしに全件取得して数えていたが、
    // Supabase の返却行数の上限で途中までしか取れておらず、表示される数字が
    // 全部おかしくなっていた（顧客総数が実際の1割以下で出ていた）。
    {
      const sp = new URLSearchParams()
      if (from) sp.set('from', from)
      if (to) sp.set('to', to)
      sp.set('bucket', bucketOf(period))
      if (productId) sp.set('product', productId)

      const res = await fetch(`/api/analytics/summary?${sp.toString()}`)
      if (!res.ok) {
        console.error('集計の取得に失敗しました', await res.text())
        setLoading(false)
        return
      }
      const d: AnalyticsSummary = await res.json()

      setTotalSent(d.total_sent)
      setTotalFormSent(d.total_form_sent)
      setTotalCompanies(d.total_companies)
      setTotalAppointments(d.total_appointments)
      setTotalContracted(d.total_contracted)
      setTotalRevenue(d.total_revenue)

      setAccountStats(d.account_stats.map(a => ({ account: a.account, sent: a.sent, replied: a.replied })))
      setRepAptStats(d.rep_apt_stats.map(r => ({ name: r.name, count: r.count })))
      // 商材の内訳は絞り込みを掛けても全商材ぶん返る（絞り込みボタンに件数を出すため）
      setProductStats(d.product_stats.map(p => ({ id: p.id, name: p.name, sent: p.sent })))
      // 0件のステータスは今まで通り出さない。ただし「未設定」は
      // 顧客総数と一致させるために出す（以前は表から丸ごと落ちていた）
      setStatusStats(d.status_stats.filter(s => s.count > 0).map(s => ({ name: s.name, count: s.count })))

      // グラフ。並び順のキーはDBが付けてくれるので、ここは表示の都合だけ整える
      if (period === 'week') {
        // 送信ゼロの曜日も枠を残す
        const map = new Map(d.chart_stats.map(c => [c.label, c.sent]))
        setChartStats(['月', '火', '水', '木', '金', '土', '日'].map(l => ({ label: l, sent: map.get(l) ?? 0 })))
      } else if (period === 'all') {
        setChartStats(d.chart_stats.slice(-12).map(c => ({ label: c.label, sent: c.sent })))
      } else {
        setChartStats(d.chart_stats.map(c => ({ label: c.label, sent: c.sent })))
      }
    }

    setLoading(false)
  }, [status, productReady, period, customMonth, customDate, productId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 期間・商材を変えたら再集計する
  useEffect(() => { load() }, [load])

  const maxSent = Math.max(...accountStats.map(s => s.sent), 1)
  const maxChart = Math.max(...chartStats.map(s => s.sent), 1)
  const maxApt = Math.max(...repAptStats.map(s => s.count), 1)
  const maxProduct = Math.max(...productStats.map(s => s.sent), 1)

  const periodLabel = period === 'custom_month' && customMonth
    ? `${customMonth.replace('-', '年')}月`
    : period === 'custom_date' && customDate
    ? customDate.replace(/-/g, '/')
    : PERIOD_LABELS[period]

  const productSentMap = new Map(productStats.map(p => [p.id, p.sent]))
  const unknownProductSent = productSentMap.get(null) ?? 0
  const allProductSent = productStats.reduce((s, p) => s + p.sent, 0)
  const selectedProductName = products.find(p => p.id === productId)?.name ?? null

  const chartLabel = period === 'today' ? '時間別送信数'
    : period === 'week' ? '曜日別送信数'
    : (period === 'month' || period === 'custom_month' || period === 'custom_date') ? '日別送信数'
    : '月別送信数（直近12ヶ月）'

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
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">集計</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            送信・返信・アポの実績サマリー
            {selectedProductName && <span className="text-slate-500">（{selectedProductName}のみ）</span>}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap bg-slate-100 rounded-xl p-1 gap-1">
            {(['today', 'week', 'month', 'custom_month', 'custom_date', 'all'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                  period === p ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          {period === 'custom_month' && (
            <input
              type="month"
              value={customMonth}
              onChange={e => setCustomMonth(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          {period === 'custom_date' && (
            <input
              type="date"
              value={customDate}
              onChange={e => setCustomDate(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          {/* 提案商材で絞る。件数は絞り込み前の内訳なので、選んでも数字は動かない */}
          {products.length > 0 && (
            <div className="flex flex-wrap bg-slate-100 rounded-xl p-1 gap-1">
              <button
                onClick={() => setProductId(null)}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                  productId === null ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                全商材
              </button>
              {products.map(p => (
                <button
                  key={p.id}
                  onClick={() => setProductId(p.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                    productId === p.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {p.name}
                  <span className="text-slate-400 ml-1.5">{(productSentMap.get(p.id) ?? 0).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* KPI進捗。上の期間ボタンとは別に、日／週／月を自分で持っている
          （目標は営業日で按分するので「全期間」「日指定」と噛み合わないため） */}
      <KpiPanel />

      {/* サマリーカード */}
      {/* 6枚。上段に送信数・アポ数・アポ率を並べて、
          「何通送って何件アポになったか」が横一列で読めるようにしている */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Mail size={15} className="text-blue-500" />
            <p className="text-xs text-slate-400 font-medium">送信数 <span className="text-slate-300">({periodLabel})</span></p>
          </div>
          <p className="text-3xl font-bold text-slate-800">{totalSent.toLocaleString()}</p>
          <p className="text-xs text-slate-400 mt-1">
            メール {(totalSent - totalFormSent).toLocaleString()}通 / フォーム {totalFormSent.toLocaleString()}通
          </p>
        </div>
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Calendar size={15} className="text-sky-500" />
            <p className="text-xs text-slate-400 font-medium">アポ数 <span className="text-slate-300">({periodLabel})</span></p>
          </div>
          <p className="text-3xl font-bold text-slate-800">{totalAppointments.toLocaleString()}</p>
          <p className="text-xs text-slate-400 mt-1">件のアポ</p>
        </div>
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={15} className="text-indigo-500" />
            <p className="text-xs text-slate-400 font-medium">アポ率 <span className="text-slate-300">({periodLabel})</span></p>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {totalSent > 0 ? (totalAppointments * 100 / totalSent).toFixed(1) : '0.0'}%
          </p>
          <p className="text-xs text-slate-400 mt-1">アポ {totalAppointments}件 / 送信 {totalSent}通</p>
        </div>
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={15} className="text-rose-500" />
            <p className="text-xs text-slate-400 font-medium">契約率 <span className="text-slate-300">({periodLabel})</span></p>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {totalSent > 0 ? (totalContracted * 100 / totalSent).toFixed(1) : '0.0'}%
          </p>
          <p className="text-xs text-slate-400 mt-1">契約 {totalContracted}件 / 送信 {totalSent}通</p>
        </div>
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={15} className="text-emerald-500" />
            <p className="text-xs text-slate-400 font-medium">売上合計 <span className="text-slate-300">({periodLabel})</span></p>
          </div>
          <p className="text-3xl font-bold text-slate-800">{totalRevenue.toLocaleString()}</p>
          <p className="text-xs text-slate-400 mt-1">円（税込）</p>
        </div>
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <Building2 size={15} className="text-amber-500" />
            <p className="text-xs text-slate-400 font-medium">顧客総数 <span className="text-slate-300">(累計)</span></p>
          </div>
          <p className="text-3xl font-bold text-slate-800">
            {totalCompanies.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-1">件登録</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* アカウント別送信数 */}
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <BarChart2 size={15} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-slate-700">アカウント別実績</h3>
            <span className="text-xs text-slate-400">({periodLabel})</span>
          </div>
          {accountStats.length === 0 ? (
            <p className="text-sm text-slate-400">送信履歴がありません</p>
          ) : (
            <div className="space-y-4">
              {accountStats.map(s => (
                <div key={s.account}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-slate-700">{emailToName(s.account)}</p>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400">送信 <span className="font-semibold text-slate-700">{s.sent}</span></span>
                      <span className="text-xs text-slate-400">返信 <span className="font-semibold text-green-600">{s.replied}</span></span>
                    </div>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(s.sent / maxSent) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 商材別送信数。上のボタンで絞っても、ここは常に全商材の内訳を出す */}
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <Package size={15} className="text-violet-500" />
            <h3 className="text-sm font-semibold text-slate-700">商材別送信数</h3>
            <span className="text-xs text-slate-400">({periodLabel})</span>
          </div>
          {productStats.length === 0 ? (
            <p className="text-sm text-slate-400">送信履歴がありません</p>
          ) : (
            <div className="space-y-4">
              {productStats.map(s => (
                <div key={s.id ?? 'unknown'}>
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-xs font-medium ${s.id ? 'text-slate-700' : 'text-slate-400'}`}>{s.name}</p>
                    <span className="text-xs font-semibold text-violet-600">{s.sent.toLocaleString()}通</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${s.id ? 'bg-violet-400' : 'bg-slate-300'}`}
                      style={{ width: `${(s.sent / maxProduct) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
              {unknownProductSent > 0 && (
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  商材不明は、商材を2つ以上持つ顧客への送信など、どの商材で送ったか特定できないぶんです
                  （全 {allProductSent.toLocaleString()} 通中）。
                </p>
              )}
            </div>
          )}
        </div>

        {/* 担当者別アポ数 */}
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <Users size={15} className="text-sky-500" />
            <h3 className="text-sm font-semibold text-slate-700">担当者別アポ数</h3>
            <span className="text-xs text-slate-400">({periodLabel})</span>
          </div>
          {repAptStats.length === 0 ? (
            <p className="text-sm text-slate-400">アポがありません</p>
          ) : (
            <div className="space-y-4">
              {repAptStats.map(s => (
                <div key={s.name}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium text-slate-700">{s.name}</p>
                    <span className="text-xs font-semibold text-sky-600">{s.count}件</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-sky-400 rounded-full" style={{ width: `${(s.count / maxApt) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 業務委託スタッフ別リスト作成数 */}
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <UserPlus size={15} className="text-indigo-500" />
            <h3 className="text-sm font-semibold text-slate-700">スタッフ別 実績</h3>
            <span className="text-xs text-slate-400">({periodLabel})</span>
          </div>
          {staffCreationStats.filter(s => s.active || s.count > 0 || s.formCount > 0).length === 0 ? (
            <p className="text-sm text-slate-400">対象スタッフがいません</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-indigo-400" />リスト作成</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400" />フォーム送信</span>
              </div>
              {(() => {
                const rows = staffCreationStats.filter(s => s.active || s.count > 0 || s.formCount > 0)
                const maxVal = Math.max(...rows.flatMap(s => [s.count, s.formCount]), 1)
                return rows.map(s => (
                  <div key={s.login_id}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-slate-700">
                        {s.display_name}
                        {!s.active && <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full ml-1.5">無効</span>}
                      </p>
                      <span className="text-xs">
                        <span className="font-semibold text-indigo-600">{s.count}件</span>
                        <span className="text-slate-300 mx-1.5">/</span>
                        <span className="font-semibold text-orange-500">{s.formCount}件</span>
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(s.count / maxVal) * 100}%` }} />
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(s.formCount / maxVal) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                ))
              })()}
            </div>
          )}
        </div>

        {/* ステータス別顧客数 */}
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <Building2 size={15} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-700">ステータス別顧客数</h3>
            <span className="text-xs text-slate-400">(累計)</span>
          </div>
          {statusStats.length === 0 ? (
            <p className="text-sm text-slate-400">データがありません</p>
          ) : (
            <div className="space-y-3">
              {statusStats.map(s => {
                const total = statusStats.reduce((sum, st) => sum + st.count, 0)
                const pct = total > 0 ? Math.round(s.count * 100 / total) : 0
                return (
                  <div key={s.name} className="flex items-center gap-3">
                    <p className="text-xs text-slate-600 w-20 shrink-0">{s.name}</p>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-slate-500 w-12 text-right">{s.count}件</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 期間別グラフ */}
        <div className="premium-card rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp size={15} className="text-violet-500" />
            <h3 className="text-sm font-semibold text-slate-700">{chartLabel}</h3>
            {period === 'custom_month' && <span className="text-xs text-slate-400">({periodLabel})</span>}
          </div>
          {chartStats.length === 0 ? (
            <p className="text-sm text-slate-400">送信履歴がありません</p>
          ) : (
            <div className={`flex items-end h-32 ${chartStats.length > 14 ? 'gap-0.5' : 'gap-2'}`}>
              {chartStats.map(m => {
                const shortLabel = m.label.replace('日', '').replace('時', '')
                const displayLabel = chartStats.length > 14 ? shortLabel : m.label
                return (
                  <div key={m.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    {chartStats.length <= 14 && (
                      <span className="text-xs font-semibold text-slate-600">{m.sent || ''}</span>
                    )}
                    <div className="w-full">
                      <div
                        className="w-full bg-violet-400 rounded-t-sm"
                        style={{ height: `${Math.max((m.sent / maxChart) * 88, m.sent > 0 ? 4 : 0)}px` }}
                        title={`${m.label}: ${m.sent}件`}
                      />
                    </div>
                    <span className="text-slate-400 truncate w-full text-center" style={{ fontSize: chartStats.length > 14 ? '9px' : '12px' }}>
                      {displayLabel}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-300 mt-4">
        ※ 返信数・ステータス別顧客数は期間によらず累計値です。返信数は「返信あり・商談済・案件中・契約済」の顧客を含みます。売上合計は契約日で期間絞り込みをしています。
      </p>
    </div>
  )
}
