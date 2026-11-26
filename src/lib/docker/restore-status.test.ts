import { describe, expect, test } from 'bun:test';
import { restoreDockerVolume } from './volumes';

describe('restoreDockerVolume exit status', () => {
  test('a helper killed by a signal is not reported as success', async () => {
    const commands: string[] = [];
    const ssh = {
      execCommand: async (cmd: string) => {
        commands.push(cmd);
        if (cmd.includes('docker info')) {
          return { code: 0, signal: null, stdout: '', stderr: '' };
        }
        // docker/tar killed mid-extract (OOM, host reboot, connection drop).
        return { code: null, signal: 'SIGKILL', stdout: '', stderr: '' };
      },
    };

    await expect(
      restoreDockerVolume(ssh as never, 'vol', '/tmp/lazybackup-docker-x/v.tar.gz', '/tmp/lazybackup-docker-x')
    ).rejects.toThrow();
    expect(commands.some((c) => c.includes('docker run'))).toBe(true);
  });
});
