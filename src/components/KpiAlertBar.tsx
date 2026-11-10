'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, Target, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { KpiProgress } from '@/app/api/kpi/progress/route'
import { kpiCount } from '@/lib/formatKpiCount'
import { usesDailyCarry } from '@/lib/kpiCarry'
import type { CarryDaysRow } from '@/app/api/kpi/carry-days/route'
import { pacedTarget, type KpiDailyQuotaRow } from '@/lib/kpiDailyQuota'
import { buildKpiTodayLines, type Head, type Line } from '@/lib/kpiTodayLines'

// 今月の送信ノルマに対して、いまどれだけ残っているかを画面上部で知らせるバー。
//
// 【月初からの累計で見る】
// kpi_progress は渡した期間の営業日数で月間目標を按分して返す。
// from=月初・to=今日 で呼べば
//   target_sends … 今日までに送っておくべき累計
//   actual_sends … 今日までに実際に送った累計
// になる。差が「残り」。
// 昨日多めに送っていれば実績累計が先行するので、今日の残りは自然に減る。
// 逆に遅れは繰り越して積み上がる（上限は付けていない）。
//
// 【出る時刻と強さ】
// 8時・12時・17時の3回。強さは3段階。
//   8時  … お知らせ（グレー）。未達でも色を変えない
//   12時 … 注意（オレンジ・点滅なし）
//   17時 … 警告（赤・点滅）
//
// 【昼は「その時点のペース」で見る】
// 表示している「本日残り」は1日分まるごとに対する不足。
// これをそのまま12時の判定に使うと、ペース通りに進んでいる人まで必ず未達になり、
// まだ半日あるのに色がつく。8時を警告から外したのと同じ理由で警告が形骸化する。
// そこで枠ごとに SLOT_PACE を掛けて「その時点で届いていてほしい量」と比べる。
// 前日までの遅れは割引かず満額で効くので、本当に遅れている人は昼でも色がつく。
// 画面の数字（本日残り）は1日分のままにしてある。按分するのは色の判定だけ。
//
// 全員分を出す。誰のアカウントで見ても同じ内容が見える（進捗を共有するため）。
// 点滅もひとりでも未達なら全員の画面で鳴らす。自分が終わっていても
// 相手が遅れていることに気づけるようにするため。
//
// 対象は目標を設定している担当者×商材だけ。目標が無いと比べる相手がいない。
// 担当者ごとに合算して1行にする（商材別の内訳は集計ページで見る）。
//
// 土日祝は to_is_business_day が false になるので出さない。
//
// 【繰り越しの残り】
// kpi_carry が返す繰り越し額は前月末に確定した値で、今月どれだけ送っても動かない。
// そのままだと「繰越103通」が月末まで貼りついて、消化できているのか読めない。
// 画面では実績を「今月ぶん → 繰り越し」の順に充てて、残りを出す（lib/kpiCarry.ts）。
// 月間残りが繰り越し額を下回った時点＝今月ぶんを送り切った時点から減り始める。
//
// 【アポ連動（2026-09〜）】
// 今日のぶんのノルマだけ kpi_daily_quota の値に差し替える。
// アポが足りていないほど今日の送信ノルマが増える。
// 前日までの累計は動かさない（遡って未達にしない）。
// 差し替えるのは今日のぶんだけなので、月間残りは今までどおり。
//
// 【2026-10 からの繰り越し】
// 繰り越しを「本日残り」から外して、別枠で数える（lib/kpiCarry.ts の allocateCarry）。
// 送った分はまずその日までのノルマに充て、超えたぶんで繰り越しを減らす。
// 一度減った繰り越しは戻さない。
// 今日のぶんを送り切っていて繰り越しだけ残っている人は、赤ではなく
// 琥珀（carry）にする。繰り越しが大きい月に警告が出っぱなしになると、
// 本当に今日のぶんが遅れている人との区別がつかなくなるため。

/** バーを出す時刻（時）。この時刻を過ぎたら、その枠の表示が始まる */
const SLOT_HOURS = [8, 12, 17] as const
type Slot = (typeof SLOT_HOURS)[number]

/** この枠から「注意」（オレンジ・点滅なし）を出す */
const CAUTION_FROM: Slot = 12
/** この枠から「警告」（赤・点滅）を出す */
const ALERT_FROM: Slot = 17

/**
 * その枠の時点で、今日のノルマをどこまで進めておいてほしいか（0〜1）。
 * 12時を 0.5 にしているのは正午＝1日の半分という素直な考え方。
 * 営業時間（9〜18時）で見るならもっと緩めて 0.33 でもよい。ここだけ変えれば効く。
 */
const SLOT_PACE: Record<Slot, number> = { 8: 0, 12: 0.5, 17: 1 }

