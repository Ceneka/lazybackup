import { isSessionAuthorized } from '@/lib/auth'
import { getAppUpdateInfo } from '@/lib/version/check-update'
import { NextRequest, NextResponse } from 'next/server'

/** Cookie session only — do not fold into GET /api/settings (Bearer can read that). */
async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'))
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to check for updates' },
      { status: 401 }
    )
  }
  return null
}

/** GET /api/version — running version vs latest GitHub release (cached ~24h). */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied

  try {
    const info = await getAppUpdateInfo()
    return NextResponse.json(info, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Failed to check app version:', error)
    const { APP_VERSION } = await import('@/lib/app-version')
    return NextResponse.json({
      current: APP_VERSION,
      latest: null,
      htmlUrl: null,
      updateAvailable: false,
      status: 'unknown',
      checkedAt: new Date().toISOString(),
    })
  }
}
