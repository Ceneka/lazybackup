import { redactGitRepo } from '@/lib/api/redact';
import { db } from '@/lib/db';
import { backupConfigs, gitRepos } from '@/lib/db/schema';
import { gitRepoSchema } from '@/lib/git/schema';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// GET /api/git-repos/:id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const repo = await db.query.gitRepos.findFirst({
      where: eq(gitRepos.id, id),
      with: { sshKey: { columns: { id: true, name: true } } },
    });

    if (!repo) {
      return NextResponse.json({ error: 'Git repository not found' }, { status: 404 });
    }

    const referencingBackups = await db.query.backupConfigs.findMany({
      where: eq(backupConfigs.sourceGitRepoId, id),
      columns: { id: true, name: true },
    });

    return NextResponse.json({
      ...redactGitRepo(repo as unknown as Record<string, unknown>),
      usedByBackups: referencingBackups.map((backup) => ({
        id: backup.id,
        name: backup.name,
        roles: ['source'] as const,
      })),
    });
  } catch (error) {
    console.error('Failed to fetch Git repo:', error);
    return NextResponse.json({ error: 'Failed to fetch Git repository' }, { status: 500 });
  }
}

// PUT /api/git-repos/:id
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const validatedData = gitRepoSchema.parse(body);

    const existing = await db.query.gitRepos.findFirst({
      where: eq(gitRepos.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: 'Git repository not found' }, { status: 404 });
    }

    await db
      .update(gitRepos)
      .set({
        name: validatedData.name,
        url: validatedData.url,
        sshKeyId: validatedData.sshKeyId,
        updatedAt: new Date(),
      })
      .where(eq(gitRepos.id, id));

    const updated = await db.query.gitRepos.findFirst({
      where: eq(gitRepos.id, id),
      with: { sshKey: { columns: { id: true, name: true } } },
    });
    return NextResponse.json(
      updated ? redactGitRepo(updated as unknown as Record<string, unknown>) : updated
    );
  } catch (error) {
    console.error('Failed to update Git repo:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to update Git repository' }, { status: 500 });
  }
}

// DELETE /api/git-repos/:id
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await db.query.gitRepos.findFirst({
      where: eq(gitRepos.id, id),
    });
    if (!existing) {
      return NextResponse.json({ error: 'Git repository not found' }, { status: 404 });
    }

    const referencingBackups = await db.query.backupConfigs.findMany({
      where: eq(backupConfigs.sourceGitRepoId, id),
      columns: { id: true, name: true },
    });

    if (referencingBackups.length > 0) {
      return NextResponse.json(
        {
          error: 'Git repository is used by backups',
          backups: referencingBackups.map((backup) => ({
            id: backup.id,
            name: backup.name,
            roles: ['source'],
          })),
        },
        { status: 409 }
      );
    }

    await db.delete(gitRepos).where(eq(gitRepos.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete Git repo:', error);
    return NextResponse.json({ error: 'Failed to delete Git repository' }, { status: 500 });
  }
}