/**
 * 行とバーの強さ。alert だけが点滅する。
 * carry は「今日のぶんは送り切ったが繰り越しが残っている」（2026-10〜）
 */
type Tone = 'done' | 'carry' | 'neutral' | 'caution' | 'alert'

// 行の型（ProductLine・Line・Head）と計算は lib/kpiTodayLines.ts。毎朝の日報APIと共有している

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** いまが属する枠。8時前は null（出さない） */
function currentSlot(now: Date): Slot | null {
  const h = now.getHours()
  let slot: Slot | null = null
  for (const s of SLOT_HOURS) if (h >= s) slot = s
  return slot
}

/** 閉じた記録のキー。日付と枠でひとつ。日をまたげば自然に復活する */
function dismissKey(date: string, slot: Slot) {
  return `kpi-alert-dismissed:${date}:${slot}`
}

const BOX_CLASS: Record<Tone, string> = {
  alert: 'bg-rose-50 border-rose-200 kpi-alert-blink',
  caution: 'bg-amber-50 border-amber-200',
  done: 'bg-emerald-50 border-emerald-200',
  carry: 'bg-yellow-50 border-yellow-200',
  neutral: 'bg-slate-50 border-slate-200',
}
// 警告に見せたくない枠では色だけでなくアイコンの形も弱める。
// △のままだと色を落としても警告として読めてしまう
const HEAD_ICON: Record<Tone, LucideIcon> = {
  alert: AlertTriangle, caution: AlertCircle, done: CheckCircle2, carry: CheckCircle2, neutral: Target,
}
const ROW_ICON: Record<Tone, LucideIcon> = {
  alert: AlertTriangle, caution: AlertCircle, done: CheckCircle2, carry: CheckCircle2, neutral: Circle,
}
const ICON_TONE: Record<Tone, string> = {
  alert: 'text-rose-600', caution: 'text-amber-600', done: 'text-emerald-600', carry: 'text-amber-600', neutral: 'text-slate-500',
}
const HEAD_TEXT_TONE: Record<Tone, string> = {
  alert: 'text-rose-700', caution: 'text-amber-700', done: 'text-emerald-700', carry: 'text-amber-700', neutral: 'text-slate-700',
}
const ROW_ICON_TONE: Record<Tone, string> = {
  ...ICON_TONE,
  neutral: 'text-slate-400',
}
const NUM_TONE: Record<Tone, string> = {
  alert: 'text-rose-600', caution: 'text-amber-600', done: 'text-emerald-600', carry: 'text-emerald-600', neutral: 'text-slate-900',
}

