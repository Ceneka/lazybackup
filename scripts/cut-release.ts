/**
 * Cut a versioned release from git history + CHANGELOG.md.
 *
 *   bun run release -- 0.2.0
 *   bun run release -- 0.2.0 --dry-run
 *   bun run release -- notes 0.2.0
 *
 * Promotes [Unreleased] into [X.Y.Z], appends commit subjects since the last
 * v* tag (or since CHANGELOG.md last changed), bumps package.json versions.
 * Does not commit, tag, or push — review the diff, then tag vX.Y.Z and push.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPT_DIR, "..");
export const CHANGELOG_PATH = join(REPO_ROOT, "CHANGELOG.md");

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const SKIP_SUBJECT_RE =
  /^(chore|ci|test|style|refactor|setup)(\(.+\))?:|^initial commit\b/i;

const VERSION_PACKAGES = [
  "package.json",
  "bro/package.json",
  "landing/package.json",
] as const;

export type CutReleaseInput = {
  changelog: string;
  version: string;
  date: string;
  commitSubjects: readonly string[];
};

export function isSkippedSubject(subject: string): boolean {
  const trimmed = subject.trim();
  if (!trimmed) return true;
  if (/^release v?\d+\.\d+\.\d+/i.test(trimmed)) return true;
  return SKIP_SUBJECT_RE.test(trimmed);
}

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const LEADING_VERB_RE =
  /^(?:(?:feat|fix|docs|perf|revert)(?:\(.+\))?:|add|added|fix|fixed|fixes|allow|lets?|make|show|ship|document|publish|return|apply|have|unify|self-host)\s+/i;

export function subjectAlreadyDocumented(
  changelogBody: string,
  subject: string,
): boolean {
  const core = normalizeForMatch(subject).replace(LEADING_VERB_RE, "");
  const needle = core.slice(0, 28);
  if (needle.length < 16) return false;
  return normalizeForMatch(changelogBody).includes(needle);
}

export function bulletsFromCommits(
  changelogBody: string,
  subjects: readonly string[],
): string[] {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const raw of subjects) {
    const subject = raw.trim().replace(/\.+$/, "");
    if (isSkippedSubject(subject)) continue;
    const key = normalizeForMatch(subject);
    if (seen.has(key)) continue;
    seen.add(key);
    if (subjectAlreadyDocumented(changelogBody, subject)) continue;
    bullets.push(`- ${subject}.`);
  }
  return bullets;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractChangelogSection(
  markdown: string,
  version: string,
): string | null {
  const heading = version.toLowerCase() === "unreleased"
    ? /^## \[Unreleased\]\s*$/m
    : new RegExp(
        `^## \\[${escapeRegExp(version)}\\](?:\\s+-\\s+.+)?\\s*$`,
        "m",
      );
  const match = heading.exec(markdown);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  const rest = markdown.slice(start + match[0].length);
  const endMatch = rest.search(/^## |\n\[[^\]]+\]:\s+\S+/m);
  const body = endMatch === -1 ? rest : rest.slice(0, endMatch);
  return (match[0] + body).trim() + "\n";
}

function splitChangelog(markdown: string): {
  header: string;
  unreleased: string;
  rest: string;
} {
  const unreleasedMatch = /^## \[Unreleased\]\s*$/m.exec(markdown);
  if (!unreleasedMatch || unreleasedMatch.index === undefined) {
    throw new Error("CHANGELOG.md is missing an ## [Unreleased] heading");
  }
  const header = markdown.slice(0, unreleasedMatch.index);
  const afterHeading = markdown.slice(
    unreleasedMatch.index + unreleasedMatch[0].length,
  );
  const restMatch = afterHeading.search(/^## /m);
  if (restMatch === -1) {
    return { header, unreleased: afterHeading.trimEnd(), rest: "" };
  }
  return {
    header,
    unreleased: afterHeading.slice(0, restMatch).trimEnd(),
    rest: afterHeading.slice(restMatch),
  };
}

function replaceCompareLink(markdown: string, version: string): string {
  const next = `[Unreleased]: https://github.com/Ceneka/lazybackup/compare/v${version}...HEAD`;
  const versionLink = `[${version}]: https://github.com/Ceneka/lazybackup/releases/tag/v${version}`;
  if (/^\[Unreleased\]:\s+\S+/m.test(markdown)) {
    markdown = markdown.replace(/^\[Unreleased\]:\s+\S+/m, next);
  } else {
    markdown = markdown.trimEnd() + `\n\n${next}\n`;
  }
  if (!new RegExp(`^\\[${version}\\]:\\s+\\S+`, "m").test(markdown)) {
    markdown = markdown.trimEnd() + `\n${versionLink}\n`;
  }
  return markdown;
}

export function cutChangelog(input: CutReleaseInput): string {
  const { header, unreleased, rest } = splitChangelog(input.changelog);
  const existingBody = unreleased.trim();
  const extra = bulletsFromCommits(existingBody, input.commitSubjects);
  const extraBlock = extra.length
    ? `${existingBody ? "\n\n" : "\n"}### Changes\n\n${extra.join("\n")}`
    : "";
  const versionBody = `${existingBody}${extraBlock}`.trim();
  if (!versionBody) {
    throw new Error(
      `Nothing to release for ${input.version}: Unreleased is empty and there are no new commit subjects`,
    );
  }

  const next = `${header}## [Unreleased]\n\n## [${input.version}] - ${input.date}\n\n${versionBody}\n\n${rest}`;
  return replaceCompareLink(next, input.version);
}

export function bumpPackageVersion(jsonText: string, version: string): string {
  if (!/"version"\s*:\s*"[^"]+"/.test(jsonText)) {
    throw new Error("package.json is missing a version field");
  }
  return jsonText.replace(/"version"\s*:\s*"[^"]+"/, `"version": "${version}"`);
}

function git(args: string[], cwd = REPO_ROOT): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout.toString().trim();
}

export function lastVersionTag(cwd = REPO_ROOT): string | null {
  const result = Bun.spawnSync(
    ["git", "describe", "--tags", "--match", "v*", "--abbrev=0"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) return null;
  const tag = result.stdout.toString().trim();
  return tag || null;
}

export function changelogAnchorCommit(cwd = REPO_ROOT): string | null {
  const result = Bun.spawnSync(
    ["git", "log", "-1", "--pretty=%H", "--", "CHANGELOG.md"],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) return null;
  const hash = result.stdout.toString().trim();
  return hash || null;
}

export function commitRangeSinceLastNotes(cwd = REPO_ROOT): string {
  const tag = lastVersionTag(cwd);
  if (tag) return `${tag}..HEAD`;
  const anchor = changelogAnchorCommit(cwd);
  if (anchor) return `${anchor}..HEAD`;
  return "HEAD";
}

export function commitSubjectsSince(range: string, cwd = REPO_ROOT): string[] {
  const log = git(["log", range, "--pretty=%s", "--no-merges"], cwd);
  if (!log) return [];
  return log.split("\n").map((line) => line.trim()).filter(Boolean);
}

function todayDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function printUsage(): never {
  console.error(`Usage:
  bun run release -- <version> [--dry-run]
  bun run release -- notes <version>

Example:
  bun run release -- 0.2.0
  git add CHANGELOG.md package.json bro/package.json landing/package.json
  git commit -m "Release v0.2.0"
  git tag v0.2.0
  git push origin main --tags`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  command: "cut" | "notes";
  version: string;
  dryRun: boolean;
} {
  const dryRun = argv.includes("--dry-run");
  const positional = argv.filter((arg) => arg !== "--dry-run");
  if (positional[0] === "notes") {
    const version = positional[1]?.replace(/^v/, "");
    if (!version || !SEMVER_RE.test(version)) printUsage();
    return { command: "notes", version, dryRun };
  }
  const version = positional[0]?.replace(/^v/, "");
  if (!version || !SEMVER_RE.test(version) || positional.length > 1) {
    printUsage();
  }
  return { command: "cut", version, dryRun };
}

function main(): void {
  const { command, version, dryRun } = parseArgs(process.argv.slice(2));
  const changelog = readFileSync(CHANGELOG_PATH, "utf8");

  if (command === "notes") {
    const section = extractChangelogSection(changelog, version);
    if (!section) {
      console.error(
        `No ## [${version}] section in CHANGELOG.md. Run: bun run release -- ${version}`,
      );
      process.exit(1);
    }
    process.stdout.write(section);
    return;
  }

  const range = commitRangeSinceLastNotes();
  const subjects = commitSubjectsSince(range);
  const nextChangelog = cutChangelog({
    changelog,
    version,
    date: todayDate(),
    commitSubjects: subjects,
  });

  if (dryRun) {
    const section = extractChangelogSection(nextChangelog, version);
    console.log(`# dry-run v${version} (commits ${range})\n`);
    process.stdout.write(section ?? nextChangelog);
    return;
  }

  writeFileSync(CHANGELOG_PATH, nextChangelog);
  for (const relative of VERSION_PACKAGES) {
    const path = join(REPO_ROOT, relative);
    const previous = readFileSync(path, "utf8");
    writeFileSync(path, bumpPackageVersion(previous, version));
  }

  console.log(`Updated CHANGELOG.md and package versions to ${version}.`);
  console.log(`Commit subjects taken from git log ${range}`);
  console.log(`
Next:
  git add CHANGELOG.md package.json bro/package.json landing/package.json
  git commit -m "Release v${version}"
  git tag v${version}
  git push origin main --tags

CI will publish ghcr.io/ceneka/lazybackup:v${version} and open the GitHub Release
from the changelog section. Landing /changelog syncs on the next landing build.`);
}

const invokedDirectly =
  typeof Bun !== "undefined" &&
  Boolean(Bun.main) &&
  fileURLToPath(import.meta.url) === Bun.main;

if (invokedDirectly) {
  main();
}
