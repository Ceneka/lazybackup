import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import path from 'path';

const html = readFileSync(path.join(import.meta.dir, 'ui', 'index.html'), 'utf8');
const setupHtml = html.slice(html.indexOf('<section id="setup"'), html.indexOf('<section id="paired"'));
const pairedHtml = html.slice(html.indexOf('<section id="paired"'), html.indexOf('Your folder backup'));

describe('LazyBro UI — unpaired setup', () => {
  test('is one 3-step card: name, invite, folder after pairing', () => {
    expect(setupHtml).toContain('Set up in 3 steps');
    expect(setupHtml).toContain('Your name');
    expect(setupHtml).toContain('placeholder="e.g. Alex"');
    expect(setupHtml).toContain('Paste the invite your friend sent you');
    expect(setupHtml).toContain('It starts with lb1.');
    expect(setupHtml).toContain('Choose a folder');
    expect(setupHtml).toContain('after you connect');
    expect(setupHtml).toContain('>Connect<');
  });

  test('never defaults the name to the product name', () => {
    expect(setupHtml).not.toContain('value="LazyBro"');
    expect(setupHtml).not.toContain('value="lazybro"');
  });

  test('shows no status grid, autostart prompt, or sync button before pairing', () => {
    expect(setupHtml).not.toContain('not paired yet');
    expect(setupHtml).not.toContain('Space used');
    expect(setupHtml).not.toContain('autostart');
    expect(setupHtml).not.toContain('/api/sync');
  });
});

describe('LazyBro UI — paired state', () => {
  test('renders the hero, usage, progress, and encrypted-files copy', () => {
    expect(pairedHtml).toContain('Connected to ');
    expect(pairedHtml).toContain('Last check-in:');
    expect(pairedHtml).toContain('encrypted');
    expect(pairedHtml).toContain('role="progressbar"');
    expect(html).toContain("You're lending");
    expect(html).toContain('used — ');
    expect(html).toContain('aria-valuetext');
  });

  test('consumes the optional sync classification fields', () => {
    expect(html).toContain('hostReachable');
    expect(html).toContain('authRevoked');
    expect(html).toContain('needsAttention');
    expect(html).toContain("removed this connection");
    expect(html).toContain("we'll keep trying");
    expect(html).toContain('Your folder is full');
    expect(html).toContain('over the limit');
  });

  test('offers folder suggestions, an autostart switch, and a guarded disconnect', () => {
    expect(html).toContain('/api/folders');
    expect(pairedHtml).toContain('Pick a folder with enough free space');
    expect(pairedHtml).toContain('role="switch"');
    expect(pairedHtml).toContain('Start LazyBro when I log in');
    expect(pairedHtml).toContain('Disconnect');
    expect(html).toContain('/api/unpair');
    expect(html).toContain('confirm: true');
    expect(html).toContain('Disconnect first');
  });

  test('humanizes sizes and relative times client-side', () => {
    expect(html).toContain('function formatBytes');
    expect(html).toContain('function timeAgo');
    expect(html).toContain('minutes ago');
  });
});

describe('LazyBro UI — safety', () => {
  test('renders untrusted status fields without innerHTML and authenticates API calls', () => {
    expect(html).not.toContain('.innerHTML');
    expect(html).not.toContain('innerHTML');
    expect(html).toContain('textContent');
    expect(html).toContain('X-LazyBro-Token');
    expect(html).toContain('X-LazyBro-CSRF');
    expect(html).toContain('__LAZYBRO_API_TOKEN__');
  });

  test('keeps the reverse folder-backup API form hidden', () => {
    expect(html).toContain('Your folder backup');
    expect(html).toMatch(/<section[^>]*\bhidden\b[\s\S]{0,120}Your folder backup/);
    expect(html).toContain('/api/backup');
  });

  test('has accessible labels and mobile layout rules', () => {
    expect(html).toContain('for="label"');
    expect(html).toContain('for="invite"');
    expect(html).toContain('for="folderManual"');
    expect(html).toContain('aria-describedby');
    expect(html).toContain('@media (max-width: 460px)');
    expect(html).toContain('prefers-color-scheme: dark');
  });

  test('keeps the hidden attribute stronger than component display rules', () => {
    expect(html).toContain('[hidden] {');
    expect(html).toContain('display: none !important;');
  });
});
