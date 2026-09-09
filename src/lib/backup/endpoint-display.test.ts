import { describe, expect, test } from 'bun:test'
import {
  destinationEndpointName,
  destinationKindOf,
  sourceEndpointName,
  sourcePathLabel,
  sourceTypeLabel,
} from './endpoint-display'

describe('destinationEndpointName', () => {
  test('uses the S3 profile name instead of Unknown server', () => {
    expect(
      destinationEndpointName({
        destinationKind: 's3',
        destinationPath: '/backups/local/lazybackup-instance',
        destinationS3Profile: { name: 'R2' },
      })
    ).toBe('R2')
  })

  test('falls back to S3 when the profile is missing', () => {
    expect(
      destinationEndpointName({
        destinationKind: 's3',
        destinationPath: 'backups/',
      })
    ).toBe('S3')
  })

  test('names bro peers', () => {
    expect(
      destinationEndpointName({
        destinationKind: 'peer',
        destinationPeer: { name: 'cabin' },
      })
    ).toBe('cabin')
  })
})

describe('sourceEndpointName', () => {
  test('names S3 sources', () => {
    expect(
      sourceEndpointName({
        sourceKind: 's3',
        sourceS3Profile: { name: 'MinIO' },
        sourcePath: 'archive/',
      })
    ).toBe('MinIO')
  })

  test('names Git sources', () => {
    expect(
      sourceEndpointName({
        sourceKind: 'git',
        sourceGitRepo: { name: 'lazybackup' },
        sourceType: 'git_repo',
      })
    ).toBe('lazybackup')
  })
})

describe('source labels', () => {
  test('describes instance backups', () => {
    const backup = {
      sourceKind: 'local' as const,
      sourceType: 'lazybackup_instance' as const,
      sourcePath: 'lazybackup-instance',
    }
    expect(sourcePathLabel(backup)).toBe('instance data')
    expect(sourceTypeLabel(backup)).toBe('LazyBackup instance data')
  })

  test('describes Git repository mirrors', () => {
    const backup = {
      sourceKind: 'git' as const,
      sourceType: 'git_repo' as const,
      sourcePath: 'git-mirror',
      sourceGitRepo: { name: 'app' },
    }
    expect(sourcePathLabel(backup)).toBe('mirror')
    expect(sourceTypeLabel(backup)).toBe('Git repository (bare mirror)')
  })
})

describe('destinationKindOf', () => {
  test('defaults to local', () => {
    expect(destinationKindOf({})).toBe('local')
  })
})
