import { db } from '@/lib/db';
import { sshKeys } from '@/lib/db/schema';
import { promises as fs } from 'fs';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import { z } from 'zod';

// Type definitions
interface SystemSSHKey {
  name: string;
  privateKeyPath: string;
  publicKeyPath?: string;
}

// SSH key validation schema
const sshKeySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  privateKeyPath: z.string().optional(),
  publicKeyPath: z.string().optional(),
  privateKeyContent: z.string().optional(),
});

// Helper function to search for SSH keys in .ssh directory
async function findSystemSSHKeys(): Promise<SystemSSHKey[]> {
  const sshDir = path.join(os.homedir(), '.ssh');
  try {
    const files = await fs.readdir(sshDir);

    const keyPairs: SystemSSHKey[] = [];
    const privateKeys = files.filter(file =>
      !file.endsWith('.pub') &&
      !file.includes('known_hosts') &&
      !file.includes('config') &&
      !file.includes('authorized_keys')
    );

    for (const privateKey of privateKeys) {
      const privateKeyPath = path.join(sshDir, privateKey);
      const publicKeyPath = path.join(sshDir, `${privateKey}.pub`);

      const hasPublicKey = files.includes(`${privateKey}.pub`);

      keyPairs.push({
        name: privateKey,
        privateKeyPath,
        publicKeyPath: hasPublicKey ? publicKeyPath : undefined
      });
    }

    return keyPairs;
  } catch (error) {
    console.error('Failed to read SSH directory:', error);
    return [];
  }
}

// GET /api/ssh-keys - List all SSH keys
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeSystem = searchParams.get('includeSystem') === 'true';

  try {
    // Get stored SSH keys from database
    const storedKeys = await db.select().from(sshKeys);

    // If system keys are requested, find and include them
    let systemKeys: SystemSSHKey[] = [];
    if (includeSystem) {
      systemKeys = await findSystemSSHKeys();
    }

    return NextResponse.json({
      storedKeys,
      systemKeys
    });
  } catch (error) {
    console.error('Failed to fetch SSH keys:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SSH keys' },
      { status: 500 }
    );
  }
}

// POST /api/ssh-keys - Create a new SSH key
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate the request body
    const validatedData = sshKeySchema.parse(body);

    // Create a new SSH key
    const newKey = {
      id: nanoid(),
      ...validatedData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert the SSH key into the database
    await db.insert(sshKeys).values(newKey);

    return NextResponse.json(newKey, { status: 201 });
  } catch (error) {
    console.error('Failed to create SSH key:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create SSH key' },
      { status: 500 }
    );
  }
} 
