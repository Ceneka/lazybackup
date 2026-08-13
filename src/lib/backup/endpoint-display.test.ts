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
})

describe('destinationKindOf', () => {
  test('defaults to local', () => {
    expect(destinationKindOf({})).toBe('local')
  })
})
