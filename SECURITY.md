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

## Hardening checklist

Full checklist and deployment notes: [README → Hardening checklist](./README.md#hardening-checklist). The essentials:

- A fresh instance is **open until an app password or passkey is set**. Bind the published port to loopback (`127.0.0.1:3000`) or firewall it before first start.
- Mount a **dedicated SSH key directory**, not all of `~/.ssh`.
- A mounted **Docker socket is root-equivalent** on the host.
- `AUTH_COOKIE_SECURE=true` and `ENABLE_HSTS=true` only when every request is HTTPS. `AUTH_TRUST_PROXY=true` only behind a proxy that overwrites `X-Forwarded-*`; set `AUTH_PUBLIC_URL` for passkeys.
- **Pre-backup command output is stored in history logs** — never echo secrets there.
- Bro Space: public peer URLs must be `https://` (plain `http://` is accepted only for Tailscale, or for LAN with `ALLOW_PRIVATE_PEER_URLS=true`). Mailbox transfers move in 4 MiB chunks, so proxy request-body caps are not the limit; very large pulls and downloads still depend on the proxy's response limits and timeouts.
- The SSH `known_hosts` TOFU file defaults next to `DATABASE_URL`; keep it on persistent storage with `LAZYBACKUP_KNOWN_HOSTS`.

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
