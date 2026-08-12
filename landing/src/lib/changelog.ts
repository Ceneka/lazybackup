export type ChangelogSection = {
  heading: string;
  items: readonly string[];
};

export type ChangelogEntry = {
  id: string;
  title: string;
  date: string;
  intro?: string;
  sections: readonly ChangelogSection[];
};

/** Mirrors repo root CHANGELOG.md for the static landing export. */
export const changelogEntries: readonly ChangelogEntry[] = [
  {
    id: "unreleased",
    title: "Unreleased",
    date: "main",
    intro:
      "Growth-site updates plus reliability work already on main. Formal v* tags will fold these into dated release sections.",
    sections: [
      {
        heading: "Added",
        items: [
          "Landing /compare — LazyBackup vs rsync/cron, with short notes on Restic, Borg, and Duplicati (control plane wedge, not a dedup archive CLI).",
          "Landing /changelog — user-facing release notes mirrored from CHANGELOG.md.",
          "Home MCP demo callout linking to the manage-backups-with-mcp blog post.",
          "Screenshot gallery slots for Status, Encryption (age vault), API/MCP, S3 profiles, and Bro Space.",
        ],
      },
      {
        heading: "Reliability",
        items: [
          "CI runs tests and build before GHCR publish; Alpine/musl checks in the image pipeline.",
          "Concurrent-run lock so the same backup config cannot overlap itself.",
          "Failure webhooks with method, headers, and {{tag}} templates.",
          "Backup validate probes without transferring data; results persist on the config.",
          "Secret redaction on server, S3, and backup API responses.",
        ],
      },
      {
        heading: "Product surface (recent main)",
        items: [
          "Age encryption vault, Bro Space peers, instance meta-backup, WebAuthn passkeys, Status posture page.",
          "S3-compatible endpoints, database dumps, MCP + API tokens with optional remote_exec.",
        ],
      },
    ],
  },
] as const;
