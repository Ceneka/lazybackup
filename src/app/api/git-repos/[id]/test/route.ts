import { db } from '@/lib/db';
import { gitRepos } from '@/lib/db/schema';
import { testGitRepo } from '@/lib/git/mirror';
import { resolvePrivateKeyForSshKeyId } from '@/lib/ssh';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/git-repos/:id/test
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const repo = await db.query.gitRepos.findFirst({
      where: eq(gitRepos.id, id),
    });
    if (!repo) {
      return NextResponse.json({ error: 'Git repository not found' }, { status: 404 });
    }
    const keyContent = repo.sshKeyId
      ? await resolvePrivateKeyForSshKeyId(repo.sshKeyId)
      : null;
    const result = await testGitRepo({ url: repo.url, keyContent });
    return NextResponse.json({
      success: true,
      message: result.refCount === 1 ? '1 ref' : `${result.refCount} refs`,
      refCount: result.refCount,
    });
  } catch (error) {
    console.error('Git repo test failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Git connection failed' },
      { status: 400 }
    );
  }
}
