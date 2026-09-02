import { isSessionAuthorized } from '@/lib/auth'
import { loadConfigExport } from '@/lib/settings/export-config'
import { NextRequest, NextResponse } from 'next/server'

/** Cookie session only — API tokens cannot download a config snapshot. */
async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'))
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to export configuration' },
      { status: 401 }
    )
  }
  return null
}

/** GET /api/settings/export — non-secret config.json (session only). */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied

  try {
    const snapshot = await loadConfigExport()
    const body = `${JSON.stringify(snapshot, null, 2)}\n`
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="lazybackup-config.json"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Failed to export config:', error)
    return NextResponse.json({ error: 'Failed to export configuration' }, { status: 500 })
  }
}
