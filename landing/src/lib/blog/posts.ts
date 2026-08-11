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
          "Docker volumes — pack a named volume on a source server to .tar.gz",
          "Databases — Postgres / MySQL / MariaDB logical dumps to .sql.gz",
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
        text: "Cron runs in your app timezone. Optional versioning creates timestamped folders; file retention cleans dump-style destinations by age. History keeps run status, sizes, and logs. Volume and database restores work from a local artifact—or download from S3 first.",
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
        text: "Next up on the blog: how to back up a Postgres (or MySQL) database running in Docker in a few clicks—logical dumps, not volume tarballs.",
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
        text: "From History, restore loads the .sql.gz into the target engine (local artifact, or download from S3 first). Same idea as the dump: native client or docker exec on the destination side of the restore flow.",
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
        text: "Deploy LazyBackup with Docker, add the server, create one Database dump job—and you have scheduled logical backups without a custom shell script per box.",
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
