'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { IS_DEMO, DEMO_ADMIN_EMAIL, DEMO_STAFF_LOGIN_ID, DEMO_STAFF_PASSWORD } from '@/lib/demo'
import { emailToName } from '@/lib/emailToName'
import { useSiteSettings } from '@/components/SiteSettingsProvider'

export default function LoginPage() {
  const [mode, setMode] = useState<'admin' | 'staff'>('admin')
  const { settings } = useSiteSettings()

  // 管理者(Google)用：サイトパスワード確認
  const [password, setPassword] = useState('')
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // スタッフ用：ID/パスワード
  const [loginId, setLoginId] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [staffError, setStaffError] = useState('')
  const [staffLoading, setStaffLoading] = useState(false)

  // デモ：ワンクリックでログイン
  const [demoLoading, setDemoLoading] = useState<'' | 'admin' | 'staff'>('')
  const handleDemoAdmin = async () => {
    setDemoLoading('admin')
    await signIn('demo', { callbackUrl: '/' })
  }
  const handleDemoStaff = async () => {
    setDemoLoading('staff')
    const res = await signIn('staff', { loginId: DEMO_STAFF_LOGIN_ID, password: DEMO_STAFF_PASSWORD, redirect: false })
    if (res?.error) {
      setStaffError('デモ用スタッフでログインできませんでした。時間をおいてお試しください')
      setDemoLoading('')
    } else {
      window.location.href = '/staff'
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) setVerified(true)
    else setError(res.status === 429 ? '試行回数が多すぎます。しばらくしてからお試しください' : 'パスワードが違います')
    setLoading(false)
  }

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setStaffLoading(true)
    setStaffError('')
    const res = await signIn('staff', {
      loginId: loginId.trim(),
      password: staffPassword,
      redirect: false,
    })
    if (res?.error) {
      setStaffError('ログインIDまたはパスワードが違います')
      setStaffLoading(false)
    } else {
      window.location.href = '/staff'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center shadow-sm w-full max-w-sm">
        {IS_DEMO && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={settings.logoDataUrl || '/logo.svg'} alt="ロゴ" className="w-12 h-12 mx-auto mb-3 rounded-xl object-contain" />
        )}
        <h1 className="text-2xl font-bold text-gray-900 mb-2 break-words">{IS_DEMO ? settings.companyName : 'さんぷる'}</h1>
        <p className="text-sm text-gray-500 mb-8">{IS_DEMO ? settings.systemName : 'メール管理システム'}</p>

        {IS_DEMO ? (
          <div className="space-y-3 text-left">
            <p className="text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
              デモ環境です。会社・人物・連絡先はすべて架空のデータで、毎日初期化されます。メールの送信やカレンダー登録は実際には行われません。
            </p>
            <button
              onClick={handleDemoAdmin}
              disabled={!!demoLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-3 text-sm font-medium transition disabled:opacity-50"
            >
              {demoLoading === 'admin' ? 'ログイン中...' : `管理者としてログイン（${emailToName(DEMO_ADMIN_EMAIL)}）`}
            </button>
            <button
              onClick={handleDemoStaff}
              disabled={!!demoLoading}
              className="w-full border border-indigo-200 text-indigo-700 hover:bg-indigo-50 rounded-lg px-4 py-3 text-sm font-medium transition disabled:opacity-50"
            >
              {demoLoading === 'staff' ? 'ログイン中...' : '業務委託スタッフとしてログイン'}
            </button>
            {staffError && <p className="text-xs text-red-500">{staffError}</p>}
            <p className="text-[11px] text-gray-400 leading-relaxed pt-1">
              本番では、管理者は合言葉＋Googleアカウント、スタッフは発行したIDとパスワードでログインします。
            </p>
          </div>
        ) : mode === 'admin' ? (
          <>
            {!verified ? (
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="text-left">
                  <label className="block text-xs text-gray-500 mb-1">アクセスパスワード</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="パスワードを入力"
                    autoFocus
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {error && <p className="text-xs text-red-500 text-left">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || !password}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50"
                >
                  {loading ? '確認中...' : '確認'}
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2">✓ 認証完了。Googleアカウントでログインしてください。</p>
                <button
                  onClick={() => signIn('google', { callbackUrl: '/' })}
                  className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-lg px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18">
                    <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                    <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                    <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                    <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
                  </svg>
                  Googleでログイン
                </button>
              </div>
            )}
            <button
              onClick={() => setMode('staff')}
              className="mt-6 text-xs text-gray-400 hover:text-gray-600 underline transition"
            >
              業務委託スタッフの方はこちら
            </button>
          </>
        ) : (
          <>
            <form onSubmit={handleStaffLogin} className="space-y-4">
              <div className="text-left">
                <label className="block text-xs text-gray-500 mb-1">ログインID</label>
                <input
                  type="text"
                  value={loginId}
                  onChange={e => setLoginId(e.target.value)}
                  placeholder="発行されたID"
                  autoFocus
                  autoCapitalize="none"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="text-left">
                <label className="block text-xs text-gray-500 mb-1">パスワード</label>
                <input
                  type="password"
                  value={staffPassword}
                  onChange={e => setStaffPassword(e.target.value)}
                  placeholder="パスワード"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {staffError && <p className="text-xs text-red-500 text-left">{staffError}</p>}
              <button
                type="submit"
                disabled={staffLoading || !loginId || !staffPassword}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50"
              >
                {staffLoading ? 'ログイン中...' : 'ログイン'}
              </button>
            </form>
            <button
              onClick={() => setMode('admin')}
              className="mt-6 text-xs text-gray-400 hover:text-gray-600 underline transition"
            >
              ← 管理者ログインに戻る
            </button>
          </>
        )}
      </div>
    </div>
  )
}
