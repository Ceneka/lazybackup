export const FAILURE_WEBHOOK_URL_KEY = 'failureWebhookUrl';

export const WEBHOOK_TIMEOUT_MS = 5_000;

export type BackupFailedPayload = {
  event: 'backup.failed';
  backupName: string | null;
  configId: string | null;
  historyId: string;
  errorMessage: string;
  endedAt: string;
};

export type WebhookUrlValidation =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Validate a failure webhook URL.
 * HTTPS is required except for localhost / private LAN hosts (http allowed for self-host).
 */
export function validateFailureWebhookUrl(
  raw: string | null | undefined,
  options?: { allowHttpLocal?: boolean }
): WebhookUrlValidation {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Webhook URL is empty' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid webhook URL' };
  }

  const allowHttpLocal = options?.allowHttpLocal !== false;
  const host = parsed.hostname.toLowerCase();
  const isLocalHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    isPrivateIpv4(host);

  if (parsed.protocol === 'https:') {
    return { ok: true, url: parsed.toString() };
  }

  if (parsed.protocol === 'http:' && allowHttpLocal && isLocalHost) {
    return { ok: true, url: parsed.toString() };
  }

  if (parsed.protocol === 'http:') {
    return {
      ok: false,
      error: 'Webhook URL must use HTTPS (http is only allowed for localhost/LAN)',
    };
  }

  return { ok: false, error: 'Webhook URL must be http(s)' };
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
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

/**
 * POST JSON to the webhook URL. Returns false on validation/network/HTTP failure.
 * Never throws.
 */
export async function postFailureWebhook(
  url: string,
  payload: BackupFailedPayload,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; error?: string }> {
  const validation = validateFailureWebhookUrl(url);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(validation.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
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
    const { db } = await import('@/lib/db');
    const { settings, backupConfigs, backupHistory } = await import('@/lib/db/schema');
    const { eq } = await import('drizzle-orm');

    const webhookSetting = await db.query.settings.findFirst({
      where: eq(settings.key, FAILURE_WEBHOOK_URL_KEY),
    });
    const url = webhookSetting?.value?.trim();
    if (!url) return;

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
      const config = await db.query.backupConfigs.findFirst({
        where: eq(backupConfigs.id, configId),
        columns: { name: true },
      });
      backupName = config?.name ?? null;
    }

    const payload = buildBackupFailedPayload({
      historyId: input.historyId,
      errorMessage: input.errorMessage,
      configId,
      backupName,
    });

    const result = await postFailureWebhook(url, payload);
    if (!result.ok) {
      console.error(`Failure webhook failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Failure webhook notify error:', error);
  }
}
