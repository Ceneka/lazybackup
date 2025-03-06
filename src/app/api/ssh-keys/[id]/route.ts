import { db } from '@/lib/db';
import { sshKeys } from '@/lib/db/schema';
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
    
    return NextResponse.json(key);
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
    
    // Update the SSH key
    await db.update(sshKeys)
      .set({
        ...validatedData,
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
    
    return NextResponse.json(updatedKey);
  } catch (error) {
    console.error('Failed to update SSH key:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
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
    
    // Delete the SSH key
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
