#!/usr/bin/env bun
/**
 * Capture the landing screenshots from a running LazyBackup dev instance.
 *
 *   1. Start the app on a disposable DB (see landing/README.md → Screenshots).
 *   2. cd landing && BASE_URL=http://localhost:3917 bunx --package playwright -- \
 *        sh -c 'NODE_PATH="$(dirname "$(dirname "$(command -v playwright)")")" \
 *                bun scripts/capture-screenshots.ts'
 *
 * The script seeds fake demo data via POST /api/seed, dismisses the first-run
 * auth prompt (Skip), mocks only the probes that would otherwise hit fake
 * hosts, and writes viewport-sized PNGs into landing/public/screenshots.
 */
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { chromium, type Browser, type BrowserContext, type Page } from "playwright"
import {
  SCREENSHOTS,
  SCREENSHOT_VIEWPORT,
  type ScreenshotAction,
  type ScreenshotSpec,
  type ScreenshotTheme,
} from "./screenshots.config"

const BASE_URL = (process.env.BASE_URL || "http://localhost:3917").replace(/\/+$/, "")
const OUT_DIR = path.resolve(import.meta.dir, "..", "public", "screenshots")
/** App password set on the disposable instance so Status shows a protected install. */
const DEMO_PASSWORD = process.env.SHOTS_PASSWORD || "lazybackup-demo-screenshots"
/** Path shown instead of the disposable BACKUP_STORAGE_PATH (Docker default). */
const DISPLAY_STORAGE_ROOT = process.env.DISPLAY_STORAGE_ROOT || "/backups"
const ONLY = (process.env.SHOTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)

type SeedResult = {
  servers: number
  backups: number
  history: number
  sshKeys: number
  ids: {
    servers: Record<string, string>
    backups: Record<string, string>
    history: Record<string, string>
    peers: Record<string, string>
    s3: Record<string, string>
    git: Record<string, string>
  }
}

type SeedIds = SeedResult["ids"]

function log(message: string): void {
  console.log(`[screenshots] ${message}`)
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`)
      if (response.ok) return
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`LazyBackup did not answer at ${BASE_URL}/api/health within 120s`)
}

async function seedDemoData(cookie: string): Promise<SeedResult> {
  const response = await fetch(`${BASE_URL}/api/seed`, {
    method: "POST",
    headers: { cookie },
  })
  if (!response.ok) {
    throw new Error(`POST /api/seed failed: ${response.status} ${await response.text()}`)
  }
  const data = (await response.json()) as SeedResult
  if (!data.ids?.backups || !data.ids?.servers || !data.ids?.history) {
    throw new Error("POST /api/seed did not return ids")
  }
  log(
    `seeded ${data.servers} servers, ${data.backups} backups, ${data.history} history rows`
  )
  return data
}

/**
 * Lock the disposable instance with DEMO_PASSWORD (first run) and return a
 * session cookie. Reruns on the same DB just log in again.
 */
async function ensureSession(): Promise<{ name: string; value: string }> {
  const status = (await fetch(`${BASE_URL}/api/auth/status`).then((r) => r.json())) as {
    authEnabled?: boolean
    hasPassword?: boolean
  }
  if (!status.authEnabled) {
    const setup = await fetch(`${BASE_URL}/api/auth/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: DEMO_PASSWORD }),
    })
    if (!setup.ok) {
      throw new Error(`POST /api/auth/setup failed: ${setup.status} ${await setup.text()}`)
    }
    log("locked the disposable instance with the demo app password")
  }
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DEMO_PASSWORD }),
  })
  if (!login.ok) {
    throw new Error(
      `Login failed (${login.status}). Use a disposable DB, or set SHOTS_PASSWORD to its app password.`
    )
  }
  const setCookie = login.headers.get("set-cookie") || ""
  const match = /^([^=;\s]+)=([^;]*)/.exec(setCookie)
  if (!match) throw new Error("Login did not return a session cookie")
  return { name: match[1], value: match[2] }
}

