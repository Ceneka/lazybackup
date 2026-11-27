import { redactSshKey } from '@/lib/api/redact';
import { db } from '@/lib/db';
import { sshKeys } from '@/lib/db/schema';
import { findGitReposUsingSshKey, findServersUsingSshKey } from '@/lib/ssh/key-usage';
import {
  validatePrivateKeyMaterial,
  validatePrivateKeyPath,
  validateSshKeyMaterial,
} from '@/lib/ssh/key-validate';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// SSH key validation schema for updates
const sshKeyUpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  privateKeyPath: z.string().optional(),
  publicKeyPath: z.string().optional(),
  privateKeyContent: z.string().optional(),
});

/** 400 with a field path the form can highlight (same shape as Zod issues). */
function fieldError(field: string, message: string) {
  return NextResponse.json(
    { error: message, details: [{ path: [field], message }] },
    { status: 400 }
  );
}

// GET /api/ssh-keys/:id - Get SSH key by ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the SSH key
    const key = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, id),
    });

    if (!key) {
      return NextResponse.json(
        { error: 'SSH key not found' },
        { status: 404 }
      );
    }

    const allServers = await db.query.servers.findMany({
      columns: { id: true, name: true, sshKeyId: true },
    });
    const usedByServers = findServersUsingSshKey(allServers, id);
    const allGitRepos = await db.query.gitRepos.findMany({
      columns: { id: true, name: true, sshKeyId: true },
    });
    const usedByGitRepos = findGitReposUsingSshKey(allGitRepos, id);

    // Never return PEM material over the API; the UI only needs metadata and
    // `hasPrivateKeyContent`. Use the install-command endpoint for host setup.
    return NextResponse.json({
      ...redactSshKey(key as unknown as Record<string, unknown>),
      usedByServers,
      usedByGitRepos,
    });
  } catch (error) {
    console.error('Failed to fetch SSH key:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SSH key' },
      { status: 500 }
    );
  }
}

// PUT /api/ssh-keys/:id - Update SSH key
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate the request body
    const validatedData = sshKeyUpdateSchema.parse(body);

    const existingKey = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, id),
    });

    if (!existingKey) {
      return NextResponse.json(
        { error: 'SSH key not found' },
        { status: 404 }
      );
    }

    // Blank content/path on update means "keep the stored material".
    const privateKeyContent = validatedData.privateKeyContent?.trim()
      ? validatedData.privateKeyContent
      : undefined;
    const privateKeyPath = validatedData.privateKeyPath?.trim() || undefined;

    if (privateKeyContent && privateKeyPath) {
      return fieldError(
        'privateKeyContent',
        'Provide either private key content or a private key path, not both'
      );
    }

    let materialUpdate: {
      privateKeyContent?: string | null;
      privateKeyPath?: string | null;
    } = {};

    if (privateKeyContent) {
      const result = validatePrivateKeyMaterial(privateKeyContent);
      if (!result.ok) {
        return fieldError('privateKeyContent', result.message);
      }
      // A stored key has exactly one source; replace the other one.
      materialUpdate = { privateKeyContent, privateKeyPath: null };
    } else if (privateKeyPath) {
      const result = await validatePrivateKeyPath(privateKeyPath);
      if (!result.ok) {
        return fieldError('privateKeyPath', result.message);
      }
      materialUpdate = { privateKeyPath, privateKeyContent: null };
    } else {
      // Re-validate the material that stays so an unusable key cannot be kept.
      const existingCheck = await validateSshKeyMaterial(existingKey);
      if (!existingCheck.ok) {
        return fieldError(
          'privateKeyContent',
          `Private key content is required and must be a valid key (${existingCheck.message})`
        );
      }
    }

    // Update the SSH key
    await db.update(sshKeys)
      .set({
        ...(validatedData.name !== undefined ? { name: validatedData.name } : {}),
        ...(validatedData.publicKeyPath !== undefined
          ? { publicKeyPath: validatedData.publicKeyPath.trim() || null }
          : {}),
        ...materialUpdate,
        updatedAt: new Date(),
      })
      .where(eq(sshKeys.id, id));

    // Get the updated SSH key
    const updatedKey = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, id),
    });

    if (!updatedKey) {
      return NextResponse.json(
        { error: 'SSH key not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      redactSshKey(updatedKey as unknown as Record<string, unknown>)
    );
  } catch (error) {
    console.error('Failed to update SSH key:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to update SSH key' },
      { status: 500 }
    );
  }
}

// DELETE /api/ssh-keys/:id - Delete SSH key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const existing = await db.query.sshKeys.findFirst({
      where: eq(sshKeys.id, id),
      columns: { id: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'SSH key not found' }, { status: 404 });
    }

    const allServers = await db.query.servers.findMany({
      columns: { id: true, name: true, sshKeyId: true },
    });
    const usedByServers = findServersUsingSshKey(allServers, id);
    const allGitRepos = await db.query.gitRepos.findMany({
      columns: { id: true, name: true, sshKeyId: true },
    });
    const usedByGitRepos = findGitReposUsingSshKey(allGitRepos, id);

    if (usedByServers.length > 0 || usedByGitRepos.length > 0) {
      return NextResponse.json(
        {
          error:
            'SSH key is used by servers or Git repositories. Reassign or delete those first.',
          servers: usedByServers,
          gitRepos: usedByGitRepos,
        },
        { status: 409 }
      );
    }

    await db.delete(sshKeys).where(eq(sshKeys.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete SSH key:', error);
    return NextResponse.json(
      { error: 'Failed to delete SSH key' },
      { status: 500 }
    );
  }
}
