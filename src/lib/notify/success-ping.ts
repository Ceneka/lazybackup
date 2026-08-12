import { validateHttpUrlResolved } from '@/lib/net/url-guard-resolve';
import { validateRedirectTarget, webhookUrlPolicy } from '@/lib/net/url-guard';
import {
  WEBHOOK_TIMEOUT_MS,
  applyWebhookTemplate,
  applyWebhookUrlTemplate,
  parseWebhookHeaders,
  validateFailureWebhookUrl,
} from '@/lib/notify/failure-webhook';
import {
  parseSuccessPingMethod,
  type SuccessPingTagKey,
  type WebhookHttpMethod,
} from '@/lib/notify/presets';

export const SUCCESS_PING_URL_KEY = 'successPingUrl';
export const SUCCESS_PING_METHOD_KEY = 'successPingMethod';
export const SUCCESS_PING_HEADERS_KEY = 'successPingHeaders';
export const SUCCESS_PING_BODY_KEY = 'successPingBody';

export type BackupSucceededPayload = {
  event: 'backup.succeeded';
  backupName: string | null;
  configId: string | null;
  historyId: string;
  endedAt: string;
};

export type SuccessPingConfig = {
  url: string;
  method: WebhookHttpMethod;
  headersRaw: string;
  bodyTemplate: string;
};

export function buildBackupSucceededPayload(input: {
  historyId: string;
  configId?: string | null;
  backupName?: string | null;
  endedAt?: Date;
}): BackupSucceededPayload {
  return {
    event: 'backup.succeeded',
    backupName: input.backupName ?? null,
    configId: input.configId ?? null,
    historyId: input.historyId,
    endedAt: (input.endedAt ?? new Date()).toISOString(),
  };
}

export function successPayloadToTags(
  payload: BackupSucceededPayload
): Record<SuccessPingTagKey, string> {
  return {
    event: payload.event,
    backupName: payload.backupName ?? '',
    configId: payload.configId ?? '',
    historyId: payload.historyId,
    endedAt: payload.endedAt,
  };
}

export function buildDefaultSuccessPingBody(payload: BackupSucceededPayload): string {
  return JSON.stringify(payload);
}

/**
 * GET/POST/PUT to the success ping URL with optional header/body templates.
 * Never throws.
 */
export async function postSuccessPing(
  config: SuccessPingConfig | string,
  payload: BackupSucceededPayload,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; error?: string }> {
  const cfg: SuccessPingConfig =
    typeof config === 'string'
      ? { url: config, method: 'GET', headersRaw: '', bodyTemplate: '' }
      : config;

  const tags = successPayloadToTags(payload);
  const resolvedUrl = applyWebhookUrlTemplate(cfg.url, tags).trim();
  const validation = validateFailureWebhookUrl(resolvedUrl);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const headersParsed = parseWebhookHeaders(cfg.headersRaw);
  if (!headersParsed.ok) {
    return { ok: false, error: headersParsed.error };
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(headersParsed.headers)) {
    headers[name] = applyWebhookTemplate(value, tags);
  }

  const method = parseSuccessPingMethod(cfg.method);
  let body: string | undefined;

  if (method !== 'GET') {
    const template = cfg.bodyTemplate.trim();
    body = template
      ? applyWebhookTemplate(template, tags)
      : buildDefaultSuccessPingBody(payload);

    const hasContentType = Object.keys(headers).some(
      (k) => k.toLowerCase() === 'content-type'
    );
    if (!hasContentType) {
      const looksJson =
        !template ||
        (body.trim().startsWith('{') && body.trim().endsWith('}')) ||
        (body.trim().startsWith('[') && body.trim().endsWith(']'));
      if (looksJson) {
        headers['Content-Type'] = 'application/json';
      } else {
        headers['Content-Type'] = 'text/plain; charset=utf-8';
      }
    }
  }

  if (!options?.fetchImpl) {
    const resolved = await validateHttpUrlResolved(validation.url, webhookUrlPolicy());
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const policy = webhookUrlPolicy();

  try {
    const response = await fetchImpl(validation.url, {
      method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const next = validateRedirectTarget(
        validation.url,
        response.headers.get('location'),
        policy
      );
      if (!next.ok) {
        return { ok: false, error: next.error };
      }
      const followed = await fetchImpl(next.url, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'error',
      });
      if (!followed.ok) {
        return { ok: false, error: `Success ping responded with HTTP ${followed.status}` };
      }
      return { ok: true };
    }

    if (!response.ok) {
      return { ok: false, error: `Success ping responded with HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Success ping timed out'
          : error.message
        : 'Success ping failed';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function loadSuccessPingConfigFromDb(): Promise<SuccessPingConfig | null> {
  const { db } = await import('@/lib/db');
  const { settings } = await import('@/lib/db/schema');
  const { inArray } = await import('drizzle-orm');

  const keys = [
    SUCCESS_PING_URL_KEY,
    SUCCESS_PING_METHOD_KEY,
    SUCCESS_PING_HEADERS_KEY,
    SUCCESS_PING_BODY_KEY,
  ];
  const rows = await db.query.settings.findMany({
    where: inArray(settings.key, keys),
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
  const url = map[SUCCESS_PING_URL_KEY]?.trim();
  if (!url) return null;

  return {
    url,
    method: parseSuccessPingMethod(map[SUCCESS_PING_METHOD_KEY]),
    headersRaw: map[SUCCESS_PING_HEADERS_KEY] ?? '',
    bodyTemplate: map[SUCCESS_PING_BODY_KEY] ?? '',
  };
}

/**
 * Look up settings + history context and fire the success ping (fire-and-forget safe).
 */
export async function notifyBackupSuccess(input: {
  historyId: string;
  configId?: string | null;
  backupName?: string | null;
}): Promise<void> {
  try {
    const config = await loadSuccessPingConfigFromDb();
    if (!config) return;

    const { db } = await import('@/lib/db');
    const { backupConfigs, backupHistory } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    let configId = input.configId ?? null;
    let backupName = input.backupName ?? null;

    if (!configId || !backupName) {
      const history = await db.query.backupHistory.findFirst({
        where: eq(backupHistory.id, input.historyId),
        columns: { configId: true },
        with: {
          backupConfig: {
            columns: { name: true },
          },
        },
      });
      configId = configId ?? history?.configId ?? null;
      backupName = backupName ?? history?.backupConfig?.name ?? null;
    }

    if (configId && !backupName) {
      const configRow = await db.query.backupConfigs.findFirst({
        where: eq(backupConfigs.id, configId),
        columns: { name: true },
      });
      backupName = configRow?.name ?? null;
    }

    const payload = buildBackupSucceededPayload({
      historyId: input.historyId,
      configId,
      backupName,
    });

    const result = await postSuccessPing(config, payload);
    if (!result.ok) {
      console.error(`Success ping failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Success ping notify error:', error);
  }
}
