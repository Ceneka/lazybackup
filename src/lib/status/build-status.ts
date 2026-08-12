export type StatusSeverity = 'ok' | 'info' | 'warn' | 'critical'

export type StatusCheck = {
  id: string
  severity: StatusSeverity
  title: string
  detail: string
  href?: string
}

export type StatusSnapshot = {
  auth: {
    authEnabled: boolean
    authSetupCompleted: boolean
    hasPassword: boolean
    passkeyCount: number
  }
  encryption: {
    configured: boolean
    needsExportAck: boolean
    encryptionInUse: boolean
    keyCount: number
    recoveryRecipientCount: number
    activeKeyExportAcknowledged: boolean
    compromisedKeyCount: number
  }
  instanceBackup: {
    configCount: number
    enabledCount: number
    withPassphraseCount: number
    lastSuccessAgeDays: number | null
  }
  notifications: {
    failureWebhookConfigured: boolean
  }
  apiTokens: {
    activeCount: number
    remoteExecCount: number
  }
  backups: {
    total: number
    enabled: number
    encryptedOrPeerCount: number
    failedLast24h: number
  }
  servers: {
    total: number
    passwordOnlyCount: number
  }
  cookieSecure: boolean
}

export type StatusSummary = {
  overall: 'critical' | 'warn' | 'ok'
  criticalCount: number
  warnCount: number
  okCount: number
  infoCount: number
  headline: string
}

const INSTANCE_STALE_DAYS = 7

