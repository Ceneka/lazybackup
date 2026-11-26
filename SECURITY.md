# Security

## Supported versions

Security fixes target the latest `main` and published `ghcr.io/ceneka/lazybackup` images (tagged releases; `:latest` moves with `v*`). Older tags may not receive backports.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

Email the maintainer via the contact listed on the GitHub profile for [Ceneka/lazybackup](https://github.com/Ceneka/lazybackup), or open a [private GitHub security advisory](https://github.com/Ceneka/lazybackup/security/advisories/new) if available.

Include:

- Affected version / image tag
- Impact (e.g. auth bypass, secret leak, remote code execution)
- Reproduction steps or a minimal PoC
- Whether a fix is already known

You should get an acknowledgement within a few days. Please give a reasonable window before public disclosure.

## Operator notes

- **Set a password or passkey before exposing the instance.** First-run “Skip” leaves every server, key, and setting visible to anyone who can reach the URL — and the first visitor can claim the instance by setting a password. A persistent banner reminds you until it is locked.
- Prefer an **app password** and/or **passkeys** on any instance exposed beyond localhost.
- Set `AUTH_COOKIE_SECURE=true` behind HTTPS.
- **CSRF / content type:** cookie sessions only accept state-changing requests from the same origin, and API mutations with a body must be `application/json`. If you use a reverse proxy, set `AUTH_PUBLIC_URL` (or `AUTH_TRUST_PROXY=true` so `X-Forwarded-Host`/`X-Forwarded-For` are honoured). Never trust forwarded headers without one of those.
- **Durable credentials require step-up:** creating an API token or registering a passkey asks for the current password (or a fresh passkey assertion) while the instance is locked. Changing the password can optionally revoke every API token in one click.
- Treat **API tokens** and Bro Space peer tokens as secrets; revoke compromised tokens in Settings. A **read_only** token can only test stored endpoints by id — ad-hoc probe endpoints (including MCP `test_database`) are denied to prevent SSRF / port scanning.
- Age vault private identities stay on the instance — export and store offline for disaster recovery; losing all identities means encrypted backups cannot be decrypted.
- Instance meta-backups include secrets; protect the destination and prefer passphrase wrap.
- `GET /api/settings/export` masks webhook/ping URLs to scheme + host and replaces bodies with `***`; it still reveals infrastructure shape, so treat it as operator-only.
