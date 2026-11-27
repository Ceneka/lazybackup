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
    slug: "lazybackup-0-3-0-ui-ux",
    title: "LazyBackup 0.3.0: a UI that tells you what needs attention",
    description:
      "The 0.3.0 UI/UX pass: health at a glance, one-click Pause/Resume, safer restores, navigable history, connection readiness, and settings with an explicit Save.",
    date: "2026-11-21",
    dateLabel: "Nov 21, 2026",
    readingMinutes: 7,
    tags: ["release", "ui", "product"],
    cover: {
      src: "/screenshots/backup-detail.png",
      alt: "Backup detail page with a live Running since banner, a Pause button, and encryption and file-retention rows",
    },
    body: [
      {
        type: "p",
        text: "0.3.0 is an app-wide UI/UX pass. We audited every screen—dashboard, backups, history, connections, settings, dialogs—and fixed roughly 90 issues. The From → To model did not change: same jobs, same artifacts, same history. What changed is what the UI tells you, and how hard it is to do the wrong thing.",
      },
      {
        type: "callout",
        text: "This is a UI release. No database migration, no config rewrite, no new required settings—pull the image and reload.",
      },
      {
        type: "h2",
        text: "Health at a glance",
      },
      {
        type: "p",
        text: "The dashboard now answers the operator question directly: am I protected? It shows the last successful backup, whether schedules are overdue, and a short Needs attention list of jobs that missed their window. If every backup is disabled, an amber banner says nothing will run on schedule. Bro runs still waiting for the peer no longer look like they landed.",
      },
      {
        type: "p",
        text: "Backup cards work at job level. Each card shows the last run—success, failed, running, or Never run—with a relative time, the next run or Paused, and a Validation failed badge when the last check found a problem. The detail page adds a live Running since HH:MM (elapsed) banner with a View log link, plus the encryption, file-retention, and versioning settings without opening the edit form.",
      },
      {
        type: "img",
        src: "/screenshots/dashboard.png",
        alt: "Dashboard with last success, overdue schedules, a Needs attention list, and the backup status chart",
        caption:
          "Dashboard — last success, overdue schedules, and the jobs that need attention.",
      },
      {
        type: "img",
        src: "/screenshots/backups.png",
        alt: "Backup cards showing last-run status, next run, Paused, and Validation failed badges",
        caption:
          "Backup cards — last run, next run or Paused, and a warning when validation failed.",
      },
      {
        type: "img",
        src: "/screenshots/backup-detail.png",
        alt: "Running backup detail with the live Running since banner, Pause button, and encryption and retention rows",
        caption:
          "A running job — live elapsed time, a log link, and the settings that matter without opening Edit.",
      },
      {
        type: "h2",
        text: "Pause and resume without touching the schedule",
      },
      {
        type: "p",
        text: "Schedules stop for maintenance windows, not because you want to rewrite a cron expression. Pause and Resume are one click from the backup detail page or the card’s overflow menu. Pausing keeps the configuration and the last validation result; resuming puts the next run back on the schedule. A paused job shows Paused where the next run would be, so silence is not mistaken for health.",
      },
      {
        type: "h2",
        text: "Safer restores",
      },
      {
        type: "p",
        text: "The restore dialog now shows what you are about to do before the button is live: which run (date and size), the source endpoint, and the target host with the path, database, or volume. For path restores it states the rule plainly: this is a merge, and files at the target that are not in the backup are not deleted. Database restores warn that existing objects may be overwritten or conflict depending on the dump.",
      },
      {
        type: "p",
        text: "If you change the host or target away from the backup’s source, a checkbox appears: I understand this restores to a different host or target than the backup’s source location. Restore stays disabled until you tick it. The run page keeps the result—success or failure, with the log—as an alert, so the outcome does not disappear with the dialog.",
      },
      {
        type: "img",
        src: "/screenshots/restore-dialog.png",
        alt: "Restore dialog with the selected run, From and To endpoints, a merge note, and the restore target field",
        caption:
          "Restore — the run, the endpoints, and the merge rule before anything runs.",
      },
      {
        type: "h2",
        text: "History you can navigate",
      },
      {
        type: "p",
        text: "History filters live in the URL: page, search, status, and date. Press Back from a run and you return to the same filtered view. Quick ranges—Today, 7 days, 30 days—sit next to a day picker and Clear filters. A Statistics page charts runs over time; day boundaries and chart buckets use the app timezone.",
      },
      {
        type: "p",
        text: "Failed runs put the error at the top of the run page instead of burying it in the log. A running run stays current on its detail page. Downloads stream large artifacts instead of buffering them in the browser, encrypted .age files are labelled, and the button no longer leaves a stuck Loading overlay. Bro downloads stop waiting when you leave the page.",
      },
      {
        type: "img",
        src: "/screenshots/history.png",
        alt: "History list with mixed run statuses, search and status filters, and Today, 7 days, and 30 days chips",
        caption:
          "History — filters, quick date ranges, and status at a glance; the view survives Back.",
      },
      {
        type: "img",
        src: "/screenshots/history-detail.png",
        alt: "Failed run detail page with a red error alert at the top and restore controls",
        caption:
          "A failed run — the error is visible before the log, with copy and restore within reach.",
      },
      {
        type: "h2",
        text: "Connection readiness",
      },
      {
        type: "p",
        text: "Password-only servers are called out before a transfer fails: a Password only badge on the card, the SSH key name when one is configured, and a note that path backups need a key. Test connection on an edit page now uses the values currently on screen, not the saved ones, and the result stays visible with a copyable error. Secret fields get show/hide, and the Git form can create an SSH key on the spot.",
      },
      {
        type: "img",
        src: "/screenshots/connections.png",
        alt: "Connections Servers tab with Key and Password only badges and the key name shown on each card",
        caption:
          "Connections → Servers — key state is visible before a job runs.",
      },
      {
        type: "h2",
        text: "Settings that don’t bite",
      },
      {
        type: "p",
        text: "Settings → General now has an explicit Save changes button. Timezone, SSH defaults, and the rest of the General fields wait for it; nothing is applied until you click. Webhook presets fill the form and stop there—review the placeholders, send a test (it uses the values on screen), then click Save webhook settings. One-time values such as a new API token or a Bro invite code now live in a banner above the tabs, so switching tabs does not destroy them. The active tab is in the URL, so a reload stays put.",
      },
      {
        type: "p",
        text: "API tokens now ask for an access level before creation: Read only, Read & write, or Read, write & shell. Nothing is preselected. Existing unrestricted tokens are labelled Full access, so you can see which ones can do everything; read-only tokens are marked and write tools are omitted from their MCP catalog.",
      },
      {
        type: "img",
        src: "/screenshots/mcp-api.png",
        alt: "Settings API tab with the access-level choices and existing tokens labelled Full access and Read only",
        caption:
          "Settings → API — choose the token’s access level before it exists.",
      },
      {
        type: "h2",
        text: "Accessible and keyboard-friendly",
      },
      {
        type: "p",
        text: "The pass was not only cosmetic: a skip-to-content link, labelled controls, status badges that stay readable in light and dark mode, keyboard-operable card menus that flip near the viewport edge, scrollable dialogs, and delete or revoke confirmations that name what is affected.",
      },
      {
        type: "img",
        src: "/screenshots/dashboard-dark.png",
        alt: "Dashboard in dark mode with readable status badges, last success, and the backup status chart",
        caption: "Dark mode — the same health signals, readable badges.",
      },
      {
        type: "h2",
        text: "Upgrading",
      },
      {
        type: "p",
        text: "Pull the release image and recreate the container. There is no database migration and no configuration rewrite; jobs, history, keys, and peers stay where they are.",
      },
      {
        type: "code",
        lang: "bash",
        code: `# pin the release
docker pull ghcr.io/ceneka/lazybackup:v0.3.0

# or track latest
docker pull ghcr.io/ceneka/lazybackup:latest

# compose
docker compose pull && docker compose up -d`,
      },
      {
        type: "p",
        text: "Behavior changes worth knowing on upgrade:",
      },
      {
        type: "ul",
        items: [
          "Settings → General saves only when you click Save changes. Webhook presets only fill the form until you click Save webhook settings.",
          "New API tokens require an access level—Read only, Read & write, or Read, write & shell. Existing unrestricted tokens show as Full access.",
          "Dashboard and History day filters, chart buckets, and scheduled times use the app timezone. Success rate counts finished runs only, so running jobs cannot skew it.",
          "The backup form rejects invalid cron expressions at save time instead of storing a schedule that never runs.",
        ],
      },
      {
        type: "p",
        text: "The full list is in the 0.3.0 section of the changelog.",
      },
    ],
  },
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
      alt: "LazyBackup Settings Encryption tab with an active age key, a retired key, and recovery recipients",
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
        alt: "Encryption settings with an active key, a retired key, and a recovery recipient",
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
      alt: "LazyBackup Settings Bro Space tab with a paired peer and a pending invite",
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
        alt: "Bro Space settings with a paired peer, a pending invite, and the LazyBackup address",
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
      alt: "LazyBackup dashboard with backup health — the same instance agents can manage over MCP",
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
          "Open Settings → API (API tokens & MCP).",
          "Create a token and choose an access level—the plaintext stays in the banner at the top of Settings until you hide it or leave the page.",
          "Revoke anytime from the same list if a laptop or agent is gone.",
        ],
      },
      {
        type: "p",
        text: "Tokens are created with an explicit access level. Read only can inspect, validate_backup, and test_*—it cannot mutate, and write tools are omitted from its MCP catalog. Read & write can create, edit, run, and delete backups and connections but has no remote shell. Read, write & shell adds exec_command and pre-backup commands. Nothing is preselected, and older unrestricted tokens are labelled Full access. Treat write tokens like the app password. Prefer HTTPS, or keep the instance on a trusted LAN.",
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
          "Inspect: list_backups, get_backup, list_history, get_history, get_dashboard, get_status, list_servers, list_s3_profiles",
          "Discover: find_server, list_docker_volumes, list_docker_containers, get_container_db_hints",
          "Probe: validate_backup, test_server, test_database (allowed for read-only tokens)",
          "Operate: run_backup, toggle_backup",
          "Manage: create_backup, update_backup, create_server, update_server",
          "Shell (needs shell access): exec_command",
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
        alt: "LazyBackup dashboard with last success and overdue schedules",
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
        text: "Deploy LazyBackup, open Settings → API, hit Add to Cursor, and ask your agent to manage backups on the box you already trust.",
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
      alt: "LazyBackup dashboard with last successful backup, overdue schedules, and the backup status chart",
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
        alt: "LazyBackup dashboard with last success, overdue schedules, and recent activity",
        caption: "Dashboard — health, last 30 days, storage, and what’s scheduled next.",
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
        alt: "LazyBackup backup cards with last-run status, next run, and Paused badges",
        caption: "Jobs with endpoints, last run, next run (or Paused), and validation warnings.",
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
        alt: "Server detail page with SSH transport details and the key in use",
        caption: "Connections → Servers — add hosts, test SSH, and keep keys in one place.",
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
        type: "p",
        text: "The dashboard and backup cards show the last run, the next run, and anything overdue; pause a schedule in one click when you need to, without rewriting the cron expression.",
      },
      {
        type: "img",
        src: "/screenshots/history.png",
        alt: "LazyBackup history with status filters and quick date ranges",
        caption: "History — status, sizes, logs, and filters that stay in the URL.",
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
        text: "For a hands-on dump walkthrough, see Easily back up a Docker database—logical dumps for Postgres/MySQL/MariaDB, not volume tarballs. Land those dumps on S3/MinIO/R2 in the sequel: Database dumps to S3. To lend encrypted space to a friend, see Share backup space with Bro Space. For the 0.3.0 UI pass—health at a glance, safer restores, and settings with an explicit Save—see LazyBackup 0.3.0: a UI that tells you what needs attention.",
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
      alt: "New backup form configured as a Postgres database dump with a Docker container selected",
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
        alt: "From → To form with Source type set to Database dump and a Docker container picked",
        caption: "From → To with Source type set to Database dump.",
      },
      {
        type: "h2",
        text: "Step 1 — Add the server",
      },
      {
        type: "p",
        text: "Open Connections → Servers and add the host where Docker (or the native client) runs. The card shows a Key or Password only badge and the key name, so a password-only host is flagged before a transfer fails: it can test, but it needs an SSH key to pull dumps.",
      },
      {
        type: "img",
        src: "/screenshots/servers.png",
        alt: "Server detail page with SSH transport details and the key in use",
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
        alt: "Database section with a Test connection result",
        caption: "Engine, client, and credentials. Test connection uses the values on screen and keeps the result visible.",
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
        alt: "Backup history with status filters and quick date ranges",
        caption: "After a run, History shows status, size, and logs—and restore when you need it.",
      },
      {
        type: "h2",
        text: "Restore later",
      },
      {
        type: "p",
        text: "From History, restore loads the dump into the target engine (local artifact, or pull from S3, Bro, or an SSH destination with a key first). The restore dialog shows the run and the target, and the database note warns that existing objects may conflict or be overwritten. Same idea as the dump: native client or docker exec on the destination side of the restore flow. You can restore onto a different host from the Restore onto picker; retargeting asks for an extra confirmation.",
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
        text: "Empty webhook URL = notifications off. HTTPS is required; http:// is allowed only for localhost / private LAN hosts. Presets fill the form only—review the placeholders, send a test, then click Save webhook settings.",
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
          "Pick a preset or start from Default JSON—it fills the form, nothing is saved yet",
          "Send test notification (it uses the values on screen), then click Save webhook settings",
        ],
      },
      {
        type: "img",
        src: "/screenshots/settings.png",
        alt: "Settings → General with the failure webhook section and presets",
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
        text: "Create an Incoming Webhook in your Discord channel (Channel settings → Integrations → Webhooks). In LazyBackup, choose the Discord preset, replace the URL with yours, then Save webhook settings.",
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
        text: "Open Connections → S3 and choose Add S3 profile. Fill endpoint, region, bucket, access key, and secret. For MinIO, Cloudflare R2, and Backblaze B2, enable Force path-style URLs when the provider expects it—LazyBackup’s form exposes that toggle.",
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
        text: "Use Test connection on the profile before you point jobs at it; the result stays on the page with a copyable error. Secrets never come back in GET responses—leave the secret blank on edit to keep the stored value.",
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
        text: "Validate before run is useful here: it probes SSH/DB and the S3 profile without uploading a dump. Open the backup detail → Validate; the last result sticks until you edit the job, and a failed check also shows on the backup card.",
      },
      {
        type: "img",
        src: "/screenshots/history.png",
        alt: "History list with status filters and quick date ranges",
        caption: "History stores artifactPath as s3://bucket/key when the dump landed on object storage.",
      },
      {
        type: "h2",
        text: "Restore from S3",
      },
      {
        type: "p",
        text: "From History → Restore on a successful database run, LazyBackup downloads the artifact from S3 first, then pipes into psql/mysql (native or docker exec). The restore dialog shows the run and target and warns that existing objects may conflict or be overwritten. Encrypted .age objects decrypt with vault identities automatically.",
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
