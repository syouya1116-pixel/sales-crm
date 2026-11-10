'use client'

// レイアウト自体が壊れたときの最終的な受け皿。
// ここは <html> / <body> から自前で描画する必要があり、globals.css も読み込まれない。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: 'sans-serif', background: '#f8fafc' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              width: '100%',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '32px',
              textAlign: 'center',
            }}
          >
            <h1 style={{ fontSize: '17px', color: '#1e293b', margin: '0 0 12px' }}>
              システムエラーが発生しました
            </h1>
            <p style={{ fontSize: '14px', color: '#64748b', lineHeight: 1.7, margin: '0 0 20px' }}>
              画面を表示できませんでした。
              <br />
              再読み込みしても直らない場合は連絡してください。
            </p>
            <p style={{ fontSize: '12px', color: '#94a3b8', wordBreak: 'break-all', margin: '0 0 20px' }}>
              {error.message}
              {error.digest ? `（エラーID: ${error.digest}）` : ''}
            </p>
            <button
              onClick={reset}
              style={{
                background: '#4f46e5',
                color: '#fff',
                border: 'none',
                fontSize: '14px',
                padding: '10px 20px',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              再読み込み
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
