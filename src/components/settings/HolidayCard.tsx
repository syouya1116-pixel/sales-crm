'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Plus, Trash2 } from 'lucide-react'

// 営業日から外す日（休業日）の管理。
//
// kpi_holidays に入っている日は KPI の営業日数から除かれる。
// 営業日数は月間目標を日割りする分母なので、ここに1日足すと
// その月の1日あたりのノルマがわずかに上がる。
//
// 祝日は supabase-kpi-holidays.sql で2026・2027年分を入れてある。
// このカードは主に会社独自の休み（夏季休暇・年末年始など）を足すためのもの。
//
// 土日はもともと営業日に数えていないので、期間で追加しても飛ばす。
// 入れても結果は同じだが、一覧が土日で埋まって読みにくくなるため。

type Holiday = { day: string; name: string }

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

function currentYearMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' をローカル日付として読む。new Date(文字列) はUTC扱いで1日ずれる */
function parseDay(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 開始日から終了日までを1日ずつ。土日は飛ばす */
function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const end = parseDay(to)
  for (const d = parseDay(from); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    out.push(ymd(d))
    // 1年分を超えるような指定は事故なので打ち切る
    if (out.length > 400) break
  }
  return out
}

export default function HolidayCard() {
  const [month, setMonth] = useState(currentYearMonth())
  const [rows, setRows] = useState<Holiday[]>([])
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!month) return
    // 月初以上・翌月初未満。翌月の桁上がりは Date に任せる
    const start = `${month}-01`
    const next = parseDay(start)
    next.setMonth(next.getMonth() + 1)

    const { data, error } = await supabase
      .from('kpi_holidays')
      .select('day, name')
      .gte('day', start)
      .lt('day', ymd(next))
      .order('day')

    if (error) {
      setErr('休業日の取得に失敗しました。SQL（supabase-kpi-holidays.sql）が未実行かもしれません')
      setRows([])
      return
    }
    setErr(null)
    setRows((data as Holiday[]) ?? [])
  }, [month])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 表示月を変えたらDBから読み直す
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!fromDay) return
    const end = toDay && toDay >= fromDay ? toDay : fromDay
    const days = weekdaysBetween(fromDay, end)
    if (days.length === 0) {
      setErr('指定した期間に平日がありません（土日はもともと営業日ではありません）')
      return
    }

    setSaving(true)
    // 既に入っている日（祝日など）は名前を上書きする
    const { error } = await supabase
      .from('kpi_holidays')
      .upsert(
        days.map(day => ({ day, name: name.trim() || '休業日' })),
        { onConflict: 'day' },
      )
    setSaving(false)

    if (error) {
      setErr(`保存に失敗しました: ${error.message}`)
      return
    }
    setName('')
    setToDay('')
    await load()
  }

  const remove = async (h: Holiday) => {
    const d = parseDay(h.day)
    if (!confirm(
      `${d.getMonth() + 1}月${d.getDate()}日（${h.name}）を休業日から外しますか？\n`
      + 'この日が営業日に戻り、その分の目標が積まれるようになります。',
    )) return

    setSaving(true)
    const { error } = await supabase.from('kpi_holidays').delete().eq('day', h.day)
    setSaving(false)
    if (error) {
      setErr(`削除に失敗しました: ${error.message}`)
      return
    }
    await load()
  }

  return (
    <div className="premium-card rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">休業日（営業日から除外）</h3>
      <p className="text-xs text-slate-400 mb-4">
        ここに入れた日はKPIの営業日数から外れます。祝日は登録済みなので、夏季休暇や年末年始などを追加してください。
      </p>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-slate-500 font-medium shrink-0">対象月</label>
        <input
          type="month"
          value={month}
          onChange={e => {
            // 表示月を変えたら、追加欄の初期値もその月の1日に寄せる
            setMonth(e.target.value)
            setFromDay(`${e.target.value}-01`)
            setToDay('')
          }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-xs text-slate-400">{rows.length}日</span>
      </div>

      {err && (
        <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-3">{err}</p>
      )}

      <div className="space-y-1 mb-4">
        {rows.length === 0 && (
          <p className="text-xs text-slate-300 px-3 py-2">この月の休業日はまだありません</p>
        )}
        {rows.map(h => {
          const d = parseDay(h.day)
          return (
            <div key={h.day} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 group">
              <span className="text-sm text-slate-700 w-20 shrink-0 tabular-nums">
                {d.getMonth() + 1}月{d.getDate()}日
              </span>
              <span className="text-xs text-slate-400 w-6 shrink-0">
                {WEEKDAY[d.getDay()]}
              </span>
              <span className="flex-1 text-sm text-slate-500 truncate">{h.name}</span>
              <button
                onClick={() => remove(h)}
                className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition shrink-0"
              >
                <Trash2 size={13} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="space-y-2 bg-slate-50 rounded-xl p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fromDay}
            onChange={e => setFromDay(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-400">〜</span>
          <input
            type="date"
            value={toDay}
            min={fromDay || undefined}
            onChange={e => setToDay(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-400">連休でなければ空欄でOK</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="名称（例：夏季休暇）"
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={add}
            disabled={saving || !fromDay}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-40 shrink-0"
          >
            <Plus size={14} />追加
          </button>
        </div>
      </div>
    </div>
  )
}
