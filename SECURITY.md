# Security

## Supported versions

Security fixes target the latest `main` and published `ghcr.io/ceneka/lazybackup` images (and tagged releases). Older tags may not receive backports.

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

- Prefer an **app password** and/or **passkeys** on any instance exposed beyond localhost.
- Set `AUTH_COOKIE_SECURE=true` behind HTTPS.
- Treat **API tokens** and Bro Space peer tokens as secrets; revoke compromised tokens in Settings.
- Age vault private identities stay on the instance — export and store offline for disaster recovery; losing all identities means encrypted backups cannot be decrypted.
- Instance meta-backups include secrets; protect the destination and prefer passphrase wrap.
