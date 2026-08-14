import { isSessionAuthorized } from '@/lib/auth';
import { MIN_WRAP_PASSPHRASE_LENGTH } from '@/lib/crypto/constants';
import {
  acknowledgeAgeKeyExport,
  addRecoveryRecipient,
  clearEncryptionKeys,
  createAgeKey,
  deleteAgeKey,
  deleteRecoveryRecipient,
  getAgeKeyById,
  getEncryptionKeyStatus,
  importAgeKey,
  setActiveAgeKey,
  setAgeKeyStatus,
  updateAgeKeyLabel,
} from '@/lib/crypto/keys';
import { encryptWithPassphrase } from '@/lib/crypto/age';
import {
  requireVaultStepUp,
  vaultActionRequiresStepUp,
  VaultStepUpError,
} from '@/lib/crypto/vault-step-up';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/** Cookie session only — API tokens cannot read or mutate the age vault. */
async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'));
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage encryption keys' },
      { status: 401 }
    );
  }
  return null;
}

/** GET /api/encryption — vault status (never returns private keys / identities) */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    const status = await getEncryptionKeyStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Failed to load encryption status:', error);
    return NextResponse.json({ error: 'Failed to load encryption status' }, { status: 500 });
  }
}

const vaultStepUpFields = {
  currentPassword: z.string().optional(),
  stepUpToken: z.string().min(20).optional(),
};

const postSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate'),
    label: z.string().optional(),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('import'),
    identity: z.string().min(20, 'Identity is required'),
    label: z.string().optional(),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('reveal'),
    keyId: z.string().min(1),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('exportPassphrase'),
    keyId: z.string().min(1),
    passphrase: z
      .string()
      .min(
        MIN_WRAP_PASSPHRASE_LENGTH,
        `Passphrase must be at least ${MIN_WRAP_PASSPHRASE_LENGTH} characters`
      ),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('acknowledgeExport'),
    keyId: z.string().min(1),
  }),
  z.object({
    action: z.literal('setActive'),
    keyId: z.string().min(1),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('setStatus'),
    keyId: z.string().min(1),
    status: z.enum(['retired', 'compromised']),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('updateLabel'),
    keyId: z.string().min(1),
    label: z.string().min(1),
  }),
  z.object({
    action: z.literal('deleteKey'),
    keyId: z.string().min(1),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('addRecovery'),
    label: z.string().optional(),
    recipient: z.string().min(10),
    ...vaultStepUpFields,
  }),
  z.object({
    action: z.literal('deleteRecovery'),
    id: z.string().min(1),
    ...vaultStepUpFields,
  }),
  z.object({ action: z.literal('clear'), ...vaultStepUpFields }),
]);

type EncryptionPostBody = z.infer<typeof postSchema>

function isSensitiveVaultBody(
  body: EncryptionPostBody
): body is EncryptionPostBody & {
  currentPassword?: string
  stepUpToken?: string
} {
  return vaultActionRequiresStepUp(body.action)
}

/**
 * POST /api/encryption — vault CRUD and export helpers
 */
export async function POST(request: NextRequest) {
  const denied = await requireSession(request);
  if (denied) return denied;

  try {
    const body = postSchema.parse(await request.json());

    if (isSensitiveVaultBody(body)) {
      await requireVaultStepUp({
        currentPassword: body.currentPassword,
        stepUpToken: body.stepUpToken,
      }, request.headers.get('cookie'));
    }

    if (body.action === 'generate') {
      const created = await createAgeKey({ label: body.label });
      return NextResponse.json(
        {
          id: created.id,
          label: created.label,
          recipient: created.recipient,
          identity: created.identity,
        },
        { status: 201 }
      );
    }

    if (body.action === 'import') {
      const imported = await importAgeKey(body.identity, { label: body.label });
      return NextResponse.json({
        id: imported.id,
        label: imported.label,
        recipient: imported.recipient,
        identity: imported.identity,
      });
    }

    if (body.action === 'reveal') {
      const row = await getAgeKeyById(body.keyId);
      if (!row) {
        return NextResponse.json({ error: 'Key not found' }, { status: 404 });
      }
      return NextResponse.json({
        id: row.id,
        label: row.label,
        recipient: row.recipient,
        identity: row.identity,
      });
    }

    if (body.action === 'exportPassphrase') {
      const row = await getAgeKeyById(body.keyId);
      if (!row) {
        return NextResponse.json({ error: 'Key not found' }, { status: 404 });
      }
      const armored = await encryptWithPassphrase(row.identity, body.passphrase);
      return NextResponse.json({
        id: row.id,
        filename: `${row.label.replace(/[^\w.-]+/g, '_') || 'age-key'}.age`,
        armored,
      });
    }

    if (body.action === 'acknowledgeExport') {
      const key = await acknowledgeAgeKeyExport(body.keyId);
      return NextResponse.json({ key });
    }

    if (body.action === 'setActive') {
      const key = await setActiveAgeKey(body.keyId);
      return NextResponse.json({ key });
    }

    if (body.action === 'setStatus') {
      const key = await setAgeKeyStatus(body.keyId, body.status);
      return NextResponse.json({ key });
    }

    if (body.action === 'updateLabel') {
      const key = await updateAgeKeyLabel(body.keyId, body.label);
      return NextResponse.json({ key });
    }

    if (body.action === 'deleteKey') {
      await deleteAgeKey(body.keyId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'addRecovery') {
      const recipient = await addRecoveryRecipient({
        label: body.label || 'Recovery key',
        recipient: body.recipient,
      });
      return NextResponse.json({ recipient }, { status: 201 });
    }

    if (body.action === 'deleteRecovery') {
      await deleteRecoveryRecipient(body.id);
      return NextResponse.json({ ok: true });
    }

    await clearEncryptionKeys();
    return NextResponse.json({ configured: false, recipient: null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof VaultStepUpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Encryption key action failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update encryption keys' },
      { status: 400 }
    );
  }
}