async function fetchStorageRoot(cookie: string): Promise<string | null> {
  const response = await fetch(`${BASE_URL}/api/backups/storage-root`, {
    headers: { cookie },
  })
  if (!response.ok) return null
  const data = (await response.json()) as { storageRoot?: string }
  return data.storageRoot || null
}

/** Replace `from` with `to` in visible text and input values (screenshot-only). */
async function replaceText(page: Page, from: string, to: string): Promise<void> {
  if (!from || from === to) return
  await page.evaluate(
    ({ from, to }) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        if (node.nodeValue?.includes(from)) {
          node.nodeValue = node.nodeValue.split(from).join(to)
        }
        node = walker.nextNode()
      }
      for (const input of Array.from(document.querySelectorAll("input, textarea"))) {
        const field = input as HTMLInputElement
        if (field.value.includes(from)) field.value = field.value.split(from).join(to)
        if (field.placeholder?.includes(from)) {
          field.placeholder = field.placeholder.split(from).join(to)
        }
      }
    },
    { from, to }
  )
}

let storageRootToMask: string | null = null
let sessionCookie: { name: string; value: string } | null = null

function resolveTemplate(value: string, ids: SeedIds): string {
  return value.replace(/\{([a-z0-9]+)\.([A-Za-z0-9_-]+)\}/g, (match, group: string, key: string) => {
    const bucket = ids[group as keyof SeedIds]
    const resolved = bucket?.[key]
    if (!resolved) {
      throw new Error(`Unknown screenshot placeholder ${match}`)
    }
    return resolved
  })
}

async function installNetworkMocks(context: BrowserContext): Promise<void> {
  const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  })

  // Fake hosts cannot answer Docker/SSH probes; return plausible demo results.
  await context.route(/\/api\/servers\/[^/]+\/docker\/containers(\?.*)?$/, (route) =>
    route.fulfill(json({ containers: ["app-postgres", "app-redis", "app-worker"] }))
  )
  await context.route(/\/api\/servers\/[^/]+\/docker\/volumes(\?.*)?$/, (route) =>
    route.fulfill(json({ volumes: ["app_uploads", "app_redis_data", "app_postgres_data"] }))
  )
  await context.route(/\/api\/servers\/[^/]+\/test(\?.*)?$/, (route) =>
    route.fulfill(
      json({
        success: true,
        rsyncAvailable: true,
        scpAvailable: true,
        dockerAvailable: true,
        authType: "key",
        message: "Connected as deploy in 42 ms.",
      })
    )
  )
  await context.route(/\/api\/backups\/database\/test(\?.*)?$/, (route) =>
    route.fulfill(json({ success: true, result: "1" }))
  )
  // Keep Settings from blocking on a GitHub update check.
  await context.route(/\/api\/version(\?.*)?$/, (route) =>
    route.fulfill(
      json({
        current: "0.3.0",
        latest: "0.3.0",
        htmlUrl: null,
        updateAvailable: false,
        status: "ok",
        checkedAt: new Date().toISOString(),
      })
    )
  )
}

async function newContext(browser: Browser, theme: ScreenshotTheme): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: SCREENSHOT_VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: theme,
    reducedMotion: "reduce",
  })
  await context.addInitScript((nextTheme: string) => {
    try {
      localStorage.setItem("theme", nextTheme)
    } catch {
      // Storage unavailable — the class below still colors the page.
    }
    document.documentElement.classList.toggle("dark", nextTheme === "dark")
    document.documentElement.style.colorScheme = nextTheme
  }, theme)
  await installNetworkMocks(context)
  if (sessionCookie) {
    const url = new URL(BASE_URL)
    await context.addCookies([
      { name: sessionCookie.name, value: sessionCookie.value, domain: url.hostname, path: "/" },
    ])
  }
  return context
}

