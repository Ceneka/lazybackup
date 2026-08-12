import { isSessionAuthorized } from '@/lib/auth';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import {
  FAILURE_WEBHOOK_BODY_KEY,
  FAILURE_WEBHOOK_HEADERS_KEY,
  FAILURE_WEBHOOK_METHOD_KEY,
  FAILURE_WEBHOOK_URL_KEY,
  buildBackupFailedPayload,
  parseWebhookHeaders,
  parseWebhookMethod,
  postFailureWebhook,
  validateFailureWebhookUrl,
  type FailureWebhookConfig,
  type WebhookHttpMethod,
} from '@/lib/notify/failure-webhook';
import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const bodySchema = z.object({
  url: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT']).optional(),
  headers: z.string().optional(),
  body: z.string().optional(),
});

async function settingValue(key: string): Promise<string> {
  const row = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  return row?.value?.trim() || '';
}

/**
 * POST /api/settings/webhook-test — send a sample backup.failed payload using the
 * configured (or request-provided) webhook URL / method / headers / body template.
 * Session cookie only (not API tokens) to reduce authenticated SSRF.
 */
export async function POST(request: NextRequest) {
  const sessionOk = await isSessionAuthorized(request.headers.get('cookie'));
  if (!sessionOk) {
    return NextResponse.json(
      { error: 'Session required to test webhooks' },
      { status: 401 }
    );
  }

  try {
    let body: z.infer<typeof bodySchema> = {};
    try {
      body = bodySchema.parse(await request.json());
    } catch {
      body = {};
    }

    const url = (body.url?.trim() || (await settingValue(FAILURE_WEBHOOK_URL_KEY))).trim();
    const method = parseWebhookMethod(
      body.method || (await settingValue(FAILURE_WEBHOOK_METHOD_KEY)) || 'POST'
    ) as WebhookHttpMethod;
    const headersRaw =
      body.headers !== undefined
        ? body.headers
        : await settingValue(FAILURE_WEBHOOK_HEADERS_KEY);
    const bodyTemplate =
      body.body !== undefined ? body.body : await settingValue(FAILURE_WEBHOOK_BODY_KEY);

    const headerCheck = parseWebhookHeaders(headersRaw);
    if (!headerCheck.ok) {
      return NextResponse.json({ error: headerCheck.error }, { status: 400 });
    }

    // Validate URL shape before tag substitution (tags may appear in the path/query).
    const urlForValidation = url.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, 'x');
    const validation = validateFailureWebhookUrl(urlForValidation);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    if (!url.trim()) {
      return NextResponse.json({ error: 'Webhook URL is empty' }, { status: 400 });
    }

    const payload = buildBackupFailedPayload({
      historyId: 'test',
      configId: 'test',
      backupName: 'LazyBackup test notification',
      errorMessage: 'This is a test notification from LazyBackup',
    });

    const config: FailureWebhookConfig = {
      url,
      method,
      headersRaw,
      bodyTemplate,
    };

    const result = await postFailureWebhook(config, payload);
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Webhook request failed' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, message: 'Test notification sent' });
  } catch (error) {
    console.error('Webhook test failed:', error);
    return NextResponse.json(
      { error: 'Failed to send test notification' },
      { status: 500 }
    );
  }
}
