import { isSessionAuthorized } from '@/lib/auth';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import {
  SUCCESS_PING_BODY_KEY,
  SUCCESS_PING_HEADERS_KEY,
  SUCCESS_PING_METHOD_KEY,
  SUCCESS_PING_URL_KEY,
  buildBackupSucceededPayload,
  parseSuccessPingMethod,
  postSuccessPing,
  type SuccessPingConfig,
} from '@/lib/notify/success-ping';
import {
  parseWebhookHeaders,
  validateFailureWebhookUrl,
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
 * POST /api/settings/success-ping-test — send a sample backup.succeeded ping using the
 * configured (or request-provided) URL / method / headers / body template.
 * Session cookie only (not API tokens) to reduce authenticated SSRF.
 */
export async function POST(request: NextRequest) {
  const sessionOk = await isSessionAuthorized(request.headers.get('cookie'));
  if (!sessionOk) {
    return NextResponse.json(
      { error: 'Session required to test success pings' },
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

    const url = (body.url?.trim() || (await settingValue(SUCCESS_PING_URL_KEY))).trim();
    const method = parseSuccessPingMethod(
      body.method || (await settingValue(SUCCESS_PING_METHOD_KEY)) || 'GET'
    ) as WebhookHttpMethod;
    const headersRaw =
      body.headers !== undefined
        ? body.headers
        : await settingValue(SUCCESS_PING_HEADERS_KEY);
    const bodyTemplate =
      body.body !== undefined ? body.body : await settingValue(SUCCESS_PING_BODY_KEY);

    const headerCheck = parseWebhookHeaders(headersRaw);
    if (!headerCheck.ok) {
      return NextResponse.json({ error: headerCheck.error }, { status: 400 });
    }

    const urlForValidation = url.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, 'x');
    const validation = validateFailureWebhookUrl(urlForValidation);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    if (!url.trim()) {
      return NextResponse.json({ error: 'Success ping URL is empty' }, { status: 400 });
    }

    const payload = buildBackupSucceededPayload({
      historyId: 'test',
      configId: 'test',
      backupName: 'LazyBackup test success ping',
    });

    const config: SuccessPingConfig = {
      url,
      method,
      headersRaw,
      bodyTemplate,
    };

    const result = await postSuccessPing(config, payload);
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Success ping request failed' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, message: 'Success ping sent' });
  } catch (error) {
    console.error('Success ping test failed:', error);
    return NextResponse.json(
      { error: 'Failed to send success ping' },
      { status: 500 }
    );
  }
}
