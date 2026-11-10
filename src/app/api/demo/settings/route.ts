import { NextRequest, NextResponse } from 'next/server'
import { IS_DEMO } from '@/lib/demo'
import { requireAdmin } from '@/lib/requireAdmin'
import { normalizeSiteSettings } from '@/lib/siteSettings'
import { saveSiteSettings } from '@/lib/siteSettingsServer'

// デモの設定画面（CMS）の保存先。デモ以外では存在しない扱いにする
export async function PUT(req: NextRequest) {
  if (!IS_DEMO) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { error } = await requireAdmin()
  if (error) return error

  const body = await req.json().catch(() => null)
  const settings = normalizeSiteSettings(body)
  const { error: dbError } = await saveSiteSettings(settings)
  if (dbError) return NextResponse.json({ error: '保存に失敗しました' }, { status: 500 })
  return NextResponse.json({ settings })
}
