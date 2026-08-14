const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_CHALLENGES = 64

export type ChallengeKind = 'register' | 'login' | 'step-up'

type StoredChallenge = {
  kind: ChallengeKind
  expiresAt: number
}

const challenges = new Map<string, StoredChallenge>()

function pruneChallenges(now = Date.now()) {
  for (const [key, stored] of challenges) {
    if (stored.expiresAt <= now) challenges.delete(key)
  }
  while (challenges.size > MAX_CHALLENGES) {
    const oldest = challenges.keys().next().value
    if (oldest === undefined) break
    challenges.delete(oldest)
  }
}

function challengeFromClientDataJSON(clientDataJSON: string): string | null {
  try {
    const padded =
      clientDataJSON.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - (clientDataJSON.length % 4)) % 4)
    const json = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as {
      challenge?: unknown
    }
    return typeof json.challenge === 'string' ? json.challenge : null
  } catch {
    return null
  }
}

export function saveWebauthnChallenge(kind: ChallengeKind, challenge: string): void {
  pruneChallenges()
  challenges.set(challenge, {
    kind,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  })
}

export function takeWebauthnChallenge(
  kind: ChallengeKind,
  clientDataJSON: string
): string | null {
  pruneChallenges()
  const challenge = challengeFromClientDataJSON(clientDataJSON)
  if (!challenge) return null
  const stored = challenges.get(challenge)
  challenges.delete(challenge)
  if (!stored || stored.kind !== kind || Date.now() > stored.expiresAt) {
    return null
  }
  return challenge
}

export function resetWebauthnChallenges(): void {
  challenges.clear()
}

export function webauthnRpFromRequest(request: {
  headers: Headers
  nextUrl?: { protocol: string; host: string }
}): { rpID: string; origin: string } {
  const configured = process.env.AUTH_PUBLIC_URL?.trim()
  if (configured) {
    try {
      const url = new URL(configured)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return { rpID: url.hostname, origin: url.origin }
      }
    } catch {
      // fall through to Host
    }
  }

  const trustProxy = process.env.AUTH_TRUST_PROXY === 'true'
  const forwardedHost = trustProxy
    ? request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    : undefined
  const hostHeader = request.headers.get('host')?.trim()
  const host = forwardedHost || hostHeader || request.nextUrl?.host || 'localhost'
  const rpID = host.split(':')[0] || 'localhost'
  const forwardedProto = trustProxy
    ? request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    : undefined
  const proto =
    forwardedProto ||
    request.nextUrl?.protocol?.replace(':', '') ||
    (rpID === 'localhost' ? 'http' : 'https')
  return { rpID, origin: `${proto}://${host}` }
}

/** Refuse deleting the last authenticator unless a password still locks the instance. */
export function canDeletePasskey(currentCount: number, hasPassword: boolean): boolean {
  if (currentCount > 1) return true
  return hasPassword
}
