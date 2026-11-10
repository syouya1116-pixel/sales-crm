'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { Upload, ArrowLeft, CheckCircle, AlertCircle, RotateCcw, Square } from 'lucide-react'

const COLUMN_MAP: Record<string, string> = {
  'URL': 'url',
  'ステータス': 'status',
  '会社名': 'name',
  '代表者名': 'representative_name',
  'サービス名': 'service_name',
  '電話番号': 'phone',
  'メールアドレス': 'email',
  '送信日': 'sent_date',
  'ジャンル名': 'genre',
  'その他URL': 'other_url',
  'メモ': 'notes',
  '担当者': 'sales_rep',
  '住所': 'address',
  '提案商材': 'proposal_product',
}

// サーバー側は1バッチごとに重複チェック用のDB全件（約5万行）を読み直すため、
// バッチを小さくするとその読み直し回数がそのまま増える。
// 一方で1行ごとに最大6回DBへ書くので、500だとVercelの制限時間を超えて504になった（2026-10-19）。
// API側の maxDuration（60秒）に余裕で収まる100にしている。
const BATCH_SIZE = 100

// 中断した位置の保存先。3万件のインポートは数分かかるので、
// 画面を閉じた・リロードした・回線が切れたときに最初からやり直さずに済むようにする。
const PROGRESS_KEY = 'csvImportProgress'

type SkippedRow = { row: number; name: string; reason: string }

type SavedProgress = {
  fileName: string
  fileSize: number
  totalRows: number
  /** 次に送る行の位置（rows配列のインデックス）。ここまでは登録済み */
  nextIndex: number
  imported: number
  skipped: number
  skippedRows: SkippedRow[]
  savedAt: string
}

