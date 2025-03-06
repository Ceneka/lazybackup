import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

// Setting validation schema
const settingSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.string().optional(),
});

// GET /api/settings - List all settings
export async function GET() {
  try {
    const allSettings = await db.select().from(settings);
    
    // Convert to key-value object for easier client-side usage
    const settingsObject = allSettings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string | null>);
    
    return NextResponse.json(settingsObject);
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

// POST /api/settings - Create or update a setting
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate the request body
    const validatedData = settingSchema.parse(body);
    
    // Check if setting already exists
    const existingSetting = await db.query.settings.findFirst({
      where: eq(settings.key, validatedData.key),
    });
    
    if (existingSetting) {
      // Update existing setting
      await db.update(settings)
        .set({
          value: validatedData.value,
          updatedAt: new Date(),
        })
        .where(eq(settings.key, validatedData.key));
        
      return NextResponse.json({ key: validatedData.key, value: validatedData.value });
    } else {
      // Create new setting
      const newSetting = {
        id: nanoid(),
        key: validatedData.key,
        value: validatedData.value,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await db.insert(settings).values(newSetting);
      
      return NextResponse.json(newSetting, { status: 201 });
    }
  } catch (error) {
    console.error('Failed to save setting:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to save setting' },
      { status: 500 }
    );
  }
}

// DELETE /api/settings/:key - Delete a setting
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    
    if (!key) {
      return NextResponse.json(
        { error: 'Key parameter is required' },
        { status: 400 }
      );
    }
    
    // Delete the setting
    await db.delete(settings).where(eq(settings.key, key));
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete setting:', error);
    return NextResponse.json(
      { error: 'Failed to delete setting' },
      { status: 500 }
    );
  }
} 
