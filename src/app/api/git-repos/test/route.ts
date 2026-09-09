import { db } from '@/lib/db';
import { gitRepos, sshKeys } from '@/lib/db/schema';
import { gitRepoSchema } from '@/lib/git/schema';
import { testGitRepo } from '@/lib/git/mirror';
import { resolvePrivateKeyForSshKeyId } from '@/lib/ssh';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

async function keyContentFor(sshKeyId: string | null | undefined): Promise<string | null> {
  if (!sshKeyId) return null;
  const key = await db.query.sshKeys.findFirst({
    where: eq(sshKeys.id, sshKeyId),
    columns: { id: true },
  });
  if (!key) {
    throw new Error('SSH key not found');
  }
  return resolvePrivateKeyForSshKeyId(sshKeyId);
}

// POST /api/git-repos/test — probe a URL without persisting
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = gitRepoSchema.parse(body);
    const keyContent = await keyContentFor(validated.sshKeyId);
    const result = await testGitRepo({ url: validated.url, keyContent });
    return NextResponse.json({
      success: true,
      message: result.refCount === 1 ? '1 ref' : `${result.refCount} refs`,
      refCount: result.refCount,
    });
  } catch (error) {
    console.error('Git repo test failed:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Git connection failed' },
      { status: 400 }
    );
  }
}
