import { validateHttpUrlResolved } from '@/lib/net/url-guard-resolve';
import {
  isForbiddenRequestHeader,
  validateHttpUrl,
  validateRedirectTarget,
  webhookUrlPolicy,
} from '@/lib/net/url-guard';
import {
  WEBHOOK_PRESETS,
  WEBHOOK_TAG_KEYS,
  type WebhookHttpMethod,
  type WebhookPreset,
  type WebhookTagKey,
} from '@/lib/notify/presets';

export {
  WEBHOOK_PRESETS,
  WEBHOOK_TAG_KEYS,
  type WebhookHttpMethod,
  type WebhookPreset,
  type WebhookTagKey,
};

export const FAILURE_WEBHOOK_URL_KEY = 'failureWebhookUrl';
export const FAILURE_WEBHOOK_METHOD_KEY = 'failureWebhookMethod';
export const FAILURE_WEBHOOK_HEADERS_KEY = 'failureWebhookHeaders';
export const FAILURE_WEBHOOK_BODY_KEY = 'failureWebhookBody';

export const WEBHOOK_TIMEOUT_MS = 5_000;

export type BackupFailedPayload = {
  event: 'backup.failed';
  backupName: string | null;
  configId: string | null;
  historyId: string;
  errorMessage: string;
  endedAt: string;
};

export type FailureWebhookConfig = {
  url: string;
  method: WebhookHttpMethod;
  /** Raw header lines or JSON object string from settings */
  headersRaw: string;
  /** Body template; empty means default JSON payload (POST/PUT only) */
  bodyTemplate: string;
};

export type WebhookUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Validate a failure webhook URL (after tag substitution for the final request).
 * HTTPS is required except for localhost / private LAN hosts when ALLOW_LAN_WEBHOOKS is on (default).
 * Link-local / IMDS addresses are always rejected, including via HTTPS.
 */
export function validateFailureWebhookUrl(
  raw: string | null | undefined,
  options?: { allowHttpLocal?: boolean }
): WebhookUrlValidation {
  const allowLan = options?.allowHttpLocal ?? undefined;
  return validateHttpUrl(
    raw,
    webhookUrlPolicy(allowLan === undefined ? undefined : { allowLan })
  );
}

export function buildBackupFailedPayload(input: {
  historyId: string;
  errorMessage: string;
  configId?: string | null;
  backupName?: string | null;
  endedAt?: Date;
}): BackupFailedPayload {
  return {
    event: 'backup.failed',
    backupName: input.backupName ?? null,
    configId: input.configId ?? null,
    historyId: input.historyId,
    errorMessage: input.errorMessage,
    endedAt: (input.endedAt ?? new Date()).toISOString(),
  };
}

export function payloadToTags(payload: BackupFailedPayload): Record<WebhookTagKey, string> {
  return {
    event: payload.event,
    backupName: payload.backupName ?? '',
    configId: payload.configId ?? '',
    historyId: payload.historyId,
    errorMessage: payload.errorMessage,
    endedAt: payload.endedAt,
  };
}

/**
 * Replace `{{tag}}` placeholders. Unknown tags are left as-is.
 * Values are inserted as-is (caller should URL-encode when building query strings if needed).
 */
export function applyWebhookTemplate(
  template: string,
  tags: Record<string, string>,
  options?: { encodeUriComponent?: boolean }
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key: string) => {
    if (!(key in tags)) return full;
    const value = tags[key] ?? '';
    return options?.encodeUriComponent ? encodeURIComponent(value) : value;
  });
}

/**
 * For URL templates, encode tag values so query strings stay valid.
 */
export function applyWebhookUrlTemplate(
  template: string,
  tags: Record<string, string>
): string {
  return applyWebhookTemplate(template, tags, { encodeUriComponent: true });
}

export function parseWebhookMethod(raw: string | null | undefined): WebhookHttpMethod {
  const upper = (raw ?? 'POST').trim().toUpperCase();
  if (upper === 'GET' || upper === 'PUT') return upper;
  return 'POST';
}

/**
 * Parse headers from either:
 * - JSON object: `{"Authorization":"Bearer x"}`
 * - Line format: `Name: value` (one per line)
 */