/** Build operator-facing safety checks from a gathered snapshot. */
export function buildStatusChecks(s: StatusSnapshot): StatusCheck[] {
  const checks: StatusCheck[] = []

  // --- Auth ---
  if (!s.auth.authEnabled) {
    checks.push({
      id: 'auth-open',
      severity: 'critical',
      title: 'Dashboard is unlocked',
      detail:
        'Anyone who can reach this URL can manage backups and secrets. Set an app password or register a passkey.',
      href: '/settings',
    })
  } else {
    if (s.auth.hasPassword && s.auth.passkeyCount > 0) {
      checks.push({
        id: 'auth-password-and-passkey',
        severity: 'ok',
        title: 'Password and passkey protect login',
        detail: `${s.auth.passkeyCount} passkey${s.auth.passkeyCount === 1 ? '' : 's'} registered alongside the app password.`,
        href: '/settings',
      })
    } else if (s.auth.passkeyCount > 0) {
      checks.push({
        id: 'auth-passkey-only',
        severity: 'ok',
        title: 'Passkey login enabled',
        detail: `${s.auth.passkeyCount} passkey${s.auth.passkeyCount === 1 ? '' : 's'} — consider adding a password as a fallback.`,
        href: '/settings',
      })
    } else {
      checks.push({
        id: 'auth-password-only',
        severity: 'info',
        title: 'App password protects login',
        detail: 'A passkey adds phishing-resistant unlock on this device.',
        href: '/settings',
      })
    }
  }

  if (s.auth.authEnabled && !s.cookieSecure) {
    checks.push({
      id: 'auth-cookie-insecure',
      severity: 'info',
      title: 'Session cookie is not marked Secure',
      detail:
        'Fine on a trusted LAN. Set AUTH_COOKIE_SECURE=true when serving over HTTPS.',
      href: '/settings',
    })
  }

  // --- Encryption ---
  if (s.encryption.encryptionInUse && !s.encryption.configured) {
    checks.push({
      id: 'encryption-missing',
      severity: 'critical',
      title: 'Encrypted backups need an age key',
      detail:
        'Some backups encrypt or use Bro Space, but no active age key is configured.',
      href: '/settings?tab=encryption',
    })
  } else if (s.encryption.configured) {
    if (s.encryption.needsExportAck) {
      checks.push({
        id: 'encryption-export',
        severity: 'warn',
        title: 'Active age key not marked as exported',
        detail:
          'Encrypted or Bro backups are in use. Export the private key and confirm you saved an offline copy.',
        href: '/settings?tab=encryption',
      })
    } else if (s.encryption.activeKeyExportAcknowledged) {
      checks.push({
        id: 'encryption-export-ok',
        severity: 'ok',
        title: 'Active age key export acknowledged',
        detail: `${s.encryption.keyCount} key${s.encryption.keyCount === 1 ? '' : 's'} in the vault.`,
        href: '/settings?tab=encryption',
      })
    } else if (!s.encryption.encryptionInUse) {
      checks.push({
        id: 'encryption-ready',
        severity: 'ok',
        title: 'Age key ready (not used yet)',
        detail: 'No encrypted or Bro backups are configured yet.',
        href: '/settings?tab=encryption',
      })
    }

    if (s.encryption.encryptionInUse && s.encryption.recoveryRecipientCount === 0) {
      checks.push({
        id: 'encryption-recovery',
        severity: 'warn',
        title: 'No recovery recipients',
        detail:
          'Add an offline age1… recipient so ciphertext can still be unlocked if this instance is lost.',
        href: '/settings?tab=encryption',
      })
    } else if (s.encryption.recoveryRecipientCount > 0) {
      checks.push({
        id: 'encryption-recovery-ok',
        severity: 'ok',
        title: 'Recovery recipients configured',
        detail: `${s.encryption.recoveryRecipientCount} extra public recipient${s.encryption.recoveryRecipientCount === 1 ? '' : 's'} on every encrypt.`,
        href: '/settings?tab=encryption',
      })
    }

    if (s.encryption.compromisedKeyCount > 0) {
      checks.push({
        id: 'encryption-compromised',
        severity: 'info',
        title: 'Compromised keys retained for decrypt',
        detail: `${s.encryption.compromisedKeyCount} marked compromised — kept so old artifacts can still restore.`,
        href: '/settings?tab=encryption',
      })
    }
  } else if (s.backups.enabled > 0) {
    checks.push({
      id: 'encryption-optional',
      severity: 'info',
      title: 'Backups are not age-encrypted',
      detail: 'Optional — enable encryption per backup or use Bro Space for ciphertext at rest.',
      href: '/settings?tab=encryption',
    })
  }

  // --- Instance meta-backup ---
  if (s.instanceBackup.configCount === 0) {
    checks.push({
      id: 'instance-backup-missing',
      severity: 'warn',
      title: 'LazyBackup data is not backed up',
      detail:
        'Create an instance backup so SQLite, age keys, and SSH keys can be recovered if this host dies.',
      href: '/backups/new?source=lazybackup_instance',
    })
  } else {
    if (s.instanceBackup.enabledCount === 0) {
      checks.push({
        id: 'instance-backup-disabled',
        severity: 'warn',
        title: 'Instance backup exists but is disabled',
        detail: `${s.instanceBackup.configCount} config${s.instanceBackup.configCount === 1 ? '' : 's'} — enable scheduling or run manually.`,
        href: '/backups',
      })
    } else if (
      s.instanceBackup.lastSuccessAgeDays === null
    ) {
      checks.push({
        id: 'instance-backup-never',
        severity: 'warn',
        title: 'Instance backup has never succeeded',
        detail: 'Run the LazyBackup instance job once to verify it lands correctly.',
        href: '/backups',
      })
    } else if (s.instanceBackup.lastSuccessAgeDays > INSTANCE_STALE_DAYS) {
      checks.push({
        id: 'instance-backup-stale',
        severity: 'warn',
        title: 'Instance backup is stale',
        detail: `Last success was ${s.instanceBackup.lastSuccessAgeDays} days ago (threshold ${INSTANCE_STALE_DAYS} days).`,
        href: '/backups',
      })
    } else {
      checks.push({
        id: 'instance-backup-ok',
        severity: 'ok',
        title: 'Instance backup is recent',
        detail: `Last success ${s.instanceBackup.lastSuccessAgeDays === 0 ? 'today' : `${s.instanceBackup.lastSuccessAgeDays} day${s.instanceBackup.lastSuccessAgeDays === 1 ? '' : 's'} ago`}.`,
        href: '/backups',
      })
    }

    if (
      s.instanceBackup.enabledCount > 0 &&
      s.instanceBackup.withPassphraseCount === 0
    ) {
      checks.push({
        id: 'instance-backup-passphrase',
        severity: 'info',
        title: 'Instance archive has no passphrase wrap',
        detail:
          'OK on a trusted destination. Add a passphrase if the archive lands on shared or remote storage.',
        href: '/backups',
      })
    } else if (s.instanceBackup.withPassphraseCount > 0) {
      checks.push({
        id: 'instance-backup-passphrase-ok',
        severity: 'ok',
        title: 'Instance archive passphrase wrap enabled',
        detail: 'The meta-backup tarball is wrapped with an age passphrase.',
        href: '/backups',
      })
    }
  }

  // --- Notifications ---
  if (s.backups.enabled > 0 && !s.notifications.failureWebhookConfigured) {
    checks.push({
      id: 'webhook-missing',
      severity: 'info',
      title: 'No failure webhook',
      detail: 'Optional — get notified when a scheduled backup fails.',
      href: '/settings',
    })
  } else if (s.notifications.failureWebhookConfigured) {
    checks.push({
      id: 'webhook-ok',
      severity: 'ok',
      title: 'Failure webhook configured',
      detail: 'Failed backups can notify Discord, Telegram, ntfy, or any HTTP endpoint.',
      href: '/settings',
    })
  }

  // --- Recent failures ---
  if (s.backups.failedLast24h > 0) {
    checks.push({
      id: 'backups-failed-24h',
      severity: 'warn',
      title: 'Recent backup failures',
      detail: `${s.backups.failedLast24h} failed run${s.backups.failedLast24h === 1 ? '' : 's'} in the last 24 hours.`,
      href: '/history',
    })
  } else if (s.backups.enabled > 0) {
    checks.push({
      id: 'backups-healthy-24h',
      severity: 'ok',
      title: 'No failures in the last 24 hours',
      detail: `${s.backups.enabled} enabled backup${s.backups.enabled === 1 ? '' : 's'}.`,
      href: '/history',
    })
  }

  // --- Servers ---
  if (s.servers.passwordOnlyCount > 0) {
    checks.push({
      id: 'servers-password-only',
      severity: 'warn',
      title: 'Servers using password-only SSH',
      detail: `${s.servers.passwordOnlyCount} server${s.servers.passwordOnlyCount === 1 ? '' : 's'} lack an SSH key — path transfers need a key on each endpoint.`,
      href: '/servers',
    })
  } else if (s.servers.total > 0) {
    checks.push({
      id: 'servers-keys-ok',
      severity: 'ok',
      title: 'Servers use SSH key auth',
      detail: `${s.servers.total} configured server${s.servers.total === 1 ? '' : 's'}.`,
      href: '/servers',
    })
  }

  // --- API tokens ---
  if (s.apiTokens.remoteExecCount > 0) {
    checks.push({
      id: 'tokens-remote-exec',
      severity: 'info',
      title: 'API tokens with remote_exec',
      detail: `${s.apiTokens.remoteExecCount} active token${s.apiTokens.remoteExecCount === 1 ? '' : 's'} can run remote shell commands — treat like root SSH.`,
      href: '/settings?tab=mcp',
    })
  } else if (s.apiTokens.activeCount > 0) {
    checks.push({
      id: 'tokens-ok',
      severity: 'ok',
      title: 'API tokens without remote_exec',
      detail: `${s.apiTokens.activeCount} active token${s.apiTokens.activeCount === 1 ? '' : 's'} for MCP/agents.`,
      href: '/settings?tab=mcp',
    })
  }

  return checks
}

export function summarizeStatusChecks(checks: StatusCheck[]): StatusSummary {
  const criticalCount = checks.filter((c) => c.severity === 'critical').length
  const warnCount = checks.filter((c) => c.severity === 'warn').length
  const okCount = checks.filter((c) => c.severity === 'ok').length
  const infoCount = checks.filter((c) => c.severity === 'info').length

  let overall: StatusSummary['overall'] = 'ok'
  let headline = 'Looking good'
  if (criticalCount > 0) {
    overall = 'critical'
    headline =
      criticalCount === 1
        ? '1 critical issue needs attention'
        : `${criticalCount} critical issues need attention`
  } else if (warnCount > 0) {
    overall = 'warn'
    headline =
      warnCount === 1 ? '1 warning to review' : `${warnCount} warnings to review`
  } else if (infoCount > 0 && okCount === 0) {
    headline = 'A few optional improvements'
  }

  return { overall, criticalCount, warnCount, okCount, infoCount, headline }
}

export { INSTANCE_STALE_DAYS }
