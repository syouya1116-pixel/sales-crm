'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { supabase } from '@/lib/supabase'
import { emailToName } from '@/lib/emailToName'
import { CheckSquare, Square, Trash2, Plus } from 'lucide-react'
import { ACCOUNT_ORDER } from '@/config/team'

type Task = {
  id: string
  title: string
  done: boolean
  created_by: string | null
  created_at: string
  scheduled_date: string
  original_date: string | null
  is_shared: boolean
}


const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

const toLabel = (key: string, today: string, tomorrow: string) => {
  if (key === today) return '今日'
  if (key === tomorrow) return '明日'
  const d = new Date(key + 'T00:00:00')
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
}

type DateRange = 'today_tomorrow' | 'past' | 'all'

// 「すべて」は件数が青天井なので上限を置いている。
// 超えた分が黙って消えると古いタスクを探しているときに気づけないので、
// 上限に達したことは画面に出す。
const ALL_LIMIT = 1000

export default function TasksPage() {
  const { data: session } = useSession()
  const today = dateKey(new Date())
  const tomorrowDate = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = dateKey(tomorrowDate)

  const [tasks, setTasks] = useState<Task[]>([])
  const [doneFilter, setDoneFilter] = useState<'all' | 'pending' | 'done'>('all')
  const [dateRange, setDateRange] = useState<DateRange>('today_tomorrow')
  const [newTask, setNewTask] = useState('')
  const [newTaskDate, setNewTaskDate] = useState(today)
  const [isShared, setIsShared] = useState(false)
  const [adding, setAdding] = useState(false)


  const fetchTasks = async (range: DateRange) => {
    let query = supabase.from('tasks').select('*').order('scheduled_date', { ascending: false })

    if (range === 'today_tomorrow') {
      // 今日・明日のタスク + 過去の未完了タスク（持ち越し）のみ
      query = query.or(`and(scheduled_date.gte.${today},scheduled_date.lte.${tomorrow}),and(scheduled_date.lt.${today},done.eq.false)`)
    } else if (range === 'past') {
      const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
      query = query.gte('scheduled_date', dateKey(oneYearAgo)).lt('scheduled_date', today)
    } else {
      query = query.limit(ALL_LIMIT)
    }

    const { data } = await query
    if (data) setTasks(data)
  }

  // 初回表示時と、期間を切り替えたときに取得する
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTasks は描画のたびに作り直されるため、期間の変更だけを見る
  useEffect(() => { fetchTasks(dateRange) }, [dateRange])

  const addTask = async () => {
    if (!newTask.trim()) return
    setAdding(true)
    const { data } = await supabase
      .from('tasks')
      .insert({
        title: newTask.trim(),
        created_by: session?.user?.email || null,
        is_shared: isShared,
        created_at: new Date(newTaskDate + 'T09:00:00').toISOString(),
        scheduled_date: newTaskDate,
        original_date: newTaskDate,
      })
      .select()
      .single()
    if (data) setTasks(prev => [data, ...prev])
    setNewTask('')
    setAdding(false)
  }

  const toggleTask = async (task: Task) => {
    await supabase.from('tasks').update({ done: !task.done }).eq('id', task.id)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, done: !t.done } : t))
  }

  const deleteTask = async (id: string) => {
    if (!confirm('このタスクを削除しますか？')) return
    await supabase.from('tasks').delete().eq('id', id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const filtered = tasks.filter(t => {
    if (doneFilter === 'pending' && t.done) return false
    if (doneFilter === 'done' && !t.done) return false
    return true
  })

  const grouped = filtered.reduce<Record<string, Task[]>>((acc, t) => {
    // 過去の未完了タスクは今日グループに集約
    const key = (t.scheduled_date < today && !t.done) ? today : t.scheduled_date
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})


  const renderTaskList = (items: Task[], canEditAll = false) => (
    <>
      {items.length === 0 ? (
        <p className="text-xs text-slate-300 px-4 py-5 text-center">なし</p>
      ) : items.map((t, i) => {
        const canEdit = canEditAll || t.created_by === session?.user?.email
        return (
          <div key={t.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-slate-50 group ${i !== 0 ? 'border-t border-slate-100' : ''}`}>
            <button onClick={() => canEdit && toggleTask(t)} className={`shrink-0 transition ${canEdit ? 'text-slate-300 hover:text-violet-500' : 'text-slate-200 cursor-not-allowed'}`}>
              {t.done ? <CheckSquare size={16} className={canEdit ? 'text-violet-500' : 'text-slate-300'} /> : <Square size={16} />}
            </button>
            <span className={`flex-1 min-w-0 text-sm break-words ${t.done ? 'line-through text-slate-300' : 'text-slate-700'}`}>
              {t.title}
            </span>
            <div className="w-[13px] shrink-0">
              {canEdit && (
                <button onClick={() => deleteTask(t.id)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-300 hover:text-red-400 transition">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">タスク管理</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          {tasks.filter(t => !t.done).length}件未完了
          {dateRange === 'all' && tasks.length >= ALL_LIMIT && ` · 最新${ALL_LIMIT}件のみ表示`}
        </p>
      </div>

      {/* タスク追加 */}
      <div className="premium-card rounded-2xl p-4 mb-5">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            value={newTaskDate}
            onChange={e => setNewTaskDate(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          <input
            type="text"
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addTask()}
            placeholder="新しいタスクを入力..."
            className="flex-1 min-w-[160px] border border-slate-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer whitespace-nowrap select-none">
            <input
              type="checkbox"
              checked={isShared}
              onChange={e => setIsShared(e.target.checked)}
              className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
            />
            <span className={isShared ? 'text-amber-600 font-medium' : ''}>共通</span>
          </label>
          <button
            onClick={addTask}
            disabled={adding || !newTask.trim()}
            className="tap-target flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40"
          >
            <Plus size={14} />追加
          </button>
        </div>
      </div>

      {/* フィルター */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 whitespace-nowrap">期間：</span>
          <div className="flex gap-1">
            {([['today_tomorrow','今日・明日'],['past','過去'],['all','すべて']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setDateRange(val)}
                className={`tap-target text-xs px-3 py-1.5 rounded-lg transition ${dateRange === val ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 whitespace-nowrap">状態：</span>
          <div className="flex gap-1">
            {([['all','すべて'],['pending','未完了'],['done','完了']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setDoneFilter(val)}
                className={`tap-target text-xs px-3 py-1.5 rounded-lg transition ${doneFilter === val ? 'bg-violet-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* タスク一覧（日付別） */}
      {Object.keys(grouped).length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          タスクはありません
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, items]) => {
              const sharedItems = items.filter(t => t.is_shared)
              const personalItems = items.filter(t => !t.is_shared)
              const repA = personalItems.filter(t => t.created_by === ACCOUNT_ORDER[0])
              const repB = personalItems.filter(t => t.created_by === ACCOUNT_ORDER[1])
              return (
                <div key={date}>
                  <p className="text-xs font-semibold text-slate-400 mb-2 px-1">
                    {toLabel(date, today, tomorrow)}
                    <span className="ml-2 font-normal">{items.length}件</span>
                  </p>

                  {/* 共通タスク */}
                  {sharedItems.length > 0 && (
                    <div className="premium-card rounded-2xl overflow-hidden mb-3">
                      <div className="px-4 py-2.5 border-b border-amber-100 bg-amber-50/60">
                        <p className="text-xs font-semibold text-amber-700">共通タスク</p>
                      </div>
                      {renderTaskList(sharedItems, true)}
                    </div>
                  )}

                  {/* 担当者別 */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="premium-card rounded-2xl overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
                        <p className="text-xs font-semibold text-slate-600">{emailToName(ACCOUNT_ORDER[0])}</p>
                      </div>
                      {renderTaskList(repA)}
                    </div>
                    <div className="premium-card rounded-2xl overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
                        <p className="text-xs font-semibold text-slate-600">{emailToName(ACCOUNT_ORDER[1])}</p>
                      </div>
                      {renderTaskList(repB)}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
