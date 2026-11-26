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
- Bro Space: public peer URLs must be `https://` (plain `http://` is accepted only for Tailscale, or for LAN with `ALLOW_PRIVATE_PEER_URLS=true`). Tunnel/reverse-proxy request-size limits can be far below the 32 GiB peer-upload ceiling.
- The SSH `known_hosts` TOFU file defaults next to `DATABASE_URL`; keep it on persistent storage with `LAZYBACKUP_KNOWN_HOSTS`.

## Operator notes

- Prefer an **app password** and/or **passkeys** on any instance exposed beyond localhost.
- Set `AUTH_COOKIE_SECURE=true` behind HTTPS.
- Treat **API tokens** and Bro Space peer tokens as secrets; revoke compromised tokens in Settings.
- Age vault private identities stay on the instance — export and store offline for disaster recovery; losing all identities means encrypted backups cannot be decrypted.
- Instance meta-backups include secrets; protect the destination and prefer passphrase wrap.
