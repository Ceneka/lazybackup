import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import {
  generateAgeKeyPair,
  type AgeKeyPair,
} from '@/lib/crypto/age';

export const AGE_IDENTITY_KEY = 'ageIdentity';
export const AGE_RECIPIENT_KEY = 'ageRecipient';

async function getSettingValue(key: string): Promise<string | null> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  return row?.value ?? null;
}

async function setSettingValue(key: string, value: string): Promise<void> {
  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  if (existing) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.key, key));
    return;
  }
  await db.insert(settings).values({
    id: nanoid(),
    key,
    value,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function deleteSettingValue(key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export type EncryptionKeyStatus = {
  configured: boolean;
  recipient: string | null;
};

export async function getEncryptionKeyStatus(): Promise<EncryptionKeyStatus> {
  const recipient = await getSettingValue(AGE_RECIPIENT_KEY);
  const identity = await getSettingValue(AGE_IDENTITY_KEY);
  return {
    configured: Boolean(recipient?.trim() && identity?.trim()),
    recipient: recipient?.trim() || null,
  };
}

export async function getAgeRecipient(): Promise<string | null> {
  const value = await getSettingValue(AGE_RECIPIENT_KEY);
  return value?.trim() || null;
}

export async function getAgeIdentity(): Promise<string | null> {
  const value = await getSettingValue(AGE_IDENTITY_KEY);
  return value?.trim() || null;
}

export async function requireAgeRecipient(): Promise<string> {
  const recipient = await getAgeRecipient();
  if (!recipient) {
    throw new Error(
      'Encryption is enabled but no age key is configured. Generate a key in Settings → Encryption.'
    );
  }
  return recipient;
}

export async function requireAgeIdentity(): Promise<string> {
  const identity = await getAgeIdentity();
  if (!identity) {
    throw new Error(
      'Cannot decrypt: age private key is missing. Restore the key from Settings → Encryption.'
    );
  }
  return identity;
}

/** Create a new identity/recipient pair and persist it. Returns public recipient + private identity once. */
export async function createEncryptionKeys(): Promise<AgeKeyPair> {
  const pair = await generateAgeKeyPair();
  await setSettingValue(AGE_IDENTITY_KEY, pair.identity);
  await setSettingValue(AGE_RECIPIENT_KEY, pair.recipient);
  return pair;
}

/** Import an existing age identity (AGE-SECRET-KEY-1...). Derives and stores recipient. */
export async function importEncryptionIdentity(identity: string): Promise<AgeKeyPair> {
  const trimmed = identity.trim();
  if (!trimmed.startsWith('AGE-SECRET-KEY-')) {
    throw new Error('Identity must start with AGE-SECRET-KEY-');
  }
  const age = await import('age-encryption');
  const recipient = await age.identityToRecipient(trimmed);
  await setSettingValue(AGE_IDENTITY_KEY, trimmed);
  await setSettingValue(AGE_RECIPIENT_KEY, recipient);
  return { identity: trimmed, recipient };
}

export async function clearEncryptionKeys(): Promise<void> {
  await deleteSettingValue(AGE_IDENTITY_KEY);
  await deleteSettingValue(AGE_RECIPIENT_KEY);
}
