import { describe, expect, test } from "bun:test";
import {
  bulletsFromCommits,
  bumpPackageVersion,
  cutChangelog,
  extractChangelogSection,
  isSkippedSubject,
  subjectAlreadyDocumented,
} from "./cut-release";

const SAMPLE = `# Changelog

Intro paragraph.

## [Unreleased]

### Added

- **Path-tree one-click restore** — History → Restore for path backups.

## Tagging practice

1. Cut with bun run release.

[Unreleased]: https://github.com/Ceneka/lazybackup/compare/main...HEAD
`;

describe("isSkippedSubject", () => {
  test("drops chore/ci/test and release bumps", () => {
    expect(isSkippedSubject("chore: bump landing Next.js to 15.5.23")).toBe(
      true,
    );
    expect(isSkippedSubject("ci: publish GHCR from CI")).toBe(true);
    expect(isSkippedSubject("Release v0.2.0")).toBe(true);
    expect(isSkippedSubject("")).toBe(true);
  });

  test("keeps user-facing subjects", () => {
    expect(
      isSkippedSubject("Add native SQLite dumps as a first-class database engine"),
    ).toBe(false);
    expect(isSkippedSubject("fix: unblock Next typecheck")).toBe(false);
  });
});

describe("subjectAlreadyDocumented", () => {
  test("matches a distinctive prefix already in the notes", () => {
    expect(
      subjectAlreadyDocumented(
        SAMPLE,
        "Add path-tree one-click restore and history list actions",
      ),
    ).toBe(true);
  });

  test("does not match unrelated work", () => {
    expect(
      subjectAlreadyDocumented(SAMPLE, "Allow Docker volume backups from this host"),
    ).toBe(false);
  });
});

describe("bulletsFromCommits", () => {
  test("skips noise and already-documented subjects", () => {
    expect(
      bulletsFromCommits(SAMPLE, [
        "Add path-tree one-click restore and history list actions",
        "chore: bump landing Next.js to 15.5.23",
        "Allow Docker volume backups from this host’s socket",
        "Allow Docker volume backups from this host’s socket",
      ]),
    ).toEqual([
      "- Allow Docker volume backups from this host’s socket.",
    ]);
  });
});

describe("cutChangelog", () => {
  test("promotes Unreleased and appends new commit bullets", () => {
    const next = cutChangelog({
      changelog: SAMPLE,
      version: "0.2.0",
      date: "2026-08-13",
      commitSubjects: [
        "chore: bump landing Next.js to 15.5.23",
        "Allow Docker volume backups from this host’s socket",
      ],
    });

    expect(next).toMatch(/## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-08-13/);
    const released = extractChangelogSection(next, "0.2.0");
    expect(released).toContain("## [0.2.0] - 2026-08-13");
    expect(released).toContain("Path-tree one-click restore");
    expect(released).toContain(
      "- Allow Docker volume backups from this host’s socket.",
    );
    expect(released).not.toContain("chore: bump");
    expect(next).toContain(
      "[Unreleased]: https://github.com/Ceneka/lazybackup/compare/v0.2.0...HEAD",
    );
    expect(next).toContain(
      "[0.2.0]: https://github.com/Ceneka/lazybackup/releases/tag/v0.2.0",
    );
    expect(next).toContain("## Tagging practice");
  });

  test("throws when there is nothing to publish", () => {
    expect(() =>
      cutChangelog({
        changelog: `# Changelog\n\n## [Unreleased]\n\n## Tagging practice\n`,
        version: "0.2.0",
        date: "2026-08-13",
        commitSubjects: ["chore: ignore me"],
      }),
    ).toThrow(/Nothing to release/);
  });
});

describe("extractChangelogSection", () => {
  test("returns null when the version is missing", () => {
    expect(extractChangelogSection(SAMPLE, "0.2.0")).toBeNull();
  });
});

describe("bumpPackageVersion", () => {
  test("replaces only the version field", () => {
    expect(
      bumpPackageVersion(`{\n  "name": "lazybackup",\n  "version": "0.1.0"\n}\n`, "0.2.0"),
    ).toBe(`{\n  "name": "lazybackup",\n  "version": "0.2.0"\n}\n`);
  });
});
