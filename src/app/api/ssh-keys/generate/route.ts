import { db } from '@/lib/db';
import { sshKeys } from '@/lib/db/schema';
import {
  buildAuthorizedKeysInstallCommand,
  generateStoredEd25519KeyPair,
} from '@/lib/ssh/generate-key';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const generateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

/** POST /api/ssh-keys/generate — create an Ed25519 key and return a paste-on-host install command. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { name: requestedName } = generateSchema.parse(body);

    const id = nanoid();
    const name =
      requestedName?.trim() ||
      `LazyBackup ${new Date().toISOString().slice(0, 10)}`;

    const { privateKey, publicKey } = await generateStoredEd25519KeyPair(
      `lazybackup:${name}`
    );

    const newKey = {
      id,
      name,
      privateKeyContent: privateKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(sshKeys).values(newKey);

    return NextResponse.json(
      {
        id: newKey.id,
        name: newKey.name,
        publicKey,
        installCommand: buildAuthorizedKeysInstallCommand(publicKey),
        createdAt: newKey.createdAt,
        updatedAt: newKey.updatedAt,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to generate SSH key:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to generate SSH key' },
      { status: 500 }
    );
  }
}
