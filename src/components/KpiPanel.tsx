'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'
import { defaultProductId } from '@/lib/defaultProduct'
import { shortDate } from '@/lib/formatDateTime'
import { kpiCount } from '@/lib/formatKpiCount'
import type { KpiProgress } from '@/app/api/kpi/progress/route'
import { allocateCarry, carryLeft, groupCarryDays, usesDailyCarry } from '@/lib/kpiCarry'
import type { CarryDaysRow } from '@/app/api/kpi/carry-days/route'
import {
  adjustCumulativeTarget, quotaDelta, quotaKey, quotaMap,
  type KpiDailyQuotaRow,
} from '@/lib/kpiDailyQuota'
import { Target, ChevronLeft, ChevronRight, HelpCircle, Settings2 } from 'lucide-react'
import KpiHelp from './KpiHelp'
import { OWNER_EMAIL } from '@/config/team'

// KPI進捗。契約目標から逆算した「今日/今週/今月やるべき送信数」と実績を並べる。
//
// 逆算の考え方（既定値）:
//   契約1件 ← アポ4件 ← 送信120通（送信30通で1アポ）
// 係数は商材ごとに変えられる。目標の入力は月単位で、日・週は営業日数で按分する。
//
// 初期表示は「日 × Instagram」。
// 商材で絞れるのは送信だけで、アポ・契約は担当者単位でしか持っていない
// （顧客が商材を複数持つと二重計上になるため、意図的に商材で割っていない）。
// 絞り込み中はその旨を画面に出す。
//
// 目標を編集できるのは下のメールアドレスの人だけ（画面上の制限）。

const TARGET_EDITOR_EMAIL = OWNER_EMAIL

type Mode = 'day' | 'week' | 'month'

const MODE_LABELS: Record<Mode, string> = {
  day: '日',
  week: '週',
  month: '月',
}

type Rep = { id: string; name: string; email: string | null }
type Product = { id: string; name: string }

type TargetRow = {
  sales_rep_id: string
  proposal_product_id: string
  target_contracts: number
  appointments_per_contract: number
  sends_per_appointment: number
  /** 目標を数え始める日。null は月初から＝月全体 */
  start_day: string | null
}

