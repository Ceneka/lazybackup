export type WebhookHttpMethod = 'GET' | 'POST' | 'PUT';

export const WEBHOOK_TAG_KEYS = [
  'event',
  'backupName',
  'configId',
  'historyId',
  'errorMessage',
  'endedAt',
] as const;

export type WebhookTagKey = (typeof WEBHOOK_TAG_KEYS)[number];

export type WebhookPreset = {
  id: string;
  name: string;
  description: string;
  method: WebhookHttpMethod;
  url: string;
  headers: string;
  body: string;
};

/** Presets shown in Settings — placeholders the operator replaces. */
export const WEBHOOK_PRESETS: WebhookPreset[] = [
  {
    id: 'default',
    name: 'Default JSON',
    description: 'POST the built-in backup.failed object (empty body template).',
    method: 'POST',
    url: 'https://hooks.example.com/lazybackup',
    headers: 'Content-Type: application/json',
    body: '',
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Incoming webhook — paste your Discord webhook URL.',
    method: 'POST',
    url: 'https://discord.com/api/webhooks/ID/TOKEN',
    headers: 'Content-Type: application/json',
    body: JSON.stringify(
      {
        content:
          '**Backup failed:** {{backupName}}\n```{{errorMessage}}```\n_History:_ `{{historyId}}` · {{endedAt}}',
      },
      null,
      2
    ),
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Bot API sendMessage — replace BOT_TOKEN and CHAT_ID.',
    method: 'POST',
    url: 'https://api.telegram.org/botBOT_TOKEN/sendMessage',
    headers: 'Content-Type: application/json',
    body: JSON.stringify(
      {
        chat_id: 'CHAT_ID',
        text: 'Backup failed: {{backupName}}\n{{errorMessage}}\n({{endedAt}})',
        disable_web_page_preview: true,
      },
      null,
      2
    ),
  },
  {
    id: 'kuma',
    name: 'Uptime Kuma',
    description: 'Push monitor — status=down with the error in msg.',
    method: 'GET',
    url: 'https://kuma.example.com/api/push/TOKEN?status=down&msg={{errorMessage}}&ping=',
    headers: '',
    body: '',
  },
  {
    id: 'ntfy',
    name: 'ntfy',
    description: 'Simple topic publish (optional auth header).',
    method: 'POST',
    url: 'https://ntfy.sh/your-topic',
    headers: 'Title: LazyBackup failure\nPriority: high\nTags: warning,backup',
    body: '{{backupName}}: {{errorMessage}}',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Incoming webhook with a text field.',
    method: 'POST',
    url: 'https://hooks.slack.com/services/T00/B00/XXX',
    headers: 'Content-Type: application/json',
    body: JSON.stringify(
      {
        text: 'Backup failed: *{{backupName}}*\n```{{errorMessage}}```',
      },
      null,
      2
    ),
  },
];

export const SUCCESS_PING_TAG_KEYS = [
  'event',
  'backupName',
  'configId',
  'historyId',
  'endedAt',
] as const;

export type SuccessPingTagKey = (typeof SUCCESS_PING_TAG_KEYS)[number];

export type SuccessPingPreset = {
  id: string;
  name: string;
  description: string;
  method: WebhookHttpMethod;
  url: string;
  headers: string;
  body: string;
};

/** Presets shown in Settings — placeholders the operator replaces. */
export const SUCCESS_PING_PRESETS: SuccessPingPreset[] = [
  {
    id: 'healthchecks',
    name: 'Healthchecks.io',
    description: 'GET your check’s ping URL (…/ping/UUID).',
    method: 'GET',
    url: 'https://hc-ping.com/YOUR-UUID',
    headers: '',
    body: '',
  },
  {
    id: 'kuma',
    name: 'Uptime Kuma',
    description: 'Push monitor — status=up on success.',
    method: 'GET',
    url: 'https://kuma.example.com/api/push/TOKEN?status=up&msg=OK&ping=',
    headers: '',
    body: '',
  },
  {
    id: 'default',
    name: 'Default JSON',
    description: 'POST the built-in backup.succeeded object (empty body template).',
    method: 'POST',
    url: 'https://hooks.example.com/lazybackup/success',
    headers: 'Content-Type: application/json',
    body: '',
  },
];

/** Success pings default to GET (Healthchecks / Kuma push style). */
export function parseSuccessPingMethod(
  raw: string | null | undefined
): WebhookHttpMethod {
  const upper = (raw ?? 'GET').trim().toUpperCase();
  if (upper === 'POST' || upper === 'PUT') return upper;
  return 'GET';
}