export function parseWebhookHeaders(
  raw: string | null | undefined
): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { ok: true, headers: {} };
  }

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'Headers JSON must be an object' };
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string') {
          return { ok: false, error: `Header "${key}" must be a string` };
        }
        if (isForbiddenRequestHeader(key)) {
          return { ok: false, error: `Header "${key}" is not allowed` };
        }
        headers[key] = value;
      }
      return { ok: true, headers };
    } catch {
      return { ok: false, error: 'Invalid headers JSON' };
    }
  }

  const headers: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf(':');
    if (idx <= 0) {
      return {
        ok: false,
        error: `Invalid header line "${t}" (use Name: value or a JSON object)`,
      };
    }
    const name = t.slice(0, idx).trim();
    const value = t.slice(idx + 1).trim();
    if (!name) {
      return { ok: false, error: 'Header name cannot be empty' };
    }
    if (isForbiddenRequestHeader(name)) {
      return { ok: false, error: `Header "${name}" is not allowed` };
    }
    headers[name] = value;
  }
  return { ok: true, headers };
}

export function buildDefaultWebhookBody(payload: BackupFailedPayload): string {
  return JSON.stringify(payload);
}

/**
 * POST/GET/PUT to the webhook URL with optional header/body templates.
 * Never throws.
 */
export async function postFailureWebhook(
  config: FailureWebhookConfig | string,
  payload: BackupFailedPayload,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; error?: string }> {
  const cfg: FailureWebhookConfig =
    typeof config === 'string'
      ? { url: config, method: 'POST', headersRaw: '', bodyTemplate: '' }
      : config;

  const tags = payloadToTags(payload);
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

  const method = parseWebhookMethod(cfg.method);
  let body: string | undefined;

  if (method !== 'GET') {
    const template = cfg.bodyTemplate.trim();
    body = template
      ? applyWebhookTemplate(template, tags)
      : buildDefaultWebhookBody(payload);

    const hasContentType = Object.keys(headers).some(
      (k) => k.toLowerCase() === 'content-type'
    );
    if (!hasContentType) {
      // Default JSON when body looks like JSON or is the built-in payload
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
        return { ok: false, error: `Webhook responded with HTTP ${followed.status}` };
      }
      return { ok: true };
    }

    if (!response.ok) {
      return { ok: false, error: `Webhook responded with HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Webhook request timed out'
          : error.message
        : 'Webhook request failed';
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

async function loadWebhookConfigFromDb(): Promise<FailureWebhookConfig | null> {
  const { db } = await import('@/lib/db');
  const { settings } = await import('@/lib/db/schema');
  const { inArray } = await import('drizzle-orm');

  const keys = [
    FAILURE_WEBHOOK_URL_KEY,
    FAILURE_WEBHOOK_METHOD_KEY,
    FAILURE_WEBHOOK_HEADERS_KEY,
    FAILURE_WEBHOOK_BODY_KEY,
  ];
  const rows = await db.query.settings.findMany({
    where: inArray(settings.key, keys),
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
  const url = map[FAILURE_WEBHOOK_URL_KEY]?.trim();
  if (!url) return null;

  return {
    url,
    method: parseWebhookMethod(map[FAILURE_WEBHOOK_METHOD_KEY]),
    headersRaw: map[FAILURE_WEBHOOK_HEADERS_KEY] ?? '',
    bodyTemplate: map[FAILURE_WEBHOOK_BODY_KEY] ?? '',
  };
}

/**
 * Look up settings + history context and fire the failure webhook (fire-and-forget safe).
 */
export async function notifyBackupFailure(input: {
  historyId: string;
  errorMessage: string;
  configId?: string | null;
  backupName?: string | null;
}): Promise<void> {
  try {
    const config = await loadWebhookConfigFromDb();
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

    const payload = buildBackupFailedPayload({
      historyId: input.historyId,
      errorMessage: input.errorMessage,
      configId,
      backupName,
    });

    const result = await postFailureWebhook(config, payload);
    if (!result.ok) {
      console.error(`Failure webhook failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Failure webhook notify error:', error);
  }
}
