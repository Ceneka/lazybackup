export const APP_PASSWORD_HASH_KEY = 'appPasswordHash'
export const SESSION_SECRET_KEY = 'sessionSecret'
export const SESSION_EPOCH_KEY = 'sessionEpoch'
export const AUTH_SETUP_COMPLETED_KEY = 'authSetupCompleted'

export const SESSION_COOKIE_NAME = 'lb_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days
/** Only reissue the sliding cookie after the token is at least this old. */
export const SESSION_REFRESH_AFTER_SECONDS = 60 * 60 * 24 // 1 day

/** Settings keys that must never be returned by GET /api/settings */
export const SENSITIVE_SETTING_KEYS = [
  APP_PASSWORD_HASH_KEY,
  SESSION_SECRET_KEY,
  SESSION_EPOCH_KEY,
  'ageIdentity',
] as const

export const MIN_PASSWORD_LENGTH = 12