async function dismissFirstRun(page: Page, timeoutMs = 2500): Promise<void> {
  const skip = page.getByRole("button", { name: "Skip", exact: true })
  try {
    await skip.waitFor({ state: "visible", timeout: timeoutMs })
  } catch {
    return
  }
  log("dismissing first-run auth prompt (Skip)")
  await skip.click()
  await clearToasts(page)
}

/** Hide the Next.js dev-tools bubble; it must never appear in marketing shots. */
async function hideDevIndicators(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "nextjs-portal { display: none !important; }",
  })
}

async function clearToasts(page: Page, timeoutMs = 9000): Promise<void> {
  const toast = page.locator("[data-sonner-toast]")
  try {
    if ((await toast.count()) === 0) return
    await toast.first().waitFor({ state: "detached", timeout: timeoutMs })
  } catch {
    // Toasts auto-dismiss; never fail a shot over one that is still fading.
  }
}

async function findToastErrors(page: Page): Promise<string[]> {
  return page.locator("[data-sonner-toast][data-type='error']").allInnerTexts()
}

async function runAction(page: Page, action: ScreenshotAction, ids: SeedIds): Promise<void> {
  switch (action.type) {
    case "fill": {
      await page.locator(action.selector).first().fill(resolveTemplate(action.value, ids))
      return
    }
    case "select": {
      await page
        .locator(action.selector)
        .first()
        .selectOption(resolveTemplate(action.value, ids))
      return
    }
    case "click": {
      if (action.selector) {
        await page.locator(action.selector).first().click()
        return
      }
      if (!action.text) throw new Error("click action needs text or selector")
      const button = page.getByRole("button", { name: action.text, exact: false }).first()
      if ((await button.count()) > 0) {
        await button.click()
        return
      }
      await page.getByText(action.text, { exact: false }).first().click()
      return
    }
    case "scrollTo": {
      const target = action.selector
        ? page.locator(action.selector).first()
        : page.getByText(action.text ?? "", { exact: false }).first()
      await target.waitFor({ state: "attached" })
      await target.evaluate(
        (element, block) => element.scrollIntoView({ block, inline: "nearest" }),
        action.block ?? "center"
      )
      return
    }
    case "waitForText": {
      await page
        .getByText(action.text, { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: action.timeoutMs ?? 30_000 })
      return
    }
    case "waitForSelector": {
      await page
        .locator(action.selector)
        .first()
        .waitFor({ state: "attached", timeout: action.timeoutMs ?? 30_000 })
      return
    }
    case "scrollToY": {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "auto" }), action.y)
      return
    }
    case "replaceOrigin": {
      // Screenshot-only polish: show the demo host instead of localhost in
      // copyable MCP snippets. The app itself is untouched.
      await replaceText(page, new URL(page.url()).origin, action.value)
      return
    }
    case "wait": {
      await page.waitForTimeout(action.ms)
      return
    }
  }
}

