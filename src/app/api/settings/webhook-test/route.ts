import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import {
  FAILURE_WEBHOOK_URL_KEY,
  buildBackupFailedPayload,
  postFailureWebhook,
  validateFailureWebhookUrl,
} from '@/lib/notify/failure-webhook';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const bodySchema = z.object({
  url: z.string().optional(),
});

/**
 * POST /api/settings/webhook-test — send a sample backup.failed payload to the configured
 * (or provided) webhook URL.
 */
export async function POST(request: NextRequest) {
  try {
    let body: z.infer<typeof bodySchema> = {};
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      body = {};
    }

    let url = body.url?.trim();
    if (!url) {
      const row = await db.query.settings.findFirst({
        where: eq(settings.key, FAILURE_WEBHOOK_URL_KEY),
      });
      url = row?.value?.trim() || '';
    }

    const validation = validateFailureWebhookUrl(url);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const payload = buildBackupFailedPayload({
      historyId: 'test',
      configId: 'test',
      backupName: 'LazyBackup test notification',
      errorMessage: 'This is a test notification from LazyBackup',
    });

    const result = await postFailureWebhook(validation.url, payload);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || 'Webhook request failed' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, message: 'Test notification sent' });
  } catch (error) {
    console.error('Webhook test failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to send test notification',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
