import { describe, expect, test } from 'bun:test';
import {
  mapContainerEnvToDatabaseHints,
  parseDockerEnvArray,
} from './containers';

describe('parseDockerEnvArray', () => {
  test('parses KEY=VALUE lines', () => {
    expect(parseDockerEnvArray(['POSTGRES_USER=app', 'FOO=bar=baz', 'NOEQ'])).toEqual({
      POSTGRES_USER: 'app',
      FOO: 'bar=baz',
    });
  });
});

describe('mapContainerEnvToDatabaseHints', () => {
  test('maps postgres env', () => {
    const hints = mapContainerEnvToDatabaseHints(
      'db',
      {
        POSTGRES_USER: 'app',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_DB: 'appdb',
      },
      'postgres:16'
    );
    expect(hints.found).toBe(true);
    expect(hints.engine).toBe('postgres');
    expect(hints.user).toBe('app');
    expect(hints.password).toBe('secret');
    expect(hints.database).toBe('appdb');
    expect(hints.port).toBe(5432);
    expect(hints.host).toBeUndefined();
  });

  test('maps postgres host from env', () => {
    const hints = mapContainerEnvToDatabaseHints(
      'app',
      {
        POSTGRES_USER: 'app',
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_DB: 'appdb',
        POSTGRES_HOST: '10.8.0.12',
      },
      'app:latest'
    );
    expect(hints.host).toBe('10.8.0.12');
  });

  test('maps mysql root password', () => {
    const hints = mapContainerEnvToDatabaseHints(
      'mysql',
      { MYSQL_ROOT_PASSWORD: 'rootpw', MYSQL_DATABASE: 'shop' },
      'mysql:8'
    );
    expect(hints.engine).toBe('mysql');
    expect(hints.user).toBe('root');
    expect(hints.password).toBe('rootpw');
    expect(hints.database).toBe('shop');
    expect(hints.port).toBe(3306);
    expect(hints.host).toBeUndefined();
  });

  test('maps mysql host from env', () => {
    const hints = mapContainerEnvToDatabaseHints(
      'app',
      {
        MYSQL_USER: 'root',
        MYSQL_PASSWORD: 'pw',
        MYSQL_DATABASE: 'shop',
        MYSQL_HOST: 'db.internal',
      },
      'app:latest'
    );
    expect(hints.host).toBe('db.internal');
  });

  test('maps mariadb env', () => {
    const hints = mapContainerEnvToDatabaseHints(
      'maria',
      {
        MARIADB_USER: 'u',
        MARIADB_PASSWORD: 'p',
        MARIADB_DATABASE: 'd',
      },
      'mariadb:11'
    );
    expect(hints.engine).toBe('mariadb');
    expect(hints.user).toBe('u');
    expect(hints.database).toBe('d');
  });

  test('returns found false for unrelated container', () => {
    const hints = mapContainerEnvToDatabaseHints('web', { NODE_ENV: 'production' }, 'nginx:latest');
    expect(hints.found).toBe(false);
    expect(hints.engine).toBeUndefined();
  });
});
