import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  buildAuthorizeScript,
  buildRevokeScript,
  InvalidPublicKeyError,
  parsePublicKey,
  wrapForLoginShell,
} from './authorize-key'

let tempDir: string

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-authkey-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

const generateKey = (name: string, comment = 'sshya@test'): string => {
  const file = path.join(tempDir, name)
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', file])
  return fs.readFileSync(`${file}.pub`, 'utf8').trim()
}

/** Run the script the way sshd would: login shell → `sh -c '<script>'`. */
const runRemote = (script: string, home: string) => {
  const result = spawnSync('/bin/sh', ['-c', wrapForLoginShell(script)], {
    env: { PATH: process.env.PATH, HOME: home },
    encoding: 'utf8',
  })
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr }
}

describe('parsePublicKey', () => {
  test('accepts an ssh-keygen public key and matches its fingerprint', () => {
    const pub = generateKey('a')
    const parsed = parsePublicKey(`${pub}\n`)
    expect(parsed.type).toBe('ssh-ed25519')
    expect(parsed.comment).toBe('sshya@test')
    expect(parsed.line).toBe(pub)
    const expected = execFileSync('ssh-keygen', ['-lf', path.join(tempDir, 'a.pub')], {
      encoding: 'utf8',
    }).split(' ')[1]
    expect(parsed.fingerprint).toBe(expected)
  })

  test('comment is optional', () => {
    const [type, blob] = generateKey('b').split(' ')
    expect(parsePublicKey(`${type} ${blob}`).line).toBe(`${type} ${blob}`)
  })

  test('refuses options, shell metacharacters, and mismatched data', () => {
    const [type, blob] = generateKey('c').split(' ')
    const bad = [
      '',
      `command="sh" ${type} ${blob}`,
      `${type} ${blob} me'; rm -rf ~`,
      `${type} ${blob} $(id)`,
      `${type} ${blob} a b`,
      `${type} ${blob}\n${type} ${blob}`,
      `ssh-rsa ${blob}`,
      `${type} not*base64`,
      `ssh-dss ${blob}`,
    ]
    for (const input of bad) {
      expect(() => parsePublicKey(input)).toThrow(InvalidPublicKeyError)
    }
  })
})

describe('authorize / revoke scripts', () => {
  test('scripts never contain single quotes', () => {
    const key = parsePublicKey(generateKey('d'))
    expect(() => wrapForLoginShell(buildAuthorizeScript(key))).not.toThrow()
    expect(() => wrapForLoginShell(buildRevokeScript(key))).not.toThrow()
    expect(() => wrapForLoginShell("echo 'x'")).toThrow()
  })

  test('creates ~/.ssh with tight modes, is idempotent, and revokes', () => {
    const home = path.join(tempDir, 'home')
    fs.mkdirSync(home)
    const key = parsePublicKey(generateKey('e'))

    expect(runRemote(buildAuthorizeScript(key), home)).toMatchObject({ code: 0, stdout: 'added' })
    const file = path.join(home, '.ssh', 'authorized_keys')
    expect(fs.readFileSync(file, 'utf8')).toBe(`${key.line}\n`)
    expect(fs.statSync(path.join(home, '.ssh')).mode & 0o777).toBe(0o700)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)

    expect(runRemote(buildAuthorizeScript(key), home)).toMatchObject({ code: 0, stdout: 'present' })
    expect(fs.readFileSync(file, 'utf8')).toBe(`${key.line}\n`)

    expect(runRemote(buildRevokeScript(key), home)).toMatchObject({ code: 0, stdout: 'removed' })
    expect(fs.readFileSync(file, 'utf8')).toBe('')
    expect(runRemote(buildRevokeScript(key), home)).toMatchObject({ code: 0, stdout: 'absent' })
  })

  test('keeps other keys, adds a missing trailing newline, and treats a re-commented key as present', () => {
    const home = path.join(tempDir, 'home')
    fs.mkdirSync(path.join(home, '.ssh'), { recursive: true })
    const file = path.join(home, '.ssh', 'authorized_keys')
    const other = generateKey('other', 'someone@else')
    fs.writeFileSync(file, other, { mode: 0o644 })
    const key = parsePublicKey(generateKey('f'))

    expect(runRemote(buildAuthorizeScript(key), home).stdout).toBe('added')
    expect(fs.readFileSync(file, 'utf8')).toBe(`${other}\n${key.line}\n`)
    // Existing file mode is left alone.
    expect(fs.statSync(file).mode & 0o777).toBe(0o644)

    const recommented = parsePublicKey(`${key.type} ${key.blob} other-comment`)
    expect(runRemote(buildAuthorizeScript(recommented), home).stdout).toBe('present')

    expect(runRemote(buildRevokeScript(key), home).stdout).toBe('removed')
    expect(fs.readFileSync(file, 'utf8')).toBe(`${other}\n`)
    expect(fs.statSync(file).mode & 0o777).toBe(0o644)
  })
})
