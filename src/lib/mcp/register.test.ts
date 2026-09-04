import { describe, expect, test } from 'bun:test'
import type { McpServer } from '@modelcontextprotocol/server'
import { registerLazyBackupTools } from './register'

function collectRegisteredToolNames(options: {
  canWrite?: boolean
  canRemoteExec?: boolean
}): string[] {
  const names: string[] = []
  const server = {
    registerTool: (name: string) => {
      names.push(name)
    },
    registerResource: () => {},
  }
  registerLazyBackupTools(server as unknown as McpServer, options)
  return names
}

const READ_TOOLS = [
  'find_server',
  'list_docker_volumes',
  'list_docker_containers',
  'get_container_db_hints',
  'test_server',
  'test_database',
  'list_backups',
  'get_backup',
  'validate_backup',
  'list_history',
  'get_history',
  'list_servers',
  'list_s3_profiles',
  'get_dashboard',
  'get_status',
] as const

const WRITE_TOOLS = [
  'create_backup',
  'update_backup',
  'delete_backup',
  'run_backup',
  'toggle_backup',
  'restore_history',
  'create_server',
  'update_server',
  'delete_server',
] as const

describe('registerLazyBackupTools', () => {
  test('read_only omits mutating tools and exec_command', () => {
    const names = collectRegisteredToolNames({ canWrite: false, canRemoteExec: false })
    expect(names).toEqual([...READ_TOOLS])
    for (const tool of WRITE_TOOLS) {
      expect(names).not.toContain(tool)
    }
    expect(names).not.toContain('exec_command')
  })

  test('write without remote_exec advertises mutations but not shell', () => {
    const names = collectRegisteredToolNames({ canWrite: true, canRemoteExec: false })
    for (const tool of READ_TOOLS) {
      expect(names).toContain(tool)
    }
    for (const tool of WRITE_TOOLS) {
      expect(names).toContain(tool)
    }
    expect(names).not.toContain('exec_command')
  })

  test('session-like auth advertises write tools and exec_command', () => {
    const names = collectRegisteredToolNames({ canWrite: true, canRemoteExec: true })
    expect(names).toContain('exec_command')
    for (const tool of WRITE_TOOLS) {
      expect(names).toContain(tool)
    }
  })
})
