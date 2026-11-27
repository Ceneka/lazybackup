/**
 * Canonical screenshot list for the landing page.
 *
 * Paths support `{servers.production}`, `{backups.postgres}` and
 * `{history.nginx-failed}` placeholders, filled from the `POST /api/seed`
 * response so this file never needs real database IDs.
 *
 * Run with: see landing/README.md → "Screenshots".
 */

export type ScreenshotTheme = "light" | "dark"

export type ScreenshotViewport = {
  width: number
  height: number
}

export type ScreenshotAction =
  | { type: "click"; text?: string; selector?: string }
  | { type: "fill"; selector: string; value: string }
  | { type: "select"; selector: string; value: string }
  | {
      type: "scrollTo"
      selector?: string
      text?: string
      block?: "start" | "center" | "end" | "nearest"
    }
  | { type: "waitForText"; text: string; timeoutMs?: number }
  | { type: "waitForSelector"; selector: string; timeoutMs?: number }
  | { type: "scrollToY"; y: number }
  | { type: "replaceOrigin"; value: string }
  | { type: "wait"; ms: number }

export type ScreenshotSpec = {
  /** File name under landing/public/screenshots. */
  file: string
  /** App path, with optional seed-id placeholders. */
  path: string
  /** Defaults to light. */
  theme?: ScreenshotTheme
  /** Defaults to 1440×900. */
  viewport?: ScreenshotViewport
  /** Visible text that proves the page (not a spinner) is ready. */
  waitFor?: string
  /** CSS selector to wait for instead of / in addition to text. */
  waitForSelector?: string
  /** Keep a toast on screen (e.g. the database test result). */
  allowToast?: boolean
  actions?: ScreenshotAction[]
}

const DESKTOP: ScreenshotViewport = { width: 1440, height: 900 }
const FORM: ScreenshotViewport = { width: 984, height: 974 }

export const SCREENSHOTS: ScreenshotSpec[] = [
  {
    file: "dashboard.png",
    path: "/",
    waitFor: "Backup status",
  },
  {
    file: "dashboard-dark.png",
    path: "/",
    theme: "dark",
    waitFor: "Backup status",
  },
  {
    file: "status.png",
    path: "/status",
    waitFor: "Checklist",
  },
  {
    file: "backups.png",
    path: "/backups",
    waitFor: "Backup Configurations",
  },
  {
    file: "backup-detail.png",
    path: "/backups/{backups.wordpress}",
    waitFor: "Running since",
  },
  {
    file: "backup-form.png",
    path: "/backups/new?recipe=server-path-local",
    waitFor: "Transfer",
    actions: [
      { type: "fill", selector: "#name", value: "WordPress site" },
      {
        type: "select",
        selector: "#from-server-select",
        value: "{servers.production}",
      },
      { type: "fill", selector: "#from-path", value: "/var/www/html" },
      { type: "click", selector: "#to-s3" },
      {
        type: "waitForSelector",
        selector: '#to-s3-select option[value]:not([value=""])',
        timeoutMs: 10_000,
      },
      { type: "select", selector: "#to-s3-select", value: "{s3.minio}" },
      { type: "fill", selector: "#to-path", value: "prod/wordpress/" },
      { type: "waitForText", text: "Daily at 02:00" },
    ],
  },
  {
    file: "db-dump-form.png",
    path: "/backups/{backups.postgres}/edit",
    viewport: FORM,
    waitFor: "Database connection",
    actions: [
      { type: "scrollTo", selector: "#db-container", block: "center" },
    ],
  },
  {
    file: "db-connection.png",
    path: "/backups/{backups.postgres}/edit",
    viewport: FORM,
    waitFor: "Database connection",
    allowToast: true,
    actions: [
      { type: "scrollTo", selector: "#db-container", block: "center" },
      { type: "click", text: "Test connection" },
      { type: "waitForText", text: "Database connection OK", timeoutMs: 8000 },
    ],
  },
  {
    file: "history.png",
    path: "/history",
    waitFor: "Backup History",
  },
  {
    file: "history-detail.png",
    path: "/history/{history.nginx-failed}",
    waitFor: "Backup failed",
  },
  {
    file: "restore-dialog.png",
    path: "/history/{history.wordpress-success}",
    waitFor: "Backup Details",
    actions: [
      { type: "click", text: "Restore path" },
      { type: "waitForText", text: "Restore path tree?" },
    ],
  },
  {
    file: "connections.png",
    path: "/connections?tab=servers",
    waitFor: "Bootstrap key (ed25519)",
  },
  {
    file: "servers.png",
    path: "/servers/{servers.production}/test",
    waitFor: "Connection OK",
  },
  {
    file: "s3-profiles.png",
    path: "/connections?tab=s3",
    waitFor: "MinIO · homelab",
  },
  {
    file: "settings.png",
    path: "/settings?tab=general",
    waitFor: "General Settings",
  },
  {
    file: "encryption.png",
    path: "/settings?tab=encryption",
    waitFor: "Primary 2026",
    actions: [
      { type: "scrollToY", y: 300 },
    ],
  },
  {
    file: "mcp-api.png",
    path: "/settings?tab=mcp",
    waitFor: "Claude Desktop",
    actions: [
      { type: "scrollToY", y: 0 },
      { type: "replaceOrigin", value: "https://lazybackup.example.com" },
    ],
  },
  {
    file: "bro-space.png",
    path: "/settings?tab=bro",
    waitFor: "Basement NAS · bro",
    actions: [
      { type: "scrollTo", text: "Basement NAS · bro", block: "center" },
    ],
  },
]

export const SCREENSHOT_VIEWPORT = DESKTOP
