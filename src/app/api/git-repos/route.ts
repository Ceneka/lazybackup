import { redactGitRepo } from '@/lib/api/redact';
import { db } from '@/lib/db';
import { gitRepos } from '@/lib/db/schema';
import { gitRepoSchema } from '@/lib/git/schema';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// GET /api/git-repos
export async function GET() {
  try {
    const repos = await db.query.gitRepos.findMany({
      with: { sshKey: { columns: { id: true, name: true } } },
    });
    return NextResponse.json(repos.map((row) => redactGitRepo(row as unknown as Record<string, unknown>)));
  } catch (error) {
    console.error('Failed to fetch Git repos:', error);
    return NextResponse.json({ error: 'Failed to fetch Git repositories' }, { status: 500 });
  }
}

// POST /api/git-repos
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = gitRepoSchema.parse(body);

    const newRepo = {
      id: nanoid(),
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(gitRepos).values(newRepo);
    return NextResponse.json(
      redactGitRepo(newRepo as unknown as Record<string, unknown>),
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to create Git repo:', error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: 'Failed to create Git repository' }, { status: 500 });
  }
}
