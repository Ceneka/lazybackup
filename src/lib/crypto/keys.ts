import { desc, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/lib/db';
import { ageKeys, ageRecoveryRecipients } from '@/lib/db/schema';
import { assertAgeRecipient, generateAgeKeyPair, type AgeKeyPair } from '@/lib/crypto/age';

export type AgeKeyStatus = 'active' | 'retired' | 'compromised';

export type PublicAgeKey = {
  id: string;
  label: string;
  recipient: string;
  status: AgeKeyStatus;
  exportAcknowledgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicRecoveryRecipient = {
  id: string;
  label: string;
  recipient: string;
  createdAt: Date;
};

export type EncryptionKeyStatus = {
  configured: boolean;
  recipient: string | null;
  activeKeyId: string | null;
  keys: PublicAgeKey[];
  recoveryRecipients: PublicRecoveryRecipient[];
  /** True when active key exists but operator has not acknowledged export */
  needsExportAck: boolean;
  /** True when any backup uses encryption or peer dest */
  encryptionInUse: boolean;
};

function toPublicKey(row: typeof ageKeys.$inferSelect): PublicAgeKey {
  return {
    id: row.id,
    label: row.label,
    recipient: row.recipient,
    status: row.status as AgeKeyStatus,
    exportAcknowledgedAt: row.exportAcknowledgedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPublicRecovery(
  row: typeof ageRecoveryRecipients.$inferSelect
): PublicRecoveryRecipient {
  return {
    id: row.id,
    label: row.label,
    recipient: row.recipient,
    createdAt: row.createdAt,
  };
}

export async function listAgeKeys(): Promise<PublicAgeKey[]> {
  const rows = await db.query.ageKeys.findMany({
    orderBy: [desc(ageKeys.createdAt)],
  });
  return rows.map(toPublicKey);
}

export async function listRecoveryRecipients(): Promise<PublicRecoveryRecipient[]> {
  const rows = await db.query.ageRecoveryRecipients.findMany({
    orderBy: [desc(ageRecoveryRecipients.createdAt)],
  });
  return rows.map(toPublicRecovery);
}

export async function getActiveAgeKey(): Promise<(typeof ageKeys.$inferSelect) | null> {
  return (
    (await db.query.ageKeys.findFirst({
      where: eq(ageKeys.status, 'active'),
    })) ?? null
  );
}

export async function encryptionInUse(): Promise<boolean> {
  const rows = await db.query.backupConfigs.findMany({
    columns: { enableEncryption: true, destinationKind: true },
  });
  return rows.some((r) => r.enableEncryption || r.destinationKind === 'peer');
}

export async function getEncryptionKeyStatus(): Promise<EncryptionKeyStatus> {
  const keys = await listAgeKeys();
  const recoveryRecipients = await listRecoveryRecipients();
  const active = keys.find((k) => k.status === 'active') ?? null;
  const inUse = await encryptionInUse();
  return {
    configured: Boolean(active),
    recipient: active?.recipient ?? null,
    activeKeyId: active?.id ?? null,
    keys,
    recoveryRecipients,
    needsExportAck: Boolean(active && !active.exportAcknowledgedAt && inUse),
    encryptionInUse: inUse,
  };
}

/** @deprecated prefer requireEncryptRecipients — kept for callers expecting a single recipient */
export async function getAgeRecipient(): Promise<string | null> {
  const active = await getActiveAgeKey();
  return active?.recipient ?? null;
}

/** @deprecated prefer requireDecryptIdentities */
export async function getAgeIdentity(): Promise<string | null> {
  const active = await getActiveAgeKey();
  return active?.identity ?? null;
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

/** Active recipient plus all recovery recipients for encrypt. */
export async function requireEncryptRecipients(): Promise<string[]> {
  const active = await getActiveAgeKey();
  if (!active) {
    throw new Error(
      'Encryption is enabled but no age key is configured. Generate a key in Settings → Encryption.'
    );
  }
  const recovery = await listRecoveryRecipients();
  return [active.recipient, ...recovery.map((r) => r.recipient)];
}

/** All stored identities (active, retired, compromised) for decrypt. */
export async function requireDecryptIdentities(): Promise<string[]> {
  const rows = await db.query.ageKeys.findMany();
  const identities = rows.map((r) => r.identity.trim()).filter(Boolean);
  if (identities.length === 0) {
    throw new Error(
      'Cannot decrypt: age private key is missing. Restore the key from Settings → Encryption.'
    );
  }
  return identities;
}

async function demoteActiveKeys(exceptId?: string): Promise<void> {
  const actives = await db.query.ageKeys.findMany({
    where: eq(ageKeys.status, 'active'),
  });
  for (const row of actives) {
    if (exceptId && row.id === exceptId) continue;
    await db
      .update(ageKeys)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(eq(ageKeys.id, row.id));
  }
}

/** Create a new identity/recipient; previous active becomes retired. */
export async function createAgeKey(options?: {
  label?: string;
}): Promise<AgeKeyPair & { id: string; label: string }> {
  const pair = await generateAgeKeyPair();
  await demoteActiveKeys();
  const id = nanoid();
  const label = options?.label?.trim() || `Key ${new Date().toISOString().slice(0, 10)}`;
  await db.insert(ageKeys).values({
    id,
    label,
    identity: pair.identity,
    recipient: pair.recipient,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { ...pair, id, label };
}

/** @deprecated use createAgeKey */
export async function createEncryptionKeys(): Promise<AgeKeyPair> {
  const created = await createAgeKey();
  return { identity: created.identity, recipient: created.recipient };
}

/** Import an existing age identity as the new active key (previous active → retired). */
export async function importAgeKey(
  identity: string,
  options?: { label?: string }
): Promise<AgeKeyPair & { id: string; label: string }> {
  const trimmed = identity.trim();
  if (!trimmed.startsWith('AGE-SECRET-KEY-')) {
    throw new Error('Identity must start with AGE-SECRET-KEY-');
  }
  const age = await import('age-encryption');
  const recipient = await age.identityToRecipient(trimmed);

  const duplicate = await db.query.ageKeys.findFirst({
    where: eq(ageKeys.recipient, recipient),
  });
  if (duplicate) {
    throw new Error('This key is already in the vault');
  }

  await demoteActiveKeys();
  const id = nanoid();
  const label = options?.label?.trim() || `Imported ${new Date().toISOString().slice(0, 10)}`;
  await db.insert(ageKeys).values({
    id,
    label,
    identity: trimmed,
    recipient,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return { identity: trimmed, recipient, id, label };
}

/** @deprecated use importAgeKey */
export async function importEncryptionIdentity(identity: string): Promise<AgeKeyPair> {
  const imported = await importAgeKey(identity);
  return { identity: imported.identity, recipient: imported.recipient };
}

export async function getAgeKeyById(id: string) {
  return (await db.query.ageKeys.findFirst({ where: eq(ageKeys.id, id) })) ?? null;
}

export async function setActiveAgeKey(id: string): Promise<PublicAgeKey> {
  const row = await getAgeKeyById(id);
  if (!row) throw new Error('Key not found');
  await demoteActiveKeys(id);
  await db
    .update(ageKeys)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(ageKeys.id, id));
  const updated = await getAgeKeyById(id);
  return toPublicKey(updated!);
}

export async function setAgeKeyStatus(
  id: string,
  status: 'retired' | 'compromised'
): Promise<PublicAgeKey> {
  const row = await getAgeKeyById(id);
  if (!row) throw new Error('Key not found');
  if (row.status === 'active') {
    throw new Error('Set another key as active before marking this one retired or compromised');
  }
  await db
    .update(ageKeys)
    .set({ status, updatedAt: new Date() })
    .where(eq(ageKeys.id, id));
  const updated = await getAgeKeyById(id);
  return toPublicKey(updated!);
}

export async function updateAgeKeyLabel(id: string, label: string): Promise<PublicAgeKey> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Label is required');
  const row = await getAgeKeyById(id);
  if (!row) throw new Error('Key not found');
  await db
    .update(ageKeys)
    .set({ label: trimmed, updatedAt: new Date() })
    .where(eq(ageKeys.id, id));
  return toPublicKey((await getAgeKeyById(id))!);
}

export async function acknowledgeAgeKeyExport(id: string): Promise<PublicAgeKey> {
  const row = await getAgeKeyById(id);
  if (!row) throw new Error('Key not found');
  await db
    .update(ageKeys)
    .set({ exportAcknowledgedAt: new Date(), updatedAt: new Date() })
    .where(eq(ageKeys.id, id));
  return toPublicKey((await getAgeKeyById(id))!);
}

export async function deleteAgeKey(id: string): Promise<void> {
  const row = await getAgeKeyById(id);
  if (!row) throw new Error('Key not found');
  if (row.status === 'active') {
    const others = await db.query.ageKeys.findMany({
      where: ne(ageKeys.id, id),
    });
    if (others.length === 0) {
      const inUse = await encryptionInUse();
      if (inUse) {
        throw new Error(
          'Cannot delete the only age key while encrypted or Bro backups exist. Create or import another key first, or disable encryption.'
        );
      }
    } else {
      throw new Error('Set another key as active before deleting the active key');
    }
  }
  await db.delete(ageKeys).where(eq(ageKeys.id, id));
}

/** Delete all keys (legacy clear). Blocked when encryption in use. */
export async function clearEncryptionKeys(): Promise<void> {
  const inUse = await encryptionInUse();
  if (inUse) {
    throw new Error(
      'Cannot clear encryption keys while encrypted or Bro backups exist'
    );
  }
  await db.delete(ageKeys);
}

export async function addRecoveryRecipient(options: {
  label: string;
  recipient: string;
}): Promise<PublicRecoveryRecipient> {
  const recipient = assertAgeRecipient(options.recipient);
  const label = options.label.trim() || 'Recovery key';
  const duplicate = await db.query.ageRecoveryRecipients.findFirst({
    where: eq(ageRecoveryRecipients.recipient, recipient),
  });
  if (duplicate) {
    throw new Error('This recovery recipient is already configured');
  }
  const id = nanoid();
  await db.insert(ageRecoveryRecipients).values({
    id,
    label,
    recipient,
    createdAt: new Date(),
  });
  return toPublicRecovery((await db.query.ageRecoveryRecipients.findFirst({
    where: eq(ageRecoveryRecipients.id, id),
  }))!);
}

export async function deleteRecoveryRecipient(id: string): Promise<void> {
  await db.delete(ageRecoveryRecipients).where(eq(ageRecoveryRecipients.id, id));
}

/** All identities for instance export (includes secrets). */
export async function exportVaultSecrets(): Promise<{
  keys: Array<{
    id: string;
    label: string;
    identity: string;
    recipient: string;
    status: AgeKeyStatus;
  }>;
  recoveryRecipients: PublicRecoveryRecipient[];
}> {
  const rows = await db.query.ageKeys.findMany({
    orderBy: [desc(ageKeys.createdAt)],
  });
  const recoveryRecipients = await listRecoveryRecipients();
  return {
    keys: rows.map((r) => ({
      id: r.id,
      label: r.label,
      identity: r.identity,
      recipient: r.recipient,
      status: r.status as AgeKeyStatus,
    })),
    recoveryRecipients,
  };
}