export default function ImportPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const [result, setResult] = useState<{ imported: number; skipped: number; skippedRows: SkippedRow[] } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<SavedProgress | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROGRESS_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR中は localStorage が無いため表示後に読む
      if (raw) setSaved(JSON.parse(raw) as SavedProgress)
    } catch {
      // 壊れた記録は無いものとして扱う
    }
  }, [])

  // インポート中の離脱を防ぐ（それでも閉じられた場合は保存済みの位置から再開できる）
  useEffect(() => {
    if (!importing) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [importing])

  const saveProgress = (p: SavedProgress) => {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(p))
    } catch {
      // スキップ明細が多いと容量制限に当たる。件数だけでも残す
      try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...p, skippedRows: [] }))
      } catch {
        // それでも保存できなければ再開はあきらめる（インポート自体は続行する）
      }
    }
    setSaved(p)
  }

  const clearProgress = () => {
    localStorage.removeItem(PROGRESS_KEY)
    setSaved(null)
  }

  const processFile = (file: File) => {
    setFileName(file.name)
    setFileSize(file.size)
    setResult(null)
    setError('')
    setNotice('')
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const mapped = (res.data as Record<string, string>[]).map(row => {
          const newRow: Record<string, string> = {}
          for (const [jp, en] of Object.entries(COLUMN_MAP)) {
            if (row[jp] !== undefined) newRow[en] = row[jp]
          }
          return newRow
        })
        setRows(mapped)
      },
    })
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    processFile(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.name.endsWith('.csv')) { setError('CSVファイルをドロップしてください'); return }
    processFile(file)
  }

  // 中断したときと同じCSVかどうか。別のファイルの続きから登録してしまう事故を防ぐ
  const isSameFile =
    !!saved &&
    rows.length > 0 &&
    saved.fileName === fileName &&
    saved.fileSize === fileSize &&
    saved.totalRows === rows.length

  const canResume = isSameFile && saved.nextIndex < rows.length

  const handleImport = async (from = 0, base = { imported: 0, skipped: 0, skippedRows: [] as SkippedRow[] }) => {
    if (!rows.length) return
    cancelRef.current = false
    setImporting(true)
    setProgress(from)
    setTotal(rows.length)
    setResult(null)
    setError('')
    setNotice('')

    let totalImported = base.imported
    let totalSkipped = base.skipped
    const skippedRowsAll: SkippedRow[] = [...base.skippedRows]
    let doneIndex = from

    const snapshot = (nextIndex: number): SavedProgress => ({
      fileName, fileSize, totalRows: rows.length, nextIndex,
      imported: totalImported, skipped: totalSkipped, skippedRows: skippedRowsAll,
      savedAt: new Date().toISOString(),
    })

    for (let i = from; i < rows.length; i += BATCH_SIZE) {
      if (cancelRef.current) {
        saveProgress(snapshot(doneIndex))
        setNotice(
          `${doneIndex.toLocaleString()}件目までで中断しました。` +
          `同じCSVを選び直せば続きから再開できます。`
        )
        setImporting(false)
        return
      }

      const batch = rows.slice(i, i + BATCH_SIZE)
      let res: Response
      try {
        res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch, startIndex: i }),
        })
      } catch {
        // 通信断。ここまでの位置を残して再開できるようにする
        saveProgress(snapshot(doneIndex))
        setError(
          `通信が切れてインポートが止まりました。\n` +
          `ここまでに ${totalImported.toLocaleString()} 件を登録済みです。` +
          `同じCSVを選び直すと ${(doneIndex + 1).toLocaleString()} 件目から再開できます。`
        )
        setImporting(false)
        return
      }

      if (!res.ok) {
        const detail = await res.json().catch(() => null)
        saveProgress(snapshot(doneIndex))
        setError(
          `${i + 2}行目付近でインポートが止まりました：${detail?.error || `HTTP ${res.status}`}\n` +
          `ここまでに ${totalImported.toLocaleString()} 件を登録済みです。` +
          `原因を直したあと、同じCSVを選び直すと ${(doneIndex + 1).toLocaleString()} 件目から再開できます。`
        )
        setImporting(false)
        return
      }

      const data = await res.json()
      totalImported += data.imported
      totalSkipped += data.skipped
      if (data.skippedRows) skippedRowsAll.push(...data.skippedRows)

      doneIndex = Math.min(i + BATCH_SIZE, rows.length)
      setProgress(doneIndex)
      saveProgress(snapshot(doneIndex))
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    clearProgress()
    setResult({ imported: totalImported, skipped: totalSkipped, skippedRows: skippedRowsAll })
    setImporting(false)
  }

  const handleResume = () => {
    if (!saved) return
    handleImport(saved.nextIndex, {
      imported: saved.imported,
      skipped: saved.skipped,
      skippedRows: saved.skippedRows,
    })
  }

  const handleRestart = () => {
    if (!confirm('最初からやり直します。登録済みの分は重複チェックでスキップされますが、時間がかかります。よろしいですか？')) return
    clearProgress()
    handleImport(0)
  }

  const percent = total > 0 ? Math.round((progress / total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4 px-4 sm:px-0">
          <button onClick={() => router.push('/')} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-xl font-bold text-gray-900">CSVインポート</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* 中断した記録 */}
        {saved && !importing && !result && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
            <div className="flex items-start gap-2">
              <RotateCcw size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">前回のインポートが途中で止まっています</p>
                <p className="text-xs text-amber-700 mt-1">
                  {saved.fileName}（{saved.totalRows.toLocaleString()}件中 {saved.nextIndex.toLocaleString()}件目まで完了・
                  登録 {saved.imported.toLocaleString()}件）
                </p>
                {!isSameFile && (
                  <p className="text-xs text-amber-600 mt-2">
                    続きから再開するには、同じCSVファイルをもう一度選んでください。
                  </p>
                )}
              </div>
              <button
                onClick={() => { if (confirm('中断の記録を破棄します。次回は最初からのインポートになります。よろしいですか？')) clearProgress() }}
                className="text-xs text-amber-600 hover:text-amber-800 underline shrink-0"
              >
                記録を破棄
              </button>
            </div>
          </div>
        )}

        {/* 対応列の説明 */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
          <p className="text-sm font-medium text-blue-800 mb-2">CSVの列名（スプシのヘッダーをこの名前にしてください）</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {Object.keys(COLUMN_MAP).map(col => (
              <span key={col} className="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded">{col}</span>
            ))}
          </div>
          <p className="text-xs text-blue-600 mt-3">※ 会社名は必須。他は空欄でもOK。スプシからCSVでダウンロードしてください。</p>
        </div>

        {/* ファイル選択 */}
        <div
          className={`bg-white border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-400'}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragEnter={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload size={32} className={`mx-auto mb-3 ${isDragging ? 'text-blue-400' : 'text-gray-300'}`} />
          {fileName ? (
            <p className="text-sm font-medium text-gray-700">{fileName}</p>
          ) : (
            <p className="text-sm text-gray-400">クリックまたはドラッグ&ドロップでCSVを選択</p>
          )}
          {rows.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">{rows.length.toLocaleString()}件読み込み済み</p>
          )}
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
        </div>

        {/* プレビュー */}
        {rows.length > 0 && !importing && !result && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-700 mb-3">プレビュー（先頭3件）</p>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead>
                  <tr className="bg-gray-50">
                    {Object.values(COLUMN_MAP).filter(k => rows[0]?.[k] !== undefined).map(k => (
                      <th key={k} className="px-2 py-1 text-left text-gray-500 font-medium">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      {Object.values(COLUMN_MAP).filter(k => rows[0]?.[k] !== undefined).map(k => (
                        <td key={k} className="px-2 py-1 text-gray-600 max-w-[120px] truncate">{row[k] || '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 進捗バー */}
        {importing && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-700">インポート中... {progress.toLocaleString()} / {total.toLocaleString()}件 ({percent}%)</p>
              <button
                onClick={() => { cancelRef.current = true }}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-200 rounded-lg px-3 py-1.5 transition"
              >
                <Square size={11} />中断する
              </button>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              進捗は自動保存されます。画面を閉じても同じCSVを選び直せば続きから再開できます。
            </p>
          </div>
        )}

        {/* 結果 */}
        {result && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={20} className="text-green-500" />
              <p className="text-sm font-semibold text-gray-700">インポート完了</p>
            </div>
            <p className="text-sm text-gray-600">成功: <span className="font-bold text-green-600">{result.imported.toLocaleString()}件</span></p>
            <p className="text-sm text-gray-600">スキップ: <span className="font-bold text-gray-400">{result.skipped.toLocaleString()}件</span></p>
            {result.skippedRows.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto border border-gray-100 rounded-lg">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">行番号</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">会社名</th>
                      <th className="px-3 py-1.5 text-left text-gray-500 font-medium">スキップ理由</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.skippedRows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 text-gray-500">{r.row}行目</td>
                        <td className="px-3 py-1.5 text-gray-700">{r.name}</td>
                        <td className="px-3 py-1.5 text-red-500">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={() => router.push('/')} className="mt-4 text-sm text-blue-600 hover:underline">
              顧客一覧を見る →
            </button>
          </div>
        )}

        {notice && (
          <div className="flex items-start gap-2 text-amber-700 text-sm bg-amber-50 border border-amber-200 rounded-xl p-4">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span className="whitespace-pre-line">{notice}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span className="whitespace-pre-line">{error}</span>
          </div>
        )}

        {/* インポートボタン */}
        {rows.length > 0 && !importing && !result && (
          canResume ? (
            <div className="space-y-2">
              <button
                onClick={handleResume}
                className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700 transition"
              >
                {(saved.nextIndex + 1).toLocaleString()}件目から再開する（残り {(rows.length - saved.nextIndex).toLocaleString()}件）
              </button>
              <button
                onClick={handleRestart}
                className="w-full text-gray-500 hover:text-gray-700 py-2 text-xs underline"
              >
                最初からやり直す
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleImport(0)}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-blue-700 transition"
            >
              {rows.length.toLocaleString()}件をインポートする
            </button>
          )
        )}
      </main>
    </div>
  )
}