export default function KpiAlertBar() {
  const { status } = useSession()
  const [slot, setSlot] = useState<Slot | null>(null)
  const [today, setToday] = useState(() => ymd(new Date()))
  const [head, setHead] = useState<Head | null>(null)
  const [lines, setLines] = useState<Line[] | null>(null)
  const [dismissed, setDismissed] = useState(true)

  // 開きっぱなしのタブでも8時・12時・17時をまたいだら出したいので、
  // 現在時刻を定期的に見に行く（1分ごと）
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setSlot(currentSlot(now))
      setToday(ymd(now))
    }
    tick()
    const id = setInterval(tick, 60_000)
    return () => clearInterval(id)
  }, [])

  // 枠が変わったら、その枠を閉じ済みかどうかを見直す
  useEffect(() => {
    if (!slot) {
      setDismissed(true)
      return
    }
    setDismissed(localStorage.getItem(dismissKey(today, slot)) === '1')
  }, [slot, today])

  const load = useCallback(async () => {
    if (status !== 'authenticated' || !slot) return
    try {
      const monthStart = `${today.slice(0, 7)}-01`
      const [y, m] = today.split('-').map(Number)
      // 月の最終日。翌月の0日目＝今月の末日
      const monthEnd = ymd(new Date(y, m, 0))

      // 2回叩く。
      //   今日まで … 目標も実績も月初からの累計になる（＝本日残り）
      //   月末まで … 月間目標まるごと（＝月間残り）
      // 期間を変えるだけで同じ関数が両方を返すので、SQLは足していない
      const daily = usesDailyCarry(today.slice(0, 7))
      const [res, resMonth, resQuota, resCarry] = await Promise.all([
        fetch(`/api/kpi/progress?from=${monthStart}&to=${today}`),
        fetch(`/api/kpi/progress?from=${monthStart}&to=${monthEnd}`),
        // アポ連動ぶん。SQL未実行だと500が返るので、失敗しても止めない
        fetch(`/api/kpi/daily-quota?date=${today}`).catch(() => null),
        // 繰り越しを日ごとに充てる材料（2026-10〜）。SQL未実行なら今までの計算で出す
        daily ? fetch(`/api/kpi/carry-days?date=${today}`).catch(() => null) : null,
      ])
      if (!res.ok) throw new Error(await res.text())
      if (!resMonth.ok) throw new Error(await resMonth.text())
      const data: KpiProgress = await res.json()
      const dataMonth: KpiProgress = await resMonth.json()
      const built = buildKpiTodayLines({
        today,
        data,
        dataMonth,
        quotaRows: resQuota?.ok
          ? ((await resQuota.json()) as { rows: KpiDailyQuotaRow[] }).rows
          : null,
        carryRows: resCarry?.ok
          ? ((await resCarry.json()) as { rows: CarryDaysRow[] }).rows
          : null,
      })
      if (!built) {
        setLines(null)
        return
      }
      setHead(built.head)
      setLines(built.lines)
    } catch {
      // 目標未設定・SQL未実行などで取れないことがある。
      // 警告バーは補助的なものなので、黙って出さないだけにする
      setLines(null)
    }
  }, [status, slot, today])

  useEffect(() => { load() }, [load])

  // 出しっぱなしのまま送信して目標に届いたときに、赤が点滅し続けないように
  // 数分ごとに数字を取り直す（達成したらその場で緑に変わる）
  useEffect(() => {
    if (status !== 'authenticated' || !slot || dismissed) return
    const id = setInterval(() => { load() }, 5 * 60_000)
    return () => clearInterval(id)
  }, [status, slot, dismissed, load])

  const close = () => {
    if (slot) localStorage.setItem(dismissKey(today, slot), '1')
    setDismissed(true)
  }

  if (!slot || dismissed || !head || !lines || lines.length === 0) return null

  const pace = SLOT_PACE[slot]

  // 1日分に対して足りていれば done。
  // 足りていなくても、その時刻のペースに乗っていれば色を変えない（neutral）
  const toneOf = (l: Line): Tone => {
    if (l.remaining <= 0) return l.carryLeft > 0 ? 'carry' : 'done'
    if (l.actual >= pacedTarget(l.target, l.todayPortion, pace)) return 'neutral'
    if (slot >= ALERT_FROM) return 'alert'
    if (slot >= CAUTION_FROM) return 'caution'
    return 'neutral'
  }

  const tones = lines.map(toneOf)
  // ひとりでも遅れていれば全員の画面で色がつく。強いほうを採る
  const barTone: Tone = tones.includes('alert')
    ? 'alert'
    : tones.includes('caution')
      ? 'caution'
      : tones.every(t => t === 'done' || t === 'carry')
        ? (tones.includes('carry') ? 'carry' : 'done')
        : 'neutral'

  const HeadIcon = HEAD_ICON[barTone]

  return (
    <div className={`border-b px-4 py-2 md:px-5 md:py-3 ${BOX_CLASS[barTone]}`} role="status">
      {/* スマホ用の短縮表示。
          PCは全部1行に詰めているが、その並びをそのまま375pxに入れると
          担当者の行が横にはみ出してしまう（各行が flex で縮まないため）。
          ラベルを「本日／月間」まで削り、担当者ごとに1行だけ使う形にした。
          PC側のレイアウトは下の md:flex 側でそのまま維持している */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <HeadIcon size={15} className={`shrink-0 ${ICON_TONE[barTone]}`} />
            <span className={`text-xs font-bold whitespace-nowrap ${HEAD_TEXT_TONE[barTone]}`}>
              {head.month}月 {head.dayNo}{head.monthDays > 0 && `/${head.monthDays}`}営業日
              {barTone === 'carry' && ' 本日分達成・繰越あり'}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Link
              href="/analytics"
              className="text-xs font-medium text-slate-600 underline underline-offset-2 px-2 py-1.5"
            >
              集計
            </Link>
            <button
              onClick={close}
              className="p-2 rounded text-slate-400 active:bg-black/5 transition"
              aria-label="閉じる"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="mt-1 space-y-0.5">
          {lines.map((l, i) => {
            const tone = tones[i]
            const RowIcon = ROW_ICON[tone]
            return (
              // 商材が増えるほど横に伸びるので、はみ出したぶんは横スクロール。
              // 縦に積むと担当者×商材でバーが一気に厚くなるため、行数は増やさない
              <div key={l.key} className="flex items-center gap-1.5 text-xs overflow-x-auto whitespace-nowrap">
                <RowIcon size={12} className={`shrink-0 ${ROW_ICON_TONE[tone]}`} />
                <span className="font-semibold text-slate-700 shrink-0">{l.repName}</span>
                {l.products.map(p => (
                  <span key={p.key} className="flex items-baseline gap-1 shrink-0 ml-1">
                    <span className="text-slate-300">・</span>
                    <span className="font-semibold text-slate-600">{p.name}</span>
                    {p.startLabel && (
                      <span className="text-slate-400">（{p.startLabel}〜）</span>
                    )}
                    {p.carry > 0 && (
                      <span className="font-semibold text-amber-600">繰越{kpiCount(p.carry)}</span>
                    )}
                    {p.quotaAdd > 0 && (
                      <span className="font-semibold text-violet-600">追加+{kpiCount(p.quotaAdd)}</span>
                    )}
                    <span className="text-slate-400">本日</span>
                    <span className={`font-bold tabular-nums ${NUM_TONE[tone]}`}>
                      {kpiCount(p.remaining)}
                    </span>
                    {p.ahead > 0 && (
                      <span className="font-semibold text-emerald-600">(+{kpiCount(p.ahead)})</span>
                    )}
                    <span className="text-slate-400">月間</span>
                    <span className="font-semibold text-slate-600 tabular-nums">
                      {kpiCount(p.monthRemaining)}
                    </span>
                  </span>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      <div className="hidden md:flex items-start justify-between gap-4">
        {/* 見出しも担当者も商材の内訳も全部1行に並べる。
            折り返すとバーが厚くなって画面を圧迫するので、入りきらないときは
            折り返さずに横スクロールさせる（whitespace-nowrap + overflow-x-auto）。
            親に min-w-0 が無いと flex 子が縮まずスクロールが効かない */}
        <div className="min-w-0 flex items-center gap-x-5 overflow-x-auto whitespace-nowrap">
          <div className="flex items-center gap-2 shrink-0">
            <HeadIcon size={18} className={ICON_TONE[barTone]} />
            <span className={`text-sm font-bold ${HEAD_TEXT_TONE[barTone]}`}>
              【{head.month}月】{head.dayNo}{head.monthDays > 0 && `/${head.monthDays}`}営業日
              {/* 今日のぶんは全員送り切っていて、繰り越しだけが残っている */}
              {barTone === 'carry' && '　本日分達成・繰越あり'}
            </span>
          </div>


          {lines.map((l, i) => {
            const tone = tones[i]
            const RowIcon = ROW_ICON[tone]

            return (
              <div key={l.key} className="flex items-baseline gap-1.5 shrink-0">
                <RowIcon size={14} className={`shrink-0 self-center ${ROW_ICON_TONE[tone]}`} />
                <span className="text-sm font-semibold text-slate-700">
                  {l.repName}
                </span>

                {/* 数字は商材ごとに出す。担当者の合計は出さない（色の判定にだけ使う） */}
                {l.products.map(p => (
                  <span key={p.key} className="flex items-baseline gap-1 ml-0.5">
                    <span className="text-xs text-slate-300">・</span>
                    <span className="text-sm font-semibold text-slate-600">{p.name}</span>
                    {/* 月の途中から数えている商材だけ起点を出す */}
                    {p.startLabel && (
                      <span className="text-xs text-slate-400">（{p.startLabel}〜）</span>
                    )}
                    {/* 前月の未消化分のうち、まだ残っているぶん。
                        9月までは今月ぶんを送り切ると減り始める。10月からは
                        その日のノルマを超えて送ったぶんだけ減る（戻らない）。
                        元の繰り越し額との対比は集計ページで見る */}
                    {p.carry > 0 && (
                      <span className="text-xs font-semibold text-amber-600">
                        繰越{kpiCount(p.carry)}
                      </span>
                    )}
                    {/* アポが足りていない日の上乗せ。繰り越しと色を分けて、
                        どちらの理由でノルマが増えているのか読めるようにする */}
                    {p.quotaAdd > 0 && (
                      <span className="text-xs font-semibold text-violet-600">
                        追加+{kpiCount(p.quotaAdd)}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">本日</span>
                    <span className={`text-sm font-bold tabular-nums ${NUM_TONE[tone]}`}>
                      {kpiCount(p.remaining)}
                    </span>
                    {/* ノルマより先行している分。翌日以降のぶんを前倒しで送れている状態 */}
                    {p.ahead > 0 && (
                      <span className="text-xs font-semibold text-emerald-600">
                        (+{kpiCount(p.ahead)})
                      </span>
                    )}
                    <span className="text-xs text-slate-400">月間</span>
                    <span className="text-sm font-semibold text-slate-600 tabular-nums">
                      {kpiCount(p.monthRemaining)}
                    </span>
                  </span>
                ))}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/analytics"
            className="text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
          >
            集計へ
          </Link>
          <button
            onClick={close}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-black/5 transition"
            aria-label="閉じる"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
