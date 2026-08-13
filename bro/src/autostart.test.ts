import { describe, expect, test } from 'bun:test'
import {
  linuxSystemdUnit,
  macosLaunchAgentPlist,
  windowsStartupBat,
} from './autostart'

describe('autostart wrappers', () => {
  test('linux systemd unit sets LAZYBRO_AUTOSTART and restarts on failure', () => {
    const unit = linuxSystemdUnit('"/usr/bin/lazybro"')
    expect(unit).toContain('Environment=LAZYBRO_AUTOSTART=1')
    expect(unit).toContain('ExecStart="/usr/bin/lazybro"')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('WantedBy=default.target')
  })

  test('macOS LaunchAgent sets env and does not loop on successful exit', () => {
    const plist = macosLaunchAgentPlist(['/Applications/lazybro'])
    expect(plist).toContain('<string>ar.zic.lazybro</string>')
    expect(plist).toContain('<key>LAZYBRO_AUTOSTART</key>')
    expect(plist).toContain('<string>1</string>')
    expect(plist).toContain('<key>SuccessfulExit</key>')
    expect(plist).toContain('<false/>')
    expect(plist).toContain('<string>/Applications/lazybro</string>')
  })

  test('Windows startup bat starts minimized with autostart env', () => {
    const bat = windowsStartupBat('C:\\LazyBro\\lazybro.exe')
    expect(bat).toContain('set LAZYBRO_AUTOSTART=1')
    expect(bat).toContain('start "LazyBro" /min')
    expect(bat).toContain('"C:\\LazyBro\\lazybro.exe"')
  })
})
