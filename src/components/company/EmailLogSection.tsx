'use client'

import { useState } from 'react'
import { Mail, Send, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { CompanyEmail, EmailLog } from '@/types'
import { formatDateTime } from '@/lib/formatDateTime'
import { INPUT_CLASS } from '@/lib/formStyles'

type Props = {
  companyId: string
  companyEmails: CompanyEmail[]
  logs: EmailLog[]
  isBanned: boolean
  /** この顧客に紐づいている提案商材（保存済みのもの） */
  companyProducts: { id: string; name: string }[]
  /** 商材の初期値。持ち商材が複数でも今月の目標から1つに決まればそれが入る */
  autoProductId: string | null
  /** 「フォーム送信を記録」ボタン。ステータス自動変更を伴うため親が持つ */
  formLogging: boolean
  onFormLog: (proposalProductId: string | null) => void
  onRefresh: () => void
  onError: (message: string) => void
}

export default function EmailLogSection({
  companyId, companyEmails, logs, isBanned, companyProducts, autoProductId,
  formLogging, onFormLog, onRefresh, onError,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [toEmail, setToEmail] = useState('')
  const [toId, setToId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // どの商材として実績に数えるか。'' は「商材なし（集計に乗らない）」
  const [productId, setProductId] = useState('')

  // 顧客の読み込みは非同期なので、初期値が決まった時点で入れ直す。
  // 手で選び直したあとに上書きしないよう、自動判定の結果が変わったときだけ追従する
  const [syncedAuto, setSyncedAuto] = useState<string | null | undefined>(undefined)
  if (syncedAuto !== autoProductId) {
    setSyncedAuto(autoProductId)
    setProductId(autoProductId ?? '')
  }

  // 持ち商材が1つなら迷う余地がないので選択欄は出さない
  const showProductPicker = companyProducts.length >= 2

  const handleSend = async () => {
    if (!toEmail || !subject || !body) return
    setSending(true)
    setError(null)
    const res = await fetch('/api/gmail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyId, companyEmailId: toId || null, toEmail, subject, body,
        proposalProductId: productId || null,
      }),
    })
    const data = await res.json()
    if (data.error) {
      setError(data.error)
    } else {
      setShowForm(false)
      setSubject('')
      setBody('')
      onRefresh()
    }
    setSending(false)
  }

  const handleDeleteFormLog = async (logId: string) => {
    if (!confirm('このフォーム送信記録を削除しますか？')) return
    const { error: delErr } = await supabase.from('email_logs').delete().eq('id', logId)
    if (delErr) {
      onError(`記録の削除に失敗しました：${delErr.message}`)
      return
    }
    onRefresh()
  }

  return (
    <div className="premium-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <Mail size={13} />メール履歴
        </h2>
        <div className="flex items-center gap-2">
          {showProductPicker && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              実績商材
              <select
                value={productId}
                onChange={e => setProductId(e.target.value)}
                title="この送信をどの商材の実績として数えるか。メール送信とフォーム送信の両方に使う"
                className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="">商材なし</option>
                {companyProducts.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          )}
          <button
            onClick={() => onFormLog(productId || null)}
            disabled={formLogging}
            className="tap-target flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition disabled:opacity-50"
          >
            {formLogging ? '記録中...' : '+ フォーム送信を記録'}
          </button>
          {companyEmails.length > 0 && (
            isBanned ? (
              <span className="text-xs text-red-400 bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg">送信禁止</span>
            ) : (
              <button
                onClick={() => {
                  setToEmail(companyEmails[0].email)
                  setToId(companyEmails[0].id)
                  setShowForm(!showForm)
                  setError(null)
                }}
                className="tap-target flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-300 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
              >
                <Send size={11} />メール送信
              </button>
            )
          )}
        </div>
      </div>

      {showForm && (
        <div className="mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">宛先</label>
            <select
              value={toId}
              onChange={e => {
                setToId(e.target.value)
                const found = companyEmails.find(em => em.id === e.target.value)
                if (found) setToEmail(found.email)
              }}
              className={INPUT_CLASS}
            >
              {companyEmails.map(em => (
                <option key={em.id} value={em.id}>{em.email}{em.label ? ` (${em.label})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">件名</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">本文</label>
            <textarea rows={6} value={body} onChange={e => setBody(e.target.value)} className={INPUT_CLASS + ' resize-none'} />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSend}
              disabled={sending || !subject || !body}
              className="tap-target flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
            >
              <Send size={13} />{sending ? '送信中...' : '送信する'}
            </button>
            <button onClick={() => setShowForm(false)} className="tap-target px-4 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg transition">
              キャンセル
            </button>
          </div>
        </div>
      )}

      {logs.length === 0 ? (
        <p className="text-sm text-slate-400">メール履歴はありません</p>
      ) : (
        <div className="space-y-2">
          {logs.map(log => (
            <div key={log.id} className="border border-slate-100 rounded-xl p-3 hover:bg-slate-50/50 transition">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-slate-800 truncate">{log.subject || '（件名なし）'}</span>
                  {/* どの商材の実績として送ったか。null のログは集計・KPIに乗らないので、
                      黙って空欄にせず「商材なし」と出して気づけるようにする */}
                  {log.proposal_products?.name ? (
                    <span className="shrink-0 text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-md">{log.proposal_products.name}</span>
                  ) : (
                    <span className="shrink-0 text-xs bg-slate-50 text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded-md">商材なし</span>
                  )}
                  {log.send_type === 'form' && (
                    <span className="shrink-0 text-xs bg-orange-50 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-md">フォーム</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-400">{formatDateTime(log.sent_at)}</span>
                  {log.send_type === 'form' && (
                    <button
                      onClick={() => handleDeleteFormLog(log.id)}
                      className="text-slate-300 hover:text-red-500 transition"
                      title="削除"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              {log.company_emails?.email && (
                <p className="text-xs text-slate-400 mb-0.5">宛先: {log.company_emails.email}</p>
              )}
              {log.sent_by && <p className="text-xs text-slate-400">送信者: {log.sent_by}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