const DEFAULT_APT_PER_CONTRACT = 4
const DEFAULT_SENDS_PER_APT = 30

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 表示中の期間（JSTの日付）。週は月曜はじまり */
function rangeOf(mode: Mode, anchor: Date): { from: string; to: string } {
  if (mode === 'day') return { from: ymd(anchor), to: ymd(anchor) }
  if (mode === 'week') {
    const day = anchor.getDay()
    const mon = new Date(anchor)
    mon.setDate(anchor.getDate() + (day === 0 ? -6 : 1 - day))
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    return { from: ymd(mon), to: ymd(sun) }
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  return { from: ymd(first), to: ymd(last) }
}

function shift(mode: Mode, anchor: Date, dir: number): Date {
  const d = new Date(anchor)
  if (mode === 'day') d.setDate(d.getDate() + dir)
  else if (mode === 'week') d.setDate(d.getDate() + dir * 7)
  else d.setMonth(d.getMonth() + dir)
  return d
}

function rangeLabel(mode: Mode, from: string, to: string) {
  const f = from.replace(/-/g, '/')
  if (mode === 'day') return f
  if (mode === 'month') return `${from.slice(0, 4)}年${Number(from.slice(5, 7))}月`
  return `${f} 〜 ${to.slice(5).replace('-', '/')}`
}

/** 達成率。目標が0のときは率を出さない（0除算で Infinity になるため） */
function rate(actual: number, target: number): string {
  if (target <= 0) return '—'
  return `${Math.round((actual * 100) / target)}%`
}

/** 残り／超過。目標が0のときは出さない（比べる相手がいないため） */
function diffText(actual: number, target: number): string | null {
  if (target <= 0) return null
  const d = actual - target
  return d >= 0
    ? `+${kpiCount(d)}`
    : `あと${kpiCount(Math.abs(d))}`
}

/** 達成率バー。目標が0のときは引かない */
function ProgressBar({ actual, target }: { actual: number; target: number }) {
  if (target <= 0) return null
  const pct = Math.min(100, Math.round((actual * 100) / target))
  return (
    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
      <div
        className={`h-full rounded-full transition-all ${
          actual >= target ? 'bg-emerald-500' : 'bg-indigo-500'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** 送信・アポ・契約の3枚のカード */
function StatCard({
  label, actual, target, unit,
}: { label: string; actual: number; target: number; unit: string }) {
  const done = target > 0 && actual >= target
  const diff = diffText(actual, target)
  return (
    <div className="bg-slate-50 rounded-xl p-3">
      <p className="text-xs text-slate-400 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800 leading-tight">
        {kpiCount(actual)}
        <span className="text-xs font-normal text-slate-400 ml-1">
          / {kpiCount(target)}{unit}
        </span>
      </p>
      <ProgressBar actual={actual} target={target} />
      <div className="flex items-center gap-2 mt-1.5">
        <span className={`text-xs font-semibold ${done ? 'text-emerald-600' : 'text-slate-500'}`}>
          {rate(actual, target)}
        </span>
        {diff && (
          <span className={`text-xs ${done ? 'text-emerald-500' : 'text-rose-500'}`}>
            {diff}
          </span>
        )}
      </div>
    </div>
  )
}

export default function KpiPanel() {
  const { data: session } = useSession()
  const canEdit = session?.user?.email === TARGET_EDITOR_EMAIL

  const [mode, setMode] = useState<Mode>('day')
  const [anchor, setAnchor] = useState(() => new Date())
  const [data, setData] = useState<KpiProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [reps, setReps] = useState<Rep[]>([])
  const [products, setProducts] = useState<Product[]>([])
  // 送信の絞り込みに使う商材。null は全商材。初期値はマスタを読んでから入れる
  const [productId, setProductId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // 契約目標の入力欄。キーは `担当者ID:商材ID`
  const [contractInputs, setContractInputs] = useState<Record<string, string>>({})
  // 係数は商材ごと。担当者が違っても同じ値を書き込む
  const [aptPerContract, setAptPerContract] = useState<Record<string, string>>({})
  const [sendsPerApt, setSendsPerApt] = useState<Record<string, string>>({})
  // 目標を数え始める日。キーは商材ID。'' は月全体（＝月初から按分。今までどおり）。
  // 月の途中で目標を足すと、月初からの分がまとめて「残り」に乗ってしまうため、
  // 「今日から」を選べるようにしている
  const [startDays, setStartDays] = useState<Record<string, string>>({})
  // 前月から目標を引き継いで表示しているときの、その引き継ぎ元の月。
  // null なら表示中の月に自分の設定が入っている
  const [inheritedFrom, setInheritedFrom] = useState<string | null>(null)
  // アポ連動でその日のノルマに上乗せされた通数（担当者:商材ごと）。
  // 日表示のときだけ入る。週・月は月間目標そのままなので効かせない
  const [quotaAdds, setQuotaAdds] = useState<Record<string, number>>({})
  /**
   * 商材ごとの月間残り（月間目標 − 月初からの実績）。キーは `担当者:商材`。
   * 繰り越しの残りを出すのに要る。表示している期間が日・週でも、
   * 繰り越しの消化は「その月にどれだけ送ったか」で決まるので月ぶんを別に取る
   */
  const [monthLeft, setMonthLeft] = useState<Record<string, number>>({})
  /**
   * 2026-10〜の繰り越し。キーは `担当者:商材`。
   * total はその月に乗った繰り越し額（日表示でも毎日出すため月ぶんから取る）、
   * left はその日のノルマを超えたぶんで減らしたあとの残り（lib/kpiCarry.ts の allocateCarry）。
   * 9月以前・SQL未実行のときは空で、今までの carryLeft で出す
   */
  const [dailyCarry, setDailyCarry] = useState<Record<string, { total: number; left: number }>>({})
  // ノルマの決まり方の説明。初期は閉じておく（毎回読むものではないので）
  const [helpOpen, setHelpOpen] = useState(false)

  const { from, to } = rangeOf(mode, anchor)
  const targetMonth = from.slice(0, 7)
  const today = ymd(new Date())
  // 起点を選べるのは今月だけ。過ぎた月や先の月に「今日から」は意味がない。
  // 保存済みの起点は月に関係なく読み書きするので、選べなくても消えはしない
  const canPickStart = targetMonth === today.slice(0, 7)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/kpi/progress?from=${from}&to=${to}`)
      if (!res.ok) throw new Error(await res.text())
      const json: KpiProgress = await res.json()

      // 繰り越しの残りを出すための月間ぶん。期間を変えるだけで同じ関数が
      // 月間目標まるごとを返すので、SQL は足していない（KpiAlertBar と同じやり方）。
      // 失敗しても本体の表示は止めない。取れないときは繰り越しを満額で出す
      const [my, mm] = targetMonth.split('-').map(Number)
      const monthRes = await fetch(
        `/api/kpi/progress?from=${targetMonth}-01&to=${ymd(new Date(my, mm, 0))}`,
      ).catch(() => null)
      const daily = usesDailyCarry(targetMonth)
      const monthEnd = ymd(new Date(my, mm, 0))
      if (monthRes?.ok) {
        const mj: KpiProgress = await monthRes.json()
        const left: Record<string, number> = {}
        for (const p of mj.product_rows) {
          left[`${p.rep_id}:${p.product_id}`] = p.target_sends - p.actual_sends
        }
        setMonthLeft(left)

        // 2026-10〜：繰り越しは月初から1日ずつ充てて残りを出す。
        // 見ている期間の終わり（今日より先なら今日、月をまたぐなら月末）時点の残り
        const asOf = [to, today, monthEnd].sort()[0]
        const carried = mj.product_rows.filter(p => (p.carry_sends ?? 0) > 0)
        const dc: Record<string, { total: number; left: number }> = {}
        if (daily && carried.length > 0 && asOf >= `${targetMonth}-01`) {
          const cr = await fetch(`/api/kpi/carry-days?date=${asOf}`).catch(() => null)
          if (cr?.ok) {
            const days = groupCarryDays(((await cr.json()) as { rows: CarryDaysRow[] }).rows)
            for (const p of carried) {
              const k = `${p.rep_id}:${p.product_id}`
              const list = days.get(k)
              if (!list || list.length === 0) continue
              dc[k] = { total: p.carry_sends ?? 0, left: allocateCarry(p.carry_sends ?? 0, list).carryLeft }
            }
          }
        }
        setDailyCarry(dc)
      } else {
        setMonthLeft({})
        setDailyCarry({})
      }

      // 2026-10〜の日表示では、繰り越しをその日の目標から外す（別枠で「残り」を出す）。
      // 外さないと月の最初の営業日だけ目標が繰り越しぶん跳ね上がる
      if (daily && mode === 'day') {
        const diff = new Map<string, number>()
        for (const p of json.product_rows) {
          const c = p.carry_sends ?? 0
          if (c <= 0) continue
          p.target_sends = Math.max(0, p.target_sends - c)
          diff.set(p.rep_id, (diff.get(p.rep_id) ?? 0) + c)
        }
        for (const rr of json.rep_rows) {
          rr.target_sends = Math.max(0, rr.target_sends - (diff.get(rr.rep_id) ?? 0))
        }
      }

      // 日表示のときだけ、その日の目標をアポ連動の値に差し替える。
      // 週・月は月間目標を按分したもので、アポ連動は「今日ぶんをどう配るか」
      // の話なので当てない（当てると月間目標より大きくなってしまう）。
      // SQL 未実行なら失敗するだけで、今までどおりの数字が出る
      if (mode === 'day') {
        const r = await fetch(`/api/kpi/daily-quota?date=${from}`).catch(() => null)
        const q = quotaMap(
          r?.ok ? ((await r.json()) as { rows: KpiDailyQuotaRow[] }).rows : null,
        )
        const adds: Record<string, number> = {}
        const diff = new Map<string, number>()
        for (const p of json.product_rows) {
          const row = q.get(quotaKey(p.rep_id, p.product_id))
          const next = adjustCumulativeTarget(p.target_sends, row)
          diff.set(p.rep_id, (diff.get(p.rep_id) ?? 0) + next - p.target_sends)
          adds[quotaKey(p.rep_id, p.product_id)] = Math.max(0, quotaDelta(row))
          p.target_sends = next
        }
        // 担当者行は商材の合計。ずらした分だけ足して整合を保つ
        for (const rr of json.rep_rows) {
          rr.target_sends = Math.max(0, rr.target_sends + (diff.get(rr.rep_id) ?? 0))
        }
        setQuotaAdds(adds)
      } else {
        setQuotaAdds({})
      }
      setData(json)
    } catch {
      setErr('KPIの取得に失敗しました。SQL（supabase-kpi-targets.sql）が未実行かもしれません')
      setData(null)
    }
    setLoading(false)
  }, [from, to, mode, targetMonth, today])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    Promise.all([
      supabase.from('sales_reps').select('id, name, email').order('name'),
      supabase.from('proposal_products').select('id, name').order('sort_order'),
    ]).then(([r, p]) => {
      const list = (p.data as Product[]) ?? []
      setReps((r.data as Rep[]) ?? [])
      setProducts(list)
      setProductId(defaultProductId(list))
    })
  }, [])

  // 編集を開いたときに、その月の設定済みの目標を入力欄へ流し込む。
  // その月の行がまだ無いときは、実際に適用されている引き継ぎ元の月
  // （DB側の kpi_prod と同じ「それ以前で最新の月」）の値を下敷きとして見せる。
  // 空欄で出すと「月が変わって目標が0になった」と誤解されるため
  const loadTargets = useCallback(async () => {
    const cols = 'sales_rep_id, proposal_product_id, target_contracts, appointments_per_contract, sends_per_appointment, start_day'
    const { data: own } = await supabase
      .from('kpi_targets').select(cols).eq('year_month', targetMonth)

    let rows = (own as TargetRow[]) ?? []
    let inherited: string | null = null

    if (rows.length === 0) {
      const { data: prev } = await supabase
        .from('kpi_targets').select('year_month')
        .lt('year_month', targetMonth)
        .order('year_month', { ascending: false })
        .limit(1)
      const ym = (prev as { year_month: string }[] | null)?.[0]?.year_month
      if (ym) {
        const { data: base } = await supabase
          .from('kpi_targets').select(cols).eq('year_month', ym)
        rows = (base as TargetRow[]) ?? []
        inherited = ym
      }
    }

    const contracts: Record<string, string> = {}
    const apc: Record<string, string> = {}
    const spa: Record<string, string> = {}
    const sd: Record<string, string> = {}
    rows.forEach(t => {
      contracts[`${t.sales_rep_id}:${t.proposal_product_id}`] = String(t.target_contracts)
      apc[t.proposal_product_id] = String(t.appointments_per_contract)
      spa[t.proposal_product_id] = String(t.sends_per_appointment)
      // 保存済みの起点はそのまま持ち帰る。開き直すたびに今日へ動くと按分がずれる。
      // 引き継ぎ元の起点は持ち込まない（前月の「25日から」を今月に適用しない）
      sd[t.proposal_product_id] = inherited ? '' : (t.start_day ?? '')
    })
    setContractInputs(contracts)
    setAptPerContract(apc)
    setSendsPerApt(spa)
    setStartDays(sd)
    setInheritedFrom(inherited)
  }, [targetMonth])

  const openEditor = async () => {
    await loadTargets()
    setEditing(true)
  }

  const saveTargets = async () => {
    setSaving(true)
    const rows = reps.flatMap(r =>
      products.map(p => {
        const raw = contractInputs[`${r.id}:${p.id}`]
        const n = Number(raw)
        if (raw === undefined || raw === '' || !isFinite(n) || n < 0) return null
        return {
          year_month: targetMonth,
          sales_rep_id: r.id,
          proposal_product_id: p.id,
          target_contracts: n,
          appointments_per_contract: Number(aptPerContract[p.id]) || DEFAULT_APT_PER_CONTRACT,
          sends_per_appointment: Number(sendsPerApt[p.id]) || DEFAULT_SENDS_PER_APT,
          // '' は月全体。null で入れると今までと同じ計算になる
          start_day: startDays[p.id] || null,
          updated_at: new Date().toISOString(),
        }
      }).filter(Boolean),
    ) as Record<string, unknown>[]

    if (rows.length > 0) {
      const { error } = await supabase
        .from('kpi_targets')
        .upsert(rows, { onConflict: 'year_month,sales_rep_id,proposal_product_id' })
      if (error) {
        setSaving(false)
        setErr(`目標の保存に失敗しました: ${error.message}`)
        return
      }
    }
    setSaving(false)
    setEditing(false)
    await load()
  }

  const noEmailReps = (data?.rep_rows ?? []).filter(r => !r.has_email)
  const selectedProductName = products.find(p => p.id === productId)?.name ?? null

  return (
    <div className="premium-card rounded-2xl p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <Target size={15} className="text-rose-500" />
          <h3 className="text-sm font-semibold text-slate-700">KPI進捗</h3>
          <span className="text-xs text-slate-400">
            {rangeLabel(mode, from, to)}
            {data && <span className="ml-1.5">営業日 {data.business_days}日</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAnchor(a => shift(mode, a, -1))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="前へ"
          >
            <ChevronLeft size={15} />
          </button>
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {(['day', 'week', 'month'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAnchor(a => shift(mode, a, 1))}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="次へ"
          >
            <ChevronRight size={15} />
          </button>
          {/* 引き継ぎ・繰り越し・アポ調整が重なって数字の理由が読みにくいので、
              説明を数字のすぐ横に置く。閲覧だけの人にも出す */}
          <button
            onClick={() => setHelpOpen(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              helpOpen
                ? 'text-slate-800 border-slate-300 bg-slate-100'
                : 'text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
            aria-expanded={helpOpen}
          >
            <HelpCircle size={13} />
            見方
          </button>
          {canEdit && (
            <button
              onClick={() => (editing ? setEditing(false) : openEditor())}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition"
            >
              <Settings2 size={13} />
              目標設定
            </button>
          )}
        </div>
      </div>

      <KpiHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* 送信を商材で絞る。数字はAPIが全商材ぶん返しているので再取得はしない */}
      {products.length > 0 && (
        <div className="mb-4">
          <div className="flex flex-wrap bg-slate-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => setProductId(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                productId === null ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              全商材
            </button>
            {products.map(p => (
              <button
                key={p.id}
                onClick={() => setProductId(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  productId === p.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
          {selectedProductName && (
            <p className="text-xs text-slate-400 mt-2">
              送信のみ{selectedProductName}に絞り込み。アポ・契約は商材で分けられないため全商材の合計です
            </p>
          )}
        </div>
      )}

      {err && <p className="text-sm text-rose-500 mb-4">{err}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">読み込み中...</p>
      ) : !data || data.rep_rows.length === 0 ? (
        <p className="text-sm text-slate-400">営業担当が登録されていません</p>
      ) : (
        <div className="space-y-5">
          {data.rep_rows.map(r => {
            const prodRows = data.product_rows.filter(p => p.rep_id === r.rep_id)
            // 商材で絞っているときは、その商材の行だけを送信の対象にする
            const shown = productId
              ? prodRows.filter(p => p.product_id === productId)
              : prodRows
            // 全商材のときだけ、目標を設定した商材としていない商材を分ける。
            // 混ぜると「Instagramの目標に対してアプリ開発の送信で達成率229%」
            // のような、比べる意味のない数字が出てしまうため。
            // 逆に商材を1つに絞っているときは分けない。分けると目標が未設定の
            // 商材を選んだときに、送信実績が画面からまるごと消えてしまう
            const counted = productId ? shown : shown.filter(p => p.target_sends > 0)
            const untracked = productId
              ? []
              : shown.filter(p => p.target_sends <= 0 && p.actual_sends > 0)
            const actualSends = counted.reduce((sum, p) => sum + p.actual_sends, 0)
            // 全商材のときの目標は担当者行をそのまま使う（目標のある商材の合計と一致する）
            const targetSends = productId
              ? counted.reduce((sum, p) => sum + p.target_sends, 0)
              : r.target_sends
            // 商材が紐づいていない送信ログ（proposal_product_id が NULL）は
            // product_rows に出てこない。担当者合計との差で拾わないと画面から消える。
            const knownSends = prodRows.reduce((sum, p) => sum + p.actual_sends, 0)
            const unknownSends = Math.max(0, r.actual_sends - knownSends)
            // 絞り込み中は「対象外の送信」＝他商材の話なので出さない
            const outsideSends = productId
              ? 0
              : untracked.reduce((sum, p) => sum + p.actual_sends, 0) + unknownSends
            return (
              <div key={r.rep_id} className="border border-slate-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-sm font-semibold text-slate-700">{r.rep_name}</p>
                  {!r.has_email && (
                    <span className="text-xs text-amber-600">メール未設定のため送信実績が出ません</span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StatCard
                    label={selectedProductName ? `送信（${selectedProductName}）` : '送信'}
                    actual={actualSends}
                    target={targetSends}
                    unit="通"
                  />
                  <StatCard label="アポ" actual={r.actual_apts} target={r.target_apts} unit="件" />
                  <StatCard label="契約" actual={r.actual_contracts} target={r.target_contracts} unit="件" />
                </div>

                {/* 商材を絞っているときは上の送信カードと同じ数字になるので出さない */}
                {!productId && counted.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-slate-400 mb-2">商材別の送信</p>
                    <div className="space-y-3">
                      {counted.map(p => (
                        <div key={p.product_id}>
                          <div className="flex items-baseline justify-between gap-2 text-xs">
                            <span className="font-medium text-slate-600">
                              {p.product_name}
                              {/* 月の途中から数えている商材は、集計ページの送信数と数字が合わない。
                                  合わないこと自体は正しいので、起点を出して理由が分かるようにする */}
                              {p.start_day && (
                                <span className="ml-1 font-normal text-slate-400">
                                  （{shortDate(p.start_day)}〜）
                                </span>
                              )}
                              {/* 前月までの未消化分。按分せず月初に全部乗るので、
                                  出しておかないと目標が急に増えた理由が読めない。
                                  実績は今月ぶんを先に埋めるので、今月ぶんを送り切るまで
                                  「残り」は満額のまま動かない（lib/kpiCarry.ts） */}
                              {/* 10月からはその日のノルマを超えて送ったぶんで減る（dailyCarry）。
                                  日表示でも月初の日に限らず毎日出す */}
                              {((p.carry_sends ?? 0) > 0 || dailyCarry[`${p.rep_id}:${p.product_id}`]) && (() => {
                                const dc = dailyCarry[`${p.rep_id}:${p.product_id}`]
                                const total = dc ? dc.total : p.carry_sends ?? 0
                                const left = dc ? dc.left : carryLeft(
                                  total,
                                  monthLeft[`${p.rep_id}:${p.product_id}`],
                                )
                                return left > 0 ? (
                                  <span className="ml-1 font-normal text-amber-600">
                                    （うち繰り越し 残り{kpiCount(left)}通 / {kpiCount(total)}通）
                                  </span>
                                ) : (
                                  <span className="ml-1 font-normal text-emerald-600">
                                    （繰り越し {kpiCount(total)}通 消化済み）
                                  </span>
                                )
                              })()}
                              {/* アポが足りていない日は、その日のノルマが基準値より増える。
                                  出しておかないと目標が急に上がった理由が読めない */}
                              {(quotaAdds[quotaKey(p.rep_id, p.product_id)] ?? 0) > 0 && (
                                <span className="ml-1 font-normal text-violet-600">
                                  （アポ調整 +{kpiCount(quotaAdds[quotaKey(p.rep_id, p.product_id)])}通）
                                </span>
                              )}
                            </span>
                            <span className="text-slate-400 shrink-0">
                              <span className="font-semibold text-slate-700">
                                {kpiCount(p.actual_sends)}
                              </span>
                              {' / '}{kpiCount(p.target_sends)}通
                              <span className={`ml-2 font-semibold ${
                                p.actual_sends >= p.target_sends ? 'text-emerald-600' : 'text-slate-500'
                              }`}>
                                {rate(p.actual_sends, p.target_sends)}
                              </span>
                            </span>
                          </div>
                          <ProgressBar actual={p.actual_sends} target={p.target_sends} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {outsideSends > 0 && (
                  <div className="mt-4 pt-3 border-t border-dashed border-slate-200">
                    <p className="text-xs text-slate-500 mb-2">
                      目標を設定していない送信が {kpiCount(outsideSends)}通
                      <span className="text-slate-400">（上の達成率には入れていません）</span>
                    </p>
                    <div className="space-y-1">
                      {untracked.map(p => (
                        <div key={p.product_id} className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">{p.product_name}</span>
                          <span className="font-medium text-slate-500">
                            {kpiCount(p.actual_sends)}通
                          </span>
                        </div>
                      ))}
                      {unknownSends > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">商材が紐づいていない送信</span>
                          <span className="font-medium text-slate-500">
                            {kpiCount(unknownSends)}通
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {noEmailReps.length > 0 && (
            <p className="text-xs text-amber-600">
              送信実績は営業担当のメールアドレスで突き合わせています。未設定の担当者は
              supabase-kpi-targets.sql のブロック1と同じ UPDATE でメールを入れてください。
            </p>
          )}
        </div>
      )}

      {editing && canEdit && (
        <div className="mt-5 pt-5 border-t border-slate-100">
          <p className="text-sm font-semibold text-slate-700 mb-1">
            {targetMonth.replace('-', '年')}月の目標
          </p>
          <p className="text-xs text-slate-400 mb-4">
            入力するのは契約の目標件数だけ。必要なアポ数と送信数は下の係数から自動で計算します。
            日・週の目標は営業日数（土日を除く）で按分されます。
          </p>
          {inheritedFrom && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
              この月の目標はまだ設定されていないため、{inheritedFrom.replace('-', '年')}月の設定がそのまま適用されています。
              下の数値はその引き継ぎ内容です。保存すると{targetMonth.replace('-', '年')}月の設定として確定します。
            </p>
          )}

          <div className="space-y-4">
            {products.map(p => (
              <div key={p.id} className="border border-slate-100 rounded-xl p-4">
                <p className="text-xs font-semibold text-slate-700 mb-3">{p.name}</p>

                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    送信
                    <input
                      type="number"
                      min={1}
                      value={sendsPerApt[p.id] ?? String(DEFAULT_SENDS_PER_APT)}
                      onChange={e => setSendsPerApt(s => ({ ...s, [p.id]: e.target.value }))}
                      className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    通で1アポ
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-500">
                    アポ
                    <input
                      type="number"
                      min={1}
                      value={aptPerContract[p.id] ?? String(DEFAULT_APT_PER_CONTRACT)}
                      onChange={e => setAptPerContract(s => ({ ...s, [p.id]: e.target.value }))}
                      className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    件で1契約
                  </label>
                </div>

                {/* 月の途中で目標を足すと、月初からの未達がまとめて「残り」に乗る。
                    最終週に1ヶ月分を積まれる形になるので、起点を選べるようにしている。
                    「今日から」を選ぶと、目標も実績もその日以降だけを数える */}
                {canPickStart && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
                    <span className="text-xs text-slate-500">数え始め</span>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`start-${p.id}`}
                        checked={!startDays[p.id]}
                        onChange={() => setStartDays(s => ({ ...s, [p.id]: '' }))}
                      />
                      月全体
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="radio"
                        name={`start-${p.id}`}
                        checked={!!startDays[p.id]}
                        // 保存済みの起点があればそれを使う。無いときだけ今日を入れる
                        onChange={() => setStartDays(s => ({ ...s, [p.id]: s[p.id] || today }))}
                      />
                      {startDays[p.id] && startDays[p.id] !== today
                        ? `${shortDate(startDays[p.id])}から`
                        : '今日から'}
                    </label>
                    {startDays[p.id] && (
                      <span className="text-xs text-slate-400">
                        {shortDate(startDays[p.id])}以降の送信だけを数えます
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {reps.map(r => {
                    const key = `${r.id}:${p.id}`
                    const contracts = Number(contractInputs[key]) || 0
                    const apts = contracts * (Number(aptPerContract[p.id]) || DEFAULT_APT_PER_CONTRACT)
                    const sends = apts * (Number(sendsPerApt[p.id]) || DEFAULT_SENDS_PER_APT)
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-slate-600 w-24">{r.name}</span>
                        <input
                          type="number"
                          min={0}
                          placeholder="0"
                          value={contractInputs[key] ?? ''}
                          onChange={e => setContractInputs(s => ({ ...s, [key]: e.target.value }))}
                          className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-xs text-slate-400">契約</span>
                        <span className="text-xs text-slate-400">
                          → アポ {kpiCount(apts)}件 / 送信 {kpiCount(sends)}通
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={saveTargets}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 transition"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
