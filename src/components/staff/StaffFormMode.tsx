'use client'

import { useCallback, useEffect, useState } from 'react'
import { ClipboardList, Copy, Check, ExternalLink, X, AlertTriangle } from 'lucide-react'
import { applyVariables, pickTemplateForRep, type PickableTemplate } from '@/lib/emailVariables'

type FormTarget = {
  companyId: string
  companyName: string
  representativeName: string
  serviceName: string
  genreName: string
  salesRepName: string
  urls: { id: string; url: string; label: string | null }[]
}

type Props = {
  /** モードを抜ける（取り置きの解放は本コンポーネント側で済ませてから呼ぶ） */
  onExit: () => void
  /** 1件記録するたびに呼ばれる（マイページの集計を更新する用） */
  onRecorded?: () => void
}

export default function StaffFormMode({ onExit, onRecorded }: Props) {
  const [targets, setTargets] = useState<FormTarget[]>([])
  const [templates, setTemplates] = useState<PickableTemplate[]>([])
  // 残り件数はサーバー側で数えられないことがある（その場合は null＝非表示）
  const [remaining, setRemaining] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  const [doneIds, setDoneIds] = useState<string[]>([])
  const [skippedIds, setSkippedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const post = useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/staff/form-queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    // ログイン切れなどでHTMLが返ることがある。JSONでないまま握り潰すと
    // 「リストがありません」に化けて原因が分からなくなるので、ここで落とす。
    const text = await res.text()
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(`サーバーの応答が不正です（HTTP ${res.status}）。ログインし直してください。`)
    }
    if (!res.ok || data.error) {
      throw new Error(String(data.error || `エラーが発生しました（HTTP ${res.status}）`))
    }
    return data
  }, [])

  const claim = useCallback(async (exclude: string[]) => {
    setLoading(true)
    try {
      const data = await post({ action: 'claim', exclude })
      setTargets((data.targets as FormTarget[]) ?? [])
      setTemplates((data.templates as PickableTemplate[]) ?? [])
      setRemaining(typeof data.remaining === 'number' ? data.remaining : null)
      setIndex(0)
      setNotice(null)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'リストの取得に失敗しました。')
    } finally {
      setLoading(false)
    }
  }, [post])

  useEffect(() => { claim([]) }, [claim])

  const exit = async () => {
    // 未処理のまま抜けるぶんは他の人が使えるよう手放す
    await post({ action: 'release' }).catch(() => {})
    onExit()
  }

  const copyText = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch {}
  }

  const target = targets[index]
  const template = target ? pickTemplateForRep(templates, target.salesRepName) : null
  const batchDone = targets.length > 0 && index >= targets.length

  const handleRecord = async () => {
    if (!target || !template) return
    setRecording(true)
    setNotice(null)
    try {
      const subject = applyVariables(template.subject, target)
      const data = await post({ action: 'record', companyId: target.companyId, subject })
      if (data.ok) {
        setDoneIds(prev => [...prev, target.companyId])
        onRecorded?.()
      } else if (data.reason === 'already_sent') {
        setNotice(`「${target.companyName}」はすでに他の人が送信済みでした。記録せず次に進みます。`)
        setSkippedIds(prev => [...prev, target.companyId])
      } else {
        setNotice('記録に失敗しました。もう一度お試しください。')
        setRecording(false)
        return
      }
      setIndex(i => i + 1)
    } catch {
      setNotice('記録に失敗しました。通信状況を確認してください。')
    } finally {
      setRecording(false)
    }
  }

  const handleSkip = () => {
    if (target) setSkippedIds(prev => [...prev, target.companyId])
    setIndex(i => i + 1)
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <ClipboardList size={15} className="text-orange-500" />
            フォーム送信
          </h2>
          <div className="flex items-center gap-3">
            {remaining !== null && (
              <span className="text-xs text-slate-400">
                未送信 残り{remaining}件
              </span>
            )}
            <button onClick={exit} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-0.5">
              <X size={13} />終了
            </button>
          </div>
        </div>

        {targets.length > 0 && (
          <>
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-3">
              <div
                className="bg-orange-400 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(Math.min(index, targets.length) / targets.length) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              今回の割り当て {Math.min(index, targets.length)} / {targets.length} 件完了
              <span className="text-slate-300 ml-2">（送信済 {doneIds.length}件）</span>
            </p>
          </>
        )}
      </div>

      {notice && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-400 hover:text-amber-700"><X size={12} /></button>
        </div>
      )}

      {loading ? (
        <p className="text-center text-sm text-slate-400 py-16 bg-white rounded-xl border border-slate-200">
          リストを取得中...
        </p>
      ) : targets.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200 px-4">
          <p className="text-sm text-slate-500 mb-1">送信できるリストがありません</p>
          <p className="text-xs text-slate-400">
            対象は「提案商材 Instagram × ステータス フォーム」の顧客です。<br />
            該当がないか、ほかの人が作業中です。時間をおいて試してください。
          </p>
          <button onClick={exit} className="mt-5 bg-slate-700 hover:bg-slate-800 text-white px-5 py-2 rounded-lg text-sm transition">
            戻る
          </button>
        </div>
      ) : batchDone ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200 px-4">
          <div className="text-3xl mb-3">🎉</div>
          <p className="text-slate-700 font-semibold mb-1">{targets.length}件おつかれさまでした！</p>
          <p className="text-xs text-slate-400 mb-5">送信を記録したのは {doneIds.length}件です</p>
          <div className="flex gap-2 justify-center">
            <button onClick={exit} className="border border-slate-200 text-slate-600 hover:bg-slate-50 px-5 py-2 rounded-lg text-sm transition">
              終了する
            </button>
            <button
              onClick={() => claim([...doneIds, ...skippedIds])}
              className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg text-sm font-medium transition"
            >
              次のリストを取得
            </button>
          </div>
        </div>
      ) : target ? (
        <>
          {/* 適用中のテンプレート */}
          {template ? (
            <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2">
              <Check size={12} className="shrink-0" />
              <span>
                担当 <span className="font-semibold">{target.salesRepName || '未設定'}</span> →
                適用中: <span className="font-semibold">{template.name}</span>
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>
                営業担当「{target.salesRepName || '未設定'}」に対応するテンプレートが見つかりません。
                この件は送信できないのでスキップしてください。
                （設定ページのテンプレート名に担当者の姓が入っているか確認が必要です）
              </span>
            </div>
          )}

          {/* 会社情報 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-bold text-slate-800 mb-0.5">{target.companyName}</p>
            <p className="text-xs text-slate-400 mb-3">担当: {target.salesRepName || '未設定'}</p>
            {target.urls.length > 0 ? (
              <div className="space-y-1.5">
                {target.urls.map(u => (
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
                    <a href={u.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-slate-300 hover:text-blue-500">
                      <ExternalLink size={13} />
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">URLが登録されていません</p>
            )}
          </div>

          {/* 件名・本文 */}
          {template && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-500">件名</label>
                  <button
                    onClick={() => copyText(applyVariables(template.subject, target), 'subject')}
                    className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-2 py-0.5"
                  >
                    {copiedField === 'subject' ? <><Check size={10} className="text-green-500" />コピー済</> : <><Copy size={10} />コピー</>}
                  </button>
                </div>
                <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 select-all">
                  {applyVariables(template.subject, target)}
                </p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-slate-500">本文</label>
                  <button
                    onClick={() => copyText(applyVariables(template.body, target), 'body')}
                    className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded px-2 py-0.5"
                  >
                    {copiedField === 'body' ? <><Check size={10} className="text-green-500" />コピー済</> : <><Copy size={10} />コピー</>}
                  </button>
                </div>
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap max-h-64 overflow-y-auto select-all">
                  {applyVariables(template.body, target)}
                </p>
              </div>
            </div>
          )}

          {/* 操作 */}
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="flex-1 py-3 text-sm border border-slate-200 bg-white rounded-xl text-slate-600 hover:bg-slate-50 transition"
            >
              スキップ
            </button>
            <button
              onClick={handleRecord}
              disabled={recording || !template}
              className="flex-[2] py-3 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-medium transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {recording ? '記録中...' : '記録して次へ →'}
            </button>
          </div>

          {/* 割り当てリスト */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <p className="text-xs text-slate-400 px-4 py-2 bg-slate-50 border-b border-slate-100">
              今回の割り当て（あなた専用・ほかの人には表示されません）
            </p>
            <div className="max-h-64 overflow-y-auto">
              {targets.map((t, i) => {
                const isDone = doneIds.includes(t.companyId)
                const isSkipped = skippedIds.includes(t.companyId)
                const isCurrent = i === index
                return (
                  <div
                    key={t.companyId}
                    className={`flex items-center gap-2 px-4 py-2 border-b border-slate-50 last:border-0 ${
                      isCurrent ? 'bg-orange-50 border-l-2 border-l-orange-400' : isDone ? 'bg-green-50/50' : ''
                    }`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      isDone ? 'bg-green-400' : isSkipped ? 'bg-slate-300' : isCurrent ? 'bg-orange-400' : 'bg-slate-200'
                    }`} />
                    <p className={`text-xs truncate flex-1 ${isDone ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                      {t.companyName}
                    </p>
                    <span className="text-[11px] text-slate-400 shrink-0">{t.salesRepName}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
