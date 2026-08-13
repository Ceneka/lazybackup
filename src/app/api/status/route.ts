import { isAuthorized } from '@/lib/auth'
import { loadOperatorStatus } from '@/lib/status/load-status'
import { NextRequest, NextResponse } from 'next/server'

/** GET /api/status — operator safety posture (session or API token). */
export async function GET(request: NextRequest) {
  const ok = await isAuthorized(
    request.headers.get('cookie'),
    request.headers.get('authorization')
  )
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await loadOperatorStatus()
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Failed to build status:', error)
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 })
  }
}
