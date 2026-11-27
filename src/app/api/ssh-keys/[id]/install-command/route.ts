import { db } from '@/lib/db';
import { sshKeys } from '@/lib/db/schema';
import {
  buildAuthorizedKeysInstallCommand,
  derivePublicKeyFromPrivate,
} from '@/lib/ssh/generate-key';
import { validatePrivateKeyMaterial } from '@/lib/ssh/key-validate';
import { eq } from 'drizzle-orm';
import { promises as fs } from 'fs';
import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/ssh-keys/:id/install-command
 * Re-derive the public key and return a paste-on-host authorized_keys install command.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const key = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, id),
    });

    if (!key) {
      return NextResponse.json({ error: 'SSH key not found' }, { status: 404 });
    }

    let privateKey = key.privateKeyContent?.trim() || '';
    if (!privateKey && key.privateKeyPath) {
      try {
        privateKey = (await fs.readFile(key.privateKeyPath, 'utf8')).trim();
      } catch {
        return NextResponse.json(
          { error: 'Failed to read private key file for this SSH key' },
          { status: 400 }
        );
      }
    }

    if (!privateKey) {
      return NextResponse.json(
        {
          error:
            'This key has no private key content — cannot build an install command',
        },
        { status: 400 }
      );
    }

    // A row saved before write-time validation may hold junk; report it as a
    // client error instead of letting ssh-keygen throw a 500.
    const keyCheck = validatePrivateKeyMaterial(privateKey);
    if (!keyCheck.ok) {
      return NextResponse.json(
        {
          error: 'Saved SSH key could not be parsed — re-add it',
          details: [{ path: ['privateKeyContent'], message: keyCheck.message }],
        },
        { status: 400 }
      );
    }

    const publicKey = await derivePublicKeyFromPrivate(privateKey);

    return NextResponse.json({
      id: key.id,
      name: key.name,
      publicKey,
      installCommand: buildAuthorizedKeysInstallCommand(publicKey),
    });
  } catch (error) {
    console.error('Failed to build install command:', error);
    return NextResponse.json(
      { error: 'Failed to build install command' },
      { status: 500 }
    );
  }
}
