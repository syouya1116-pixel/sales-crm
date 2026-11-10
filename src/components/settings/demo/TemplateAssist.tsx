'use client'

import { applyVariables, type TemplateVars } from '@/lib/emailVariables'

// 6. テンプレート編集の補助：差し込み変数のボタンと、架空の顧客で差し込んだプレビュー
const VARIABLES = ['{{会社名}}', '{{代表者名}}', '{{サービス名}}', '{{ジャンル名}}', '{{担当者名}}']

const SAMPLE: TemplateVars = {
  companyName: '株式会社サンプル商事',
  representativeName: '田中 花子',
  serviceName: 'サンプル美容室 渋谷店',
  genreName: '美容室',
  salesRepName: '山田 太郎',
}

export default function TemplateAssist({ subject, body, onInsert }: {
  subject: string
  body: string
  /** 本文の末尾に差し込み変数を足す */
  onInsert: (variable: string) => void
}) {
  return (
    <div className="space-y-2">
      <div>
        <span className="block text-[11px] text-slate-400 mb-1">差し込み変数（タップで本文に追加）</span>
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map(v => (
            <button key={v} type="button" onClick={() => onInsert(v)} className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-md px-2 py-1 hover:bg-blue-100">
              {v}
            </button>
          ))}
        </div>
      </div>
      {(subject || body) && (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <span className="block text-[11px] text-slate-400 mb-1.5">プレビュー（{SAMPLE.companyName} に送る場合）</span>
          <p className="text-sm font-medium text-slate-800 break-words">{applyVariables(subject, SAMPLE) || '（件名なし）'}</p>
          <p className="text-xs text-slate-600 whitespace-pre-wrap break-words mt-1.5 leading-relaxed">{applyVariables(body, SAMPLE)}</p>
        </div>
      )}
    </div>
  )
}
