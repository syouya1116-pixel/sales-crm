'use client'

import { useEffect } from 'react'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import Link from 'next/link'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // redirect() が投げる例外をここで捕まえると画面遷移が止まるので必ず再throwする
  if (isRedirectError(error)) throw error

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="premium-card max-w-lg w-full p-8 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 text-red-500 mb-4">
          <AlertCircle size={22} />
        </div>
        <h1 className="text-lg font-semibold text-slate-800 mb-2">
          エラーが発生しました
        </h1>
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          画面の読み込み中に問題が起きました。
          <br />
          「再読み込み」で直らない場合は、この画面のまま連絡してください。
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 mb-6 text-left">
          <p className="text-xs text-slate-600 break-all">{error.message}</p>
          {error.digest && (
            <p className="text-xs text-slate-400 mt-1">エラーID: {error.digest}</p>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition"
          >
            <RefreshCw size={15} />
            再読み込み
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2.5 rounded-lg transition"
          >
            <Home size={15} />
            顧客一覧へ戻る
          </Link>
        </div>
      </div>
    </div>
  )
}
