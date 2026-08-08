import { hash, verify } from '@node-rs/argon2'
import { MIN_PASSWORD_LENGTH } from './constants'

export function assertPasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  return null
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password)
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  try {
    return await verify(passwordHash, password)
  } catch {
    return false
  }
}