async function captureShot(
  browser: Browser,
  spec: ScreenshotSpec,
  ids: SeedIds,
  contexts: Map<ScreenshotTheme, BrowserContext>
): Promise<void> {
  const theme = spec.theme ?? "light"
  const context = contexts.get(theme)
  if (!context) throw new Error(`No browser context for theme ${theme}`)

  const page = await context.newPage()
  const viewport = spec.viewport ?? SCREENSHOT_VIEWPORT
  await page.setViewportSize(viewport)
  const target = `${BASE_URL}${resolveTemplate(spec.path, ids)}`

  try {
    log(`→ ${spec.file} (${viewport.width}×${viewport.height}, ${theme})`)
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 })
    await hideDevIndicators(page)
    await dismissFirstRun(page, 1500)

    if (spec.waitFor) {
      await page
        .getByText(spec.waitFor, { exact: false })
        .first()
        .waitFor({ state: "visible", timeout: 60_000 })
    }
    if (spec.waitForSelector) {
      await page
        .locator(spec.waitForSelector)
        .first()
        .waitFor({ state: "visible", timeout: 60_000 })
    }
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {})

    for (const action of spec.actions ?? []) {
      await runAction(page, action, ids)
      await page.waitForTimeout(150)
    }

    // Let React Query repaint and transient dev/navigation chrome settle.
    await page
      .waitForFunction(() => !document.querySelector('[aria-label="Loading page"]'), null, {
        timeout: 5000,
      })
      .catch(() => {})
    await page.waitForTimeout(700)
    if (!spec.allowToast) {
      const errors = await findToastErrors(page)
      if (errors.length > 0) {
        throw new Error(`error toast on ${spec.file}: ${errors.join(" | ")}`)
      }
      await clearToasts(page)
    }

    // The disposable BACKUP_STORAGE_PATH is a scratch dir; show the Docker
    // default instead so shots match a real install.
    if (storageRootToMask) {
      await replaceText(page, storageRootToMask, DISPLAY_STORAGE_ROOT)
    }

    await page.evaluate(() => document.fonts.ready)
    await mkdir(OUT_DIR, { recursive: true })
    await page.screenshot({
      path: path.join(OUT_DIR, spec.file),
      type: "png",
      animations: "disabled",
      fullPage: false,
    })
    log(`  wrote ${path.join("landing/public/screenshots", spec.file)}`)
  } finally {
    await page.close()
  }
}

async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true })
  } catch (bundledError) {
    // The bunx Playwright build may expect a newer browser than the cache has.
    // Fall back to a local Chrome/Chromium, which renders identically here.
    const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    const candidates = [
      explicit,
      typeof Bun !== "undefined" ? Bun.which("google-chrome") : null,
      typeof Bun !== "undefined" ? Bun.which("google-chrome-stable") : null,
      typeof Bun !== "undefined" ? Bun.which("chromium") : null,
      typeof Bun !== "undefined" ? Bun.which("chromium-browser") : null,
    ].filter((value): value is string => Boolean(value))

    for (const executablePath of candidates) {
      try {
        log(`bundled Chromium unavailable — using ${executablePath}`)
        return await chromium.launch({
          headless: true,
          executablePath,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        })
      } catch {
        // try the next executable
      }
    }
    throw bundledError
  }
}

async function main(): Promise<void> {
  const selected = ONLY.length
    ? SCREENSHOTS.filter((spec) => ONLY.includes(spec.file.replace(/\.png$/, "")))
    : SCREENSHOTS
  if (selected.length === 0) {
    throw new Error(`No screenshots matched SHOTS=${ONLY.join(",")}`)
  }

  await waitForServer()
  const session = await ensureSession()
  sessionCookie = session
  const cookieHeader = `${session.name}=${session.value}`
  const seed = await seedDemoData(cookieHeader)
  storageRootToMask = await fetchStorageRoot(cookieHeader)

  const browser = await launchBrowser()
  const contexts = new Map<ScreenshotTheme, BrowserContext>()

  try {
    contexts.set("light", await newContext(browser, "light"))
    contexts.set("dark", await newContext(browser, "dark"))

    const failures: string[] = []
    for (const spec of selected) {
      let lastError: unknown = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await captureShot(browser, spec, seed.ids, contexts)
          lastError = null
          break
        } catch (error) {
          lastError = error
          if (attempt === 0) {
            log(`  retrying ${spec.file} once after: ${error instanceof Error ? error.message : error}`)
            await new Promise((resolve) => setTimeout(resolve, 1200))
          }
        }
      }
      if (lastError) {
        const message = lastError instanceof Error ? lastError.message : String(lastError)
        failures.push(`${spec.file}: ${message}`)
        log(`  FAILED ${spec.file}: ${message}`)
      }
    }

    if (failures.length > 0) {
      throw new Error(`${failures.length} screenshot(s) failed:\n${failures.join("\n")}`)
    }
    log(`done — ${selected.length} PNG(s) in ${OUT_DIR}`)
  } finally {
    for (const context of contexts.values()) {
      await context.close().catch(() => {})
    }
    await browser.close().catch(() => {})
  }
}

await main()
