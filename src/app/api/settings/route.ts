import { isBearerAudience, redactSettingsForBearer } from '@/lib/api/redact';
import { resolveAuth, SENSITIVE_SETTING_KEYS } from '@/lib/auth';
import { isValidTimezone } from '@/lib/cron/format';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import { validateHttpUrl } from '@/lib/net/url-guard';
import {
  FAILURE_WEBHOOK_METHOD_KEY,
  FAILURE_WEBHOOK_URL_KEY,
} from '@/lib/notify/failure-webhook';
import {
  SUCCESS_PING_METHOD_KEY,
  SUCCESS_PING_URL_KEY,
} from '@/lib/notify/success-ping';
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

// Batch write: { settings: { key: value, … } } — used by the notification presets
// so four fields are applied atomically instead of four separate POSTs.
const batchSettingsSchema = z.object({
  settings: z.record(z.string().min(1), z.string()),
});

const settingsBodySchema = z.union([batchSettingsSchema, settingSchema]);

function isSensitiveKey(key: string): boolean {
  return sensitiveKeySet.has(key);
}

const WEBHOOK_URL_KEYS = new Set<string>([
  FAILURE_WEBHOOK_URL_KEY,
  SUCCESS_PING_URL_KEY,
]);
const WEBHOOK_METHOD_KEYS = new Set<string>([
  FAILURE_WEBHOOK_METHOD_KEY,
  SUCCESS_PING_METHOD_KEY,
]);
const WEBHOOK_METHODS = new Set(['GET', 'POST', 'PUT']);
const WEBHOOK_URL_TAG_RE = /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g;

function validateSettingValue(key: string, value: string | undefined): string | null {
  if (value === undefined) return null;

  if (key === TIMEZONE_SETTING_KEY) {
    return value && !isValidTimezone(value)
      ? 'Invalid timezone. Use an IANA name like America/Argentina/Buenos_Aires.'
      : null;
  }

  if (WEBHOOK_URL_KEYS.has(key)) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // URL templates keep `{{tag}}` placeholders; substitute before parsing and
    // leave the stricter send-time policy for delivery.
    const result = validateHttpUrl(trimmed.replace(WEBHOOK_URL_TAG_RE, 'x'), {
      allowPrivate: true,
      allowCgnat: true,
      allowHttp: true,
      label: 'Webhook URL',
    });
    return result.ok ? null : `Invalid ${key}: ${result.error}`;
  }

  if (WEBHOOK_METHOD_KEYS.has(key)) {
    const method = value.trim().toUpperCase();
    return method && !WEBHOOK_METHODS.has(method)
      ? `Invalid ${key}: use GET, POST, or PUT.`
      : null;
  }

  return null;
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

/** Upsert one setting, skipping the write when the value is already stored. */
async function writeSetting(key: string, value: string | undefined): Promise<boolean> {
  const existingSetting = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });

  if (existingSetting) {
    if (existingSetting.value === value) return false;
    await db.update(settings)
      .set({
        value,
        updatedAt: new Date(),
      })
      .where(eq(settings.key, key));
    return true;
  }

  await db.insert(settings).values({
    id: nanoid(),
    key,
    value,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return true;
}

async function restartSchedulerForTimezone() {
  clearTimezoneCache();
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { restartScheduler } = await import('@/lib/scheduler');
    await restartScheduler();
  }
}

// POST /api/settings - Create or update one setting, or a batch of settings
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate the request body
    const parsed = settingsBodySchema.parse(body);

    if ('settings' in parsed) {
      const values = parsed.settings;
      const keys = Object.keys(values);

      for (const key of keys) {
        if (isSensitiveKey(key)) {
          return NextResponse.json(
            { error: `Setting "${key}" cannot be modified via the settings API. Use /api/auth instead.` },
            { status: 403 }
          );
        }
      }

      // Validate every value before writing any (batch writes stay atomic).
      for (const key of keys) {
        const error = validateSettingValue(key, values[key]);
        if (error) {
          return NextResponse.json({ error }, { status: 400 });
        }
      }

      let changed = false;
      for (const key of keys) {
        changed = (await writeSetting(key, values[key])) || changed;
      }

      if (changed && TIMEZONE_SETTING_KEY in values) {
        await restartSchedulerForTimezone();
      }

      return NextResponse.json({ settings: values });
    }

    const validatedData = parsed;

    if (isSensitiveKey(validatedData.key)) {
      return NextResponse.json(
        { error: 'This setting cannot be modified via the settings API. Use /api/auth instead.' },
        { status: 403 }
      );
    }

    const settingError = validateSettingValue(validatedData.key, validatedData.value);
    if (settingError) {
      return NextResponse.json({ error: settingError }, { status: 400 });
    }

    const existingSetting = await db.query.settings.findFirst({
      where: eq(settings.key, validatedData.key),
    });

    const changed = await writeSetting(validatedData.key, validatedData.value);

    if (changed && validatedData.key === TIMEZONE_SETTING_KEY) {
      await restartSchedulerForTimezone();
    }

    return NextResponse.json(
      { key: validatedData.key, value: validatedData.value },
      { status: existingSetting ? 200 : 201 }
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
