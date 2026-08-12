import { isBearerAudience, redactSettingsForBearer } from '@/lib/api/redact';
import { resolveAuth, SENSITIVE_SETTING_KEYS } from '@/lib/auth';
import { isValidTimezone } from '@/lib/cron/format';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import {
  TIMEZONE_SETTING_KEY,
  clearTimezoneCache,
} from '@/lib/settings/timezone';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const sensitiveKeySet = new Set<string>(SENSITIVE_SETTING_KEYS);

// Setting validation schema
const settingSchema = z.object({
  key: z.string().min(1, 'Key is required'),
  value: z.string().optional(),
});

function isSensitiveKey(key: string): boolean {
  return sensitiveKeySet.has(key);
}

// GET /api/settings - List all settings (secrets stripped)
export async function GET(request: NextRequest) {
  try {
    const allSettings = await db.select().from(settings);
    
    // Convert to key-value object for easier client-side usage
    const settingsObject = allSettings.reduce((acc, setting) => {
      if (isSensitiveKey(setting.key)) {
        return acc;
      }
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string | null>);

    const auth = await resolveAuth(
      request.headers.get('cookie'),
      request.headers.get('authorization')
    );
    const payload = isBearerAudience(auth.via)
      ? redactSettingsForBearer(settingsObject)
      : settingsObject;
    
    return NextResponse.json(payload);
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

    if (isSensitiveKey(validatedData.key)) {
      return NextResponse.json(
        { error: 'This setting cannot be modified via the settings API. Use /api/auth instead.' },
        { status: 403 }
      );
    }

    if (
      validatedData.key === TIMEZONE_SETTING_KEY &&
      validatedData.value &&
      !isValidTimezone(validatedData.value)
    ) {
      return NextResponse.json(
        { error: 'Invalid timezone. Use an IANA name like America/Argentina/Buenos_Aires.' },
        { status: 400 }
      );
    }
    
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
    }

    if (validatedData.key === TIMEZONE_SETTING_KEY) {
      clearTimezoneCache();
      if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { restartScheduler } = await import('@/lib/scheduler');
        await restartScheduler();
      }
    }

    if (existingSetting) {
      return NextResponse.json({ key: validatedData.key, value: validatedData.value });
    }

    return NextResponse.json(
      { key: validatedData.key, value: validatedData.value },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to save setting:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
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

    if (isSensitiveKey(key)) {
      return NextResponse.json(
        { error: 'This setting cannot be deleted via the settings API. Use /api/auth instead.' },
        { status: 403 }
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
