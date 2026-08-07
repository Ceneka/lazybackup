import { eq } from 'drizzle-orm'
import { DEFAULT_TIMEZONE, isValidTimezone } from '../cron/format'
import { db } from '../db'
import { settings } from '../db/schema'

const TIMEZONE_SETTING_KEY = 'timezone'

let cachedTimezone: string | null = null

export function clearTimezoneCache() {
  cachedTimezone = null
}

export async function getAppTimezone(): Promise<string> {
  if (cachedTimezone && isValidTimezone(cachedTimezone)) {
    return cachedTimezone
  }

  try {
    const row = await db.query.settings.findFirst({
      where: eq(settings.key, TIMEZONE_SETTING_KEY),
    })
    const value = row?.value?.trim()
    if (value && isValidTimezone(value)) {
      cachedTimezone = value
      return value
    }
  } catch (error) {
    console.error('Failed to read timezone setting:', error)
  }

  cachedTimezone = DEFAULT_TIMEZONE
  return DEFAULT_TIMEZONE
}

export { TIMEZONE_SETTING_KEY }
