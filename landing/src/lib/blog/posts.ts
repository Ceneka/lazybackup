export type BlogBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "img"; src: string; alt: string; caption?: string }
  | { type: "code"; code: string; lang?: string }
  | { type: "callout"; text: string };

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  dateLabel: string;
  readingMinutes: number;
  tags: string[];
  cover: { src: string; alt: string };
  body: BlogBlock[];
};

export const posts: BlogPost[] = [
  {
    slug: "age-vault-recovery",
    title: "Age vault: keys, export, and recovery",
    description:
      "Create an age key, export and acknowledge a copy, add recovery recipients, and turn encryption on for a backup—before Bro Space or a disk failure makes it urgent.",
    date: "2026-08-13",
    dateLabel: "Aug 13, 2026",
    readingMinutes: 6,
    tags: ["howto", "encryption", "recovery"],
    cover: {
      src: "/screenshots/encryption.png",
      alt: "LazyBackup Settings Encryption tab with the age key vault",
    },
    body: [
      {
        type: "p",
        text: "LazyBackup can age-encrypt artifacts before they land on disk, S3, or a Bro peer. Keys live in an instance vault: one active identity for new encrypts, plus retired or compromised keys kept only so old ciphertext can still decrypt. Recovery is extra public age1… recipients added on every encrypt—not a second copy of your private key on this box.",
      },
      {
        type: "callout",
        text: "If every private identity is gone—this instance, your offline export, and any recovery keys—the ciphertext is gone. There is no backdoor.",
      },
      {
        type: "h2",
        text: "Step 1 — Create a key",
      },
      {
        type: "ol",
        items: [
          "Open Settings → Encryption.",
          "Generate key (or Create new key if a vault already exists).",
          "Creating a new key demotes the previous active key to retired. Decrypt still tries every identity in the vault—never a silent overwrite.",
        ],
      },
      {
        type: "img",
        src: "/screenshots/encryption.png",
        alt: "Encryption settings with generate key and recovery recipients",
        caption: "Settings → Encryption — vault, export, and recovery recipients on one tab.",
      },
      {
        type: "h2",
        text: "Step 2 — Export and acknowledge",
      },
      {
        type: "p",
        text: "Private identities stay on this instance. Export a copy (plaintext or passphrase-wrapped) and store it somewhere you would trust after the box dies. Then acknowledge the export in the UI so Status stops warning. Skip the ack and encrypted/Bro jobs still run—you just have no proof you saved a disaster-recovery copy.",
      },
      {
        type: "ul",
        items: [
          "Plaintext export: the age identity file. Treat it like a password dump.",
          "Passphrase wrap: same identity, encrypted so a stolen file isn’t immediately usable.",
          "Ack is a checkbox on this instance, not a second backup of the key.",
        ],
      },
      {
        type: "h2",
        text: "Step 3 — Recovery recipients",
      },
      {
        type: "p",
        text: "Add extra public age1… keys under recovery recipients. Every encrypt includes the active key plus those recipients. Keep the matching private keys offline (another machine, a hardware token workflow, a printed paper key). They are how you unlock ciphertext if this LazyBackup—and its vault—are gone.",
      },
      {
        type: "callout",
        text: "Recovery recipients are public keys only. They do not live as private identities in this vault. Losing the instance without an export still means you need those offline private keys.",
      },
      {
        type: "h2",
        text: "Step 4 — Enable on a job",
      },
      {
        type: "ol",
        items: [
          "Edit a backup (or New Backup).",
          "Turn on Encrypt with age before land (local, server, or S3 destinations).",
          "Run once and confirm History shows an encrypted artifact.",
        ],
      },
      {
        type: "p",
        text: "You need an active key in the vault first. Instance meta-backups (SQLite + vault + SSH keys) are a different path: optional passphrase wrap, not this age-key encrypt, and never Bro.",
      },
      {
        type: "h2",
        text: "Bro Space always encrypts",
      },
      {
        type: "p",
        text: "Peer destinations force encryption. Your friend only ever stores opaque blobs. Create and export a key before you send a Bro invite—the Status page will nag if Bro or encrypt-on jobs exist without an active key.",
      },
      {
        type: "h2",
        text: "Lose all identities = gone",
      },
      {
        type: "ul",
        items: [
          "Decrypt uses every vault identity (active, retired, compromised).",
          "Create new key retires the old one; old backups still decrypt while that retired key remains.",
          "Mark compromised to stop using a key for new work while keeping it for decrypt.",
          "If the instance, the export, and every recovery private key are lost, ciphertext cannot be restored. Age has no escrow.",
        ],
      },
      {
        type: "h2",
        text: "Quick checklist",
      },
      {
        type: "ul",
        items: [
          "Active age key created",
          "Offline export saved (plaintext or passphrase-wrapped) and acknowledged",
          "At least one recovery recipient whose private key you hold elsewhere",
          "Encrypt enabled on jobs that leave this host (required for Bro)",
        ],
      },
      {
        type: "callout",
        text: "Settings → Encryption is the vault. Export first, then encrypt. Bro Space pairing notes live in Share backup space with Bro Space.",
      },
    ],
  },
  {
    slug: "bro-space-pairing-lazybro",
    title: "Share backup space with Bro Space",
    description:
      "Invite a friend with LazyBro (or another LazyBackup): mailbox sync, age-encrypted opaque blobs, optional Tailscale on your host—no ports on their side.",
    date: "2026-08-12",
    dateLabel: "Aug 12, 2026",
    readingMinutes: 7,
    tags: ["howto", "bro-space", "encryption"],
    cover: {
      src: "/screenshots/bro-space.png",
      alt: "LazyBackup Settings Bro Space tab for inviting a friend to share backup space",
    },
    body: [
      {
        type: "p",
        text: "Bro Space is 1:1 reciprocal peer storage: you lend encrypted backup space to a friend, and they can lend some back. New pairs use a mailbox—your LazyBackup stages ciphertext locally, their side pulls when online. Backups still succeed if they’re briefly offline; sync catches up later.",
      },
      {
        type: "callout",
        text: "You need an age key in Settings → Encryption before Bro destinations work. Peer landings always encrypt; your friend only ever sees opaque blobs.",
      },
      {
        type: "h2",
        text: "Two ways to pair",
      },
      {
        type: "ul",
        items: [
          "LazyBro — lightweight outbound agent on their machine. They paste your invite, pick a folder, leave it running. Only your LazyBackup needs a reachable URL.",
          "Another LazyBackup — same invite; they Accept under Settings → Bro Space. Both instances need a reachable URL and both run the mailbox sync worker.",
        ],
      },
      {
        type: "img",
        src: "/screenshots/bro-space.png",
        alt: "Bro Space settings with LazyBackup address and invite flow",
        caption: "Settings → Bro Space — save your address, create an invite, send it.",
      },
      {
        type: "h2",
        text: "Step 1 — Age key + your address",
      },
      {
        type: "ol",
        items: [
          "Settings → Encryption → create an age key (export and acknowledge a copy).",
          "Settings → Bro Space → set Your LazyBackup address (https://… or a Tailscale http://100.x:PORT) and Save.",
          "Create the invite before you send anything—the invite embeds that address.",
        ],
      },
      {
        type: "h2",
        text: "Step 2 — Invite (quota)",
      },
      {
        type: "p",
        text: "Under Invite a bro, pick how many GB you’ll each share, create the invite, and copy the code. Send it out-of-band (chat, Signal, whatever you trust).",
      },
      {
        type: "code",
        lang: "text",
        code: `You (LazyBackup):  Settings → Bro Space → Save address → Create invite
Friend (LazyBro):   install → paste invite → pick share folder → stay running
Friend (full LB):   Settings → Bro Space → Accept invite`,
      },
      {
        type: "h2",
        text: "Step 3 — Friend installs LazyBro",
      },
      {
        type: "p",
        text: "LazyBro is a small Bun agent. Download a binary, or build from the bro/ folder. It opens a local page (http://127.0.0.1:3789). They choose a folder for your encrypted backups, paste the invite, optionally enable start-at-login, and leave it running.",
      },
      {
        type: "code",
        lang: "bash",
        code: `# Linux x64
curl -L -o lazybro https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-linux-x64
chmod +x lazybro && ./lazybro

# Also: lazybro-linux-arm64, lazybro-darwin-arm64, lazybro-darwin-x64
# Windows: https://github.com/Ceneka/lazybackup/releases/download/lazybro/lazybro-windows-x64.exe`,
      },
      {
        type: "ul",
        items: [
          "No public URL, ports, or Tailscale required on their side",
          "They phone home to your LazyBackup on an interval",
          "If you’re briefly down, LazyBro retries quietly",
        ],
      },
      {
        type: "h2",
        text: "Optional: Tailscale on your host",
      },
      {
        type: "p",
        text: "Friends can’t reach a CGNAT home lab without help. Tailscale belongs on the machine running LazyBackup—not inside LazyBro. The image does not bundle Tailscale (~50MB+).",
      },
      {
        type: "ol",
        items: [
          "Install Tailscale on the host; mount /var/run/tailscale into Docker if you use compose (see docker-compose.yml comments).",
          "Or use the compose overlay with TS_AUTHKEY (docker-compose.tailscale.yml).",
          "In Bro Space, when Tailscale is detected, Use as LazyBackup address fills http://100.x:PORT.",
        ],
      },
      {
        type: "h2",
        text: "Step 4 — Backup To → Bro",
      },
      {
        type: "p",
        text: "New Backup → set To to a paired bro peer (destinationKind=peer). Encryption is forced. On run, LazyBackup age-encrypts, stages under peers-staging, and marks the job successful. Their LazyBro (or peer LB) pulls via /api/peers/agent/*, stores the opaque blob, and acks. Pending sync is soft status—not a failure webhook.",
      },
      {
        type: "code",
        lang: "text",
        code: `From:  path / docker volume / database (not instance meta-backup)
To:    Bro peer (Settings → Bro Space)
Land:  age ciphertext → local mailbox staging → peer pull → ack`,
      },
      {
        type: "callout",
        text: "Instance meta-backups (SQLite + vault + SSH keys) cannot use Bro destinations—prefer a trusted path/S3 and optional passphrase wrap.",
      },
      {
        type: "h2",
        text: "Restore and recalls",
      },
      {
        type: "p",
        text: "If the object is still in staging, restore can use it immediately. After the bro has pulled it, restore may wait for a recall: LazyBackup asks the peer to upload the blob back. Waiting for Bro is a soft 202—not a critical failure. Keep LazyBro running so recalls can finish. Mailbox destinations honor the same version-count and age-based file retention as S3: LazyBackup advertises deletes; LazyBro unlinks and acks. Open recalls are not deleted until they finish.",
      },
      {
        type: "h2",
        text: "Quick checklist",
      },
      {
        type: "ul",
        items: [
          "Active age key exported/acknowledged",
          "LazyBackup address saved (public HTTPS or Tailscale 100.x)",
          "Invite created with a quota you’re happy with",
          "Friend on LazyBro (outbound-only) or Accept on another LB",
          "Backup To → peer; offline/sync pending is informational",
        ],
      },
      {
        type: "callout",
        text: "That’s Bro Space: invite → mailbox → encrypted blobs on a friend’s disk. Details and Tailscale notes also live in the repo README and bro/README.md.",
      },
    ],
  },
  {
    slug: "manage-backups-with-mcp",
    title: "Manage LazyBackup with MCP",
    description:
      "Point Cursor, Claude, or any MCP client at your self-hosted LazyBackup instance—API tokens, /mcp, and one-click install.",
    date: "2026-08-11",
    dateLabel: "Aug 11, 2026",
    readingMinutes: 5,
    tags: ["product", "mcp", "agents"],
    cover: {
      src: "/screenshots/dashboard.png",
      alt: "LazyBackup dashboard — the same instance agents can manage over MCP",
    },
    body: [
      {
        type: "p",
        text: "LazyBackup already runs where you want it—home lab, VPS, or a spare box on the LAN. The new piece is letting your coding agent talk to that instance the same way you do in the UI: list jobs, kick a run, tweak a schedule, check history.",
      },
      {
        type: "p",
        text: "That’s what MCP (Model Context Protocol) is for. LazyBackup exposes a Streamable HTTP endpoint at /mcp on the same app. No separate agent on every VPS, no local bridge process you have to keep updated—just URL + token.",
      },
      {
        type: "callout",
        text: "HTTP MCP lives on the server. Cursor or Claude on your laptop connects to https://your-host/mcp with a Bearer API token. stdio would only wrap the same API from a local process; for self-hosted LazyBackup, in-app HTTP is the fit.",
      },
      {
        type: "h2",
        text: "Create a token",
      },
      {
        type: "ol",
        items: [
          "Enable an app password (recommended) so the UI and API aren’t open on the network.",
          "Open Settings → API / MCP.",
          "Create a token, copy it immediately—plaintext is shown once.",
          "Revoke anytime from the same list if a laptop or agent is gone.",
        ],
      },
      {
        type: "p",
        text: "Tokens default to write access (same gate as a logged-in session), minus remote shell unless you opt in to remote_exec. A read_only token may inspect, validate_backup, and test_*—it cannot mutate. Treat write tokens like the app password. Prefer HTTPS, or keep the instance on a trusted LAN.",
      },
      {
        type: "h2",
        text: "One-click install",
      },
      {
        type: "p",
        text: "After you create a token, LazyBackup builds client-specific install helpers from your current origin:",
      },
      {
        type: "ul",
        items: [
          "Add to Cursor — official deeplink that opens an install confirm with url + Authorization header",
          "Add to VS Code — vscode:mcp/install link",
          "Copy mcp.json — generic config for any client",
          "Copy Claude config — paste into Connectors / desktop config",
          "Copy Claude Code CLI — claude mcp add --transport http …",
        ],
      },
      {
        type: "code",
        lang: "json",
        code: `{
  "mcpServers": {
    "lazybackup": {
      "url": "https://your-host/mcp",
      "headers": {
        "Authorization": "Bearer lb_…"
      }
    }
  }
}`,
      },
      {
        type: "h2",
        text: "What the agent can do",
      },
      {
        type: "p",
        text: "Tools are curated for agents—not a raw dump of every REST route. Descriptions encode From → To rules (path, Docker volume, database; local / server / S3).",
      },
      {
        type: "ul",
        items: [
          "Inspect: list_backups, get_backup, list_history, get_dashboard, get_status, list_servers, list_s3_profiles",
          "Probe: validate_backup, test_server, test_database (allowed for read_only tokens)",
          "Operate: run_backup, toggle_backup",
          "Manage: create_backup, update_backup, create_server, update_server",
          "Destructive (need confirm=true): delete_backup, delete_server, restore_history",
        ],
      },
      {
        type: "p",
        text: "Secrets (SSH keys, DB passwords, S3 secrets) are redacted in responses. History logs are truncated so the model isn’t buried in rsync noise. Token use bumps last-used time and writes an audit row—enough to answer “what did the agent do?”",
      },
      {
        type: "img",
        src: "/screenshots/dashboard.png",
        alt: "LazyBackup dashboard",
        caption: "Same dashboard your agent can summarize with get_dashboard.",
      },
      {
        type: "h2",
        text: "A prompt that works",
      },
      {
        type: "code",
        lang: "text",
        code: `List my LazyBackup jobs and run the one named "WordPress site" if it isn’t already running.
If anything failed in the last day, summarize the error from history.`,
      },
      {
        type: "p",
        text: "Or: “Add a nightly database dump from server X to this host under /backups/app-db”—then review the create_backup payload before you let it confirm anything destructive.",
      },
      {
        type: "h2",
        text: "Security notes",
      },
      {
        type: "ul",
        items: [
          "App password locks the browser UI; API tokens are for machines.",
          "Token management itself requires a session cookie—Bearer tokens cannot mint new tokens.",
          "If you skip the app password, /mcp is open like the rest of the API—fine on localhost, risky on a public VPS.",
        ],
      },
      {
        type: "callout",
        text: "Deploy LazyBackup, open Settings → API / MCP, hit Add to Cursor, and ask your agent to manage backups on the box you already trust.",
      },
    ],
  },
  {
    slug: "introducing-lazybackup",
    title: "Introducing LazyBackup",
    description:
      "A self-hosted From → To backup manager for paths, Docker volumes, and database dumps—between this host, SSH servers, and S3.",
    date: "2026-08-10",
    dateLabel: "Aug 10, 2026",
    readingMinutes: 5,
    tags: ["product", "self-hosted"],
    cover: {
      src: "/screenshots/dashboard.png",
      alt: "LazyBackup dashboard with backup status, success rate, and upcoming schedules",
    },
    body: [
      {
        type: "p",
        text: "LazyBackup is a self-hosted web app for people who already run VPS boxes, Docker stacks, and the occasional “I’ll write a cron later” script. You point it at endpoints, define a From → To job, and it transfers the data on a schedule—with history, retention, and restore when you need it.",
      },
      {
        type: "p",
        text: "No agents to install on every machine. No cloud account required. One container (or a Bun process), SSH keys for your servers, and optional S3-compatible storage.",
      },
      {
        type: "img",
        src: "/screenshots/dashboard.png",
        alt: "LazyBackup dashboard overview",
        caption: "Dashboard — last 30 days, storage, and what’s scheduled next.",
      },
      {
        type: "h2",
        text: "The idea: From → To",
      },
      {
        type: "p",
        text: "Every backup is a transfer between endpoints. Each side can be this host (where LazyBackup runs), an SSH server, or an S3-compatible profile (MinIO, R2, B2, AWS, …). That covers the directions people actually need: local↔local, local↔server, server↔server, and anything with S3 in the mix.",
      },
      {
        type: "ul",
        items: [
          "Paths — rsync/scp between filesystems or object prefixes",
          "Docker volumes — pack a named volume on a source server or this host’s Docker socket to .tar.gz",
          "Databases — Postgres / MySQL / MariaDB / SQLite logical dumps to .sql.gz or .sqlite.gz",
          "Bro Space — land age-encrypted blobs on a friend’s LazyBro or another LazyBackup (mailbox sync)",
        ],
      },
      {
        type: "img",
        src: "/screenshots/backups.png",
        alt: "LazyBackup backup jobs list",
        caption: "Jobs with cron schedules, destinations, and enable toggles.",
      },
      {
        type: "h2",
        text: "Server → server without babysitting",
      },
      {
        type: "p",
        text: "When both ends are servers, LazyBackup prefers a direct path: it installs an ephemeral SSH key on the destination so the source can rsync straight across. If the source cannot reach the dest, it relays through the LazyBackup host (pull, then push). S3 transfers always relay via the host.",
      },
      {
        type: "img",
        src: "/screenshots/servers.png",
        alt: "LazyBackup servers page",
        caption: "Add hosts, test SSH, and keep keys in one place.",
      },
      {
        type: "h2",
        text: "Schedule, retain, restore",
      },
      {
        type: "p",
        text: "Cron runs in your app timezone. Optional versioning creates timestamped folders; file retention cleans dump-style destinations by age (local, S3, or Bro mailbox). History keeps run status, sizes, and logs. Path, volume, and database restores work from History when the artifact is local, on S3 or Bro, or on an SSH destination with a key—or download the file without restoring in place.",
      },
      {
        type: "img",
        src: "/screenshots/history.png",
        alt: "LazyBackup history page with run logs",
        caption: "History — status, sizes, timestamps, and logs per run.",
      },
      {
        type: "h2",
        text: "Who it’s for",
      },
      {
        type: "ul",
        items: [
          "Homelab and self-hosters who want a UI over ad-hoc rsync scripts",
          "Small teams managing a handful of VPS with Docker and databases",
          "Anyone who wants From → To clarity instead of “backup means pull to this box only”",
        ],
      },
      {
        type: "h2",
        text: "Get it running",
      },
      {
        type: "code",
        lang: "bash",
        code: `docker run -d \\
  --name lazybackup \\
  -p 3000:3000 \\
  -v lazybackup_data:/app/data \\
  -v ./backups:/backups \\
  -v ~/.ssh:/root/.ssh:ro \\
  -e DATABASE_URL=file:/app/data/data.db \\
  ghcr.io/ceneka/lazybackup:latest`,
      },
      {
        type: "callout",
        text: "Open source (MIT) on GitHub. Optional app password locks the UI—no users table, no SaaS signup.",
      },
      {
        type: "p",
        text: "For a hands-on dump walkthrough, see Easily back up a Docker database—logical dumps for Postgres/MySQL/MariaDB, not volume tarballs. Land those dumps on S3/MinIO/R2 in the sequel: Database dumps to S3. To lend encrypted space to a friend, see Share backup space with Bro Space.",
      },
    ],
  },
  {
    slug: "easily-backup-docker-database",
    title: "Easily back up a Docker database",
    description:
      "Use LazyBackup’s database dump source to pull Postgres, MySQL, or MariaDB from a container into a scheduled .sql.gz—without stopping the DB.",
    date: "2026-08-11",
    dateLabel: "Aug 11, 2026",
    readingMinutes: 6,
    tags: ["howto", "docker", "database"],
    cover: {
      src: "/screenshots/db-dump-form.png",
      alt: "New backup form configured as a Postgres database dump from a server",
    },
    body: [
      {
        type: "p",
        text: "Tar’ing a Docker volume is fine for files. For a live database, you want a logical dump: pg_dump or mysqldump while the engine is running. LazyBackup treats that as a first-class source type—Database dump—so you pick the server, the engine, and (optionally) the container, then land a .sql.gz on this host, another server, or S3.",
      },
      {
        type: "callout",
        text: "Prefer Database dump over Docker volume when the data you care about is Postgres, MySQL, or MariaDB. Volume backups are not crash-consistent for live databases.",
      },
      {
        type: "h2",
        text: "What you’ll set up",
      },
      {
        type: "ol",
        items: [
          "A server in LazyBackup with SSH key auth (needed for transfers)",
          "A backup job: From = that server, Source type = Database dump",
          "Client mode: Docker exec (into the DB container) or Native tools on the host",
          "A destination path or S3 prefix, plus a cron schedule",
        ],
      },
      {
        type: "img",
        src: "/screenshots/db-dump-form.png",
        alt: "From server database dump to this host path",
        caption: "From → To with Source type set to Database dump.",
      },
      {
        type: "h2",
        text: "Step 1 — Add the server",
      },
      {
        type: "p",
        text: "Under Servers, add the host where Docker (or the native client) runs. Test the connection. Transfers need SSH key auth; password-only is enough to poke around, not to pull dumps.",
      },
      {
        type: "img",
        src: "/screenshots/servers.png",
        alt: "Servers list in LazyBackup",
        caption: "One SSH endpoint per machine you dump from or push to.",
      },
      {
        type: "h2",
        text: "Step 2 — New backup → Database dump",
      },
      {
        type: "p",
        text: "Create a backup. Set From to Server, pick the host, then change Source type to Database dump. Destination can stay This host (e.g. /backups/…), another server, or S3.",
      },
      {
        type: "ul",
        items: [
          "Engine — PostgreSQL, MySQL, or MariaDB",
          "Client — Native (pg_dump / mysqldump on the host) or Docker exec (into the container)",
          "Credentials — database name, user, password (and host/port for native)",
        ],
      },
      {
        type: "img",
        src: "/screenshots/db-connection.png",
        alt: "Database connection fields for PostgreSQL dump",
        caption: "Engine, client, and credentials. Use Test connection before you rely on cron.",
      },
      {
        type: "h2",
        text: "Docker exec mode (the easy path)",
      },
      {
        type: "p",
        text: "If Postgres/MySQL runs in Docker on that server, choose Client → Docker exec. LazyBackup lists running containers and can fill engine, user, password, and database name from common env vars (POSTGRES_*, MYSQL_*, MARIADB_*). It runs pg_dump or mysqldump inside the container, writes a temp .sql.gz, then transfers that file to your destination—no dump SQL streamed through SSH stdout.",
      },
      {
        type: "code",
        lang: "text",
        code: `From:  Server → Database dump → Docker exec → your DB container
To:    This host / Server / S3 prefix
Out:   something like app_2026-08-11_….sql.gz`,
      },
      {
        type: "h2",
        text: "Step 3 — Schedule and retention",
      },
      {
        type: "p",
        text: "Set a cron expression (runs in the app timezone from Settings). For dump folders, enable file retention so old .sql.gz files age out while you keep a minimum count. Versioning is useful for path trees; for single dump files, retention is usually enough.",
      },
      {
        type: "img",
        src: "/screenshots/history.png",
        alt: "Backup history with successful runs",
        caption: "After a run, History shows status, size, and logs—and restore when you need it.",
      },
      {
        type: "h2",
        text: "Restore later",
      },
      {
        type: "p",
        text: "From History, restore loads the dump into the target engine (local artifact, or pull from S3, Bro, or an SSH destination with a key first). Same idea as the dump: native client or docker exec on the destination side of the restore flow. You can restore onto a different host from the History server picker.",
      },
      {
        type: "h2",
        text: "Quick checklist",
      },
      {
        type: "ul",
        items: [
          "SSH key on the source server",
          "Source type = Database dump (not Docker volume)",
          "Docker exec if the DB lives in a container",
          "Test connection once",
          "Cron + retention so disks don’t fill forever",
        ],
      },
      {
        type: "callout",
        text: "Want off-box storage next? See Database dumps to S3 — same dump source, To = S3 profile (MinIO, R2, B2, or AWS).",
      },
    ],
  },
  {
    slug: "failure-webhooks-discord-ntfy-kuma",
    title: "Failure webhooks: Discord, ntfy, and Uptime Kuma",
    description:
      "Wire LazyBackup’s backup.failed webhook to Discord, ntfy, or an Uptime Kuma push monitor—using the built-in presets and {{tag}} templates.",
    date: "2026-08-12",
    dateLabel: "Aug 12, 2026",
    readingMinutes: 7,
    tags: ["howto", "webhooks", "ops"],
    cover: {
      src: "/screenshots/settings.png",
      alt: "LazyBackup Settings — where failure webhooks are configured",
    },
    body: [
      {
        type: "p",
        text: "Cron backups fail quietly if nobody is watching History. LazyBackup can POST (or GET) a failure notification when a job ends badly—one URL under Settings → General, optional headers and body templates, and presets for the tools homelab operators already run.",
      },
      {
        type: "callout",
        text: "Empty webhook URL = notifications off. HTTPS is required; http:// is allowed only for localhost / private LAN hosts. Use Send test notification after you paste a preset.",
      },
      {
        type: "h2",
        text: "Where it lives",
      },
      {
        type: "ol",
        items: [
          "Open Settings → General",
          "Find Failure webhook (method, URL, headers, body)",
          "Pick a preset or start from Default JSON",
          "Send test notification, then save",
        ],
      },
      {
        type: "img",
        src: "/screenshots/settings.png",
        alt: "LazyBackup Settings page",
        caption: "Settings holds the webhook URL once for the whole instance—not per backup.",
      },
      {
        type: "h2",
        text: "Tags you can use",
      },
      {
        type: "p",
        text: "URL, headers, and body support {{tag}} placeholders. Unknown tags are left as-is. In URLs, values are URI-encoded so query strings stay valid.",
      },
      {
        type: "ul",
        items: [
          "{{event}} — always backup.failed for this path",
          "{{backupName}} — job name (may be empty)",
          "{{configId}} / {{historyId}} — IDs for deep links or log correlation",
          "{{errorMessage}} — failure text from the run",
          "{{endedAt}} — ISO timestamp",
        ],
      },
      {
        type: "p",
        text: "If the body template is empty on POST/PUT, LazyBackup sends the built-in JSON payload:",
      },
      {
        type: "code",
        lang: "json",
        code: `{
  "event": "backup.failed",
  "backupName": "Daily DB",
  "configId": "…",
  "historyId": "…",
  "errorMessage": "…",
  "endedAt": "2026-08-12T12:00:00.000Z"
}`,
      },
      {
        type: "h2",
        text: "Discord",
      },
      {
        type: "p",
        text: "Create an Incoming Webhook in your Discord channel (Channel settings → Integrations → Webhooks). In LazyBackup, choose the Discord preset and paste that URL.",
      },
      {
        type: "code",
        lang: "text",
        code: `Method: POST
URL:    https://discord.com/api/webhooks/ID/TOKEN
Header: Content-Type: application/json`,
      },
      {
        type: "p",
        text: "Preset body (you can edit the content string):",
      },
      {
        type: "code",
        lang: "json",
        code: `{
  "content": "**Backup failed:** {{backupName}}\\n\`\`\`{{errorMessage}}\`\`\`\\n_History:_ \`{{historyId}}\` · {{endedAt}}"
}`,
      },
      {
        type: "h2",
        text: "ntfy",
      },
      {
        type: "p",
        text: "ntfy is a simple topic publish. Use the public ntfy.sh service or your own server. The preset sets Title / Priority / Tags headers and a plain-text body.",
      },
      {
        type: "code",
        lang: "text",
        code: `Method:  POST
URL:     https://ntfy.sh/your-topic
Headers:
  Title: LazyBackup failure
  Priority: high
  Tags: warning,backup
Body:    {{backupName}}: {{errorMessage}}`,
      },
      {
        type: "p",
        text: "For a private topic, add an Authorization header (or ntfy’s token header) in the headers field—line format Name: value, or a JSON object.",
      },
      {
        type: "h2",
        text: "Uptime Kuma push monitor",
      },
      {
        type: "p",
        text: "Create a Push monitor in Kuma and copy the push URL. The Kuma preset uses GET with status=down and the error in msg—so a failed backup flips the monitor down with context.",
      },
      {
        type: "code",
        lang: "text",
        code: `Method: GET
URL:    https://kuma.example.com/api/push/TOKEN?status=down&msg={{errorMessage}}&ping=
Body:   (unused for GET)`,
      },
      {
        type: "callout",
        text: "This fires only on failure—it does not heartbeat on success. Pair with Kuma’s own push heartbeat (or an external cron ping) if you need “backup didn’t run” detection, not just “backup failed.”",
      },
      {
        type: "h2",
        text: "Also in the preset list",
      },
      {
        type: "ul",
        items: [
          "Telegram — Bot API sendMessage; replace BOT_TOKEN and CHAT_ID",
          "Slack — Incoming webhook with a text field",
          "Default JSON — empty body template → built-in backup.failed object",
        ],
      },
      {
        type: "h2",
        text: "Quick checklist",
      },
      {
        type: "ul",
        items: [
          "HTTPS URL (or LAN http)",
          "Preset that matches your tool, then replace placeholders",
          "Send test notification before you trust cron",
          "Status posture will nag if webhooks are still empty—optional but useful",
        ],
      },
      {
        type: "callout",
        text: "One webhook for the instance. When a job fails, LazyBackup fills the tags and fires—Discord channel, phone via ntfy, or a red Kuma monitor.",
      },
    ],
  },
  {
    slug: "database-dumps-to-s3",
    title: "Database dumps to S3 (MinIO, R2, B2)",
    description:
      "Sequel to the Docker database guide: land Postgres/MySQL/MariaDB .sql.gz dumps on S3-compatible storage—MinIO, Cloudflare R2, Backblaze B2, or AWS.",
    date: "2026-08-12",
    dateLabel: "Aug 12, 2026",
    readingMinutes: 6,
    tags: ["howto", "database", "s3"],
    cover: {
      src: "/screenshots/db-dump-form.png",
      alt: "Database dump backup form — destination can be an S3 profile",
    },
    body: [
      {
        type: "p",
        text: "The Docker database post ends with a .sql.gz on this host or another server. Off-box object storage is the usual next step: keep dumps off the app VPS, version them cheaply, and restore by downloading first. LazyBackup treats S3-compatible profiles as first-class To endpoints—same database dump source, different destination.",
      },
      {
        type: "callout",
        text: "Start from Easily back up a Docker database if you still need the dump source wired. This post assumes you can already produce a logical dump; we only change where it lands.",
      },
      {
        type: "h2",
        text: "Step 1 — Add an S3 profile",
      },
      {
        type: "p",
        text: "Open S3 Profiles → New. Fill endpoint, region, bucket, access key, and secret. For MinIO, Cloudflare R2, and Backblaze B2, enable path-style (forcePathStyle) when the provider expects it—LazyBackup’s form exposes that toggle.",
      },
      {
        type: "ul",
        items: [
          "MinIO — your https://minio.example.com (or :9000) endpoint + path-style",
          "Cloudflare R2 — R2 S3 API endpoint for the account/bucket; path-style as documented by Cloudflare",
          "Backblaze B2 — S3-compatible endpoint for the bucket’s region",
          "AWS S3 — standard regional endpoint; path-style usually off",
        ],
      },
      {
        type: "p",
        text: "Use Test connection on the profile before you point jobs at it. Secrets never come back in GET responses—leave the secret blank on edit to keep the stored value.",
      },
      {
        type: "h2",
        text: "Step 2 — Database dump → S3 prefix",
      },
      {
        type: "p",
        text: "Create or edit a backup. Keep Source type = Database dump (Postgres / MySQL / MariaDB; native or Docker exec). Set To → S3, pick the profile, and choose a prefix (destination path field)—for example backups/app-db/ or prod/postgres/.",
      },
      {
        type: "img",
        src: "/screenshots/db-dump-form.png",
        alt: "Database dump From → To form",
        caption: "Same dump form as the Docker guide—switch To from This host to an S3 profile.",
      },
      {
        type: "code",
        lang: "text",
        code: `From:  Server (or local) → Database dump → .sql.gz
To:    S3 profile → prefix e.g. backups/app-db/
Relay: always via the LazyBackup host (upload after dump)`,
      },
      {
        type: "p",
        text: "S3 transfers always relay through the LazyBackup host: dump to a temp file, then upload. There is no direct server→bucket pipe that skips the host.",
      },
      {
        type: "h2",
        text: "Step 3 — Retention and encryption",
      },
      {
        type: "ul",
        items: [
          "File retention — age + min-keep on the destination prefix so old dumps are deleted from the bucket",
          "Versioning — timestamped sub-prefixes if you prefer snapshot folders over flat dump files",
          "age encryption — optional enableEncryption so the object is ciphertext before upload (needs an active key in Settings → Encryption)",
        ],
      },
      {
        type: "p",
        text: "Validate before run is useful here: it probes SSH/DB and the S3 profile without uploading a dump. Open the backup detail → Validate; the last result sticks until you edit the job.",
      },
      {
        type: "img",
        src: "/screenshots/history.png",
        alt: "Backup history after a successful dump",
        caption: "History stores artifactPath as s3://bucket/key when the dump landed on object storage.",
      },
      {
        type: "h2",
        text: "Restore from S3",
      },
      {
        type: "p",
        text: "From History → Restore on a successful database run, LazyBackup downloads the artifact from S3 first, then pipes into psql/mysql (native or docker exec). Encrypted .age objects decrypt with vault identities automatically.",
      },
      {
        type: "h2",
        text: "Quick checklist",
      },
      {
        type: "ul",
        items: [
          "S3 profile tested (endpoint, bucket, keys, path-style if needed)",
          "Source = Database dump (not a volume tarball)",
          "To = S3 + prefix you’re happy to retain/delete",
          "Validate once, then cron + retention",
          "Optional: age encrypt before land; failure webhook if the upload path breaks",
        ],
      },
      {
        type: "callout",
        text: "Same From → To model: dump on the source, land on MinIO/R2/B2/AWS. No custom sync script—just a profile and a prefix.",
      },
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug);
}

export function getAllPosts(): BlogPost[] {
  return [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));
}
