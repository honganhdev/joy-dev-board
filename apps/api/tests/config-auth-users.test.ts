import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { decodePasswordHash, loadConfig } from '../src/config';

const HASH = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    API_KEY_HELPDESK: 'test-key',
    WEBHOOK_SECRET: 'test-webhook-secret',
    AUTH_USERNAME: 'anh',
    AUTH_PASSWORD_HASH: Buffer.from(HASH).toString('base64'),
    ...overrides,
  };
}

afterEach(() => {
  spyOn(console, 'error').mockRestore();
});

describe('auth account configuration', () => {
  test('keeps the existing pair as entry one', () => {
    expect(loadConfig(env()).auth.users).toEqual([{ username: 'anh', passwordHash: HASH }]);
  });

  test('adds numbered accounts in order', () => {
    expect(
      loadConfig(
        env({
          AUTH_USER_2_NAME: 'binh',
          AUTH_USER_2_HASH: HASH,
          AUTH_USER_4_NAME: 'dung',
          AUTH_USER_4_HASH: Buffer.from(HASH).toString('base64'),
        })
      ).auth.users
    ).toEqual([
      { username: 'anh', passwordHash: HASH },
      { username: 'binh', passwordHash: HASH },
      { username: 'dung', passwordHash: HASH },
    ]);
  });

  test('logs the missing hash key and skips only that account', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const users = loadConfig(env({ AUTH_USER_2_NAME: 'binh' })).auth.users;

    expect(users).toEqual([{ username: 'anh', passwordHash: HASH }]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('AUTH_USER_2_HASH'));
  });

  test('logs the missing name key and skips only that account', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const users = loadConfig(env({ AUTH_USER_2_HASH: HASH })).auth.users;

    expect(users).toEqual([{ username: 'anh', passwordHash: HASH }]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('AUTH_USER_2_NAME'));
  });

  test('keeps the first duplicate and logs the losing name key', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const users = loadConfig(
      env({ AUTH_USER_2_NAME: 'anh', AUTH_USER_2_HASH: HASH })
    ).auth.users;

    expect(users).toEqual([{ username: 'anh', passwordHash: HASH }]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('AUTH_USER_2_NAME'));
  });

  test('logs an unusable numbered hash key without printing its value', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const invalid = 'definitely-not-a-hash';
    const users = loadConfig(
      env({ AUTH_USER_2_NAME: 'binh', AUTH_USER_2_HASH: invalid })
    ).auth.users;

    expect(users).toEqual([{ username: 'anh', passwordHash: HASH }]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('AUTH_USER_2_HASH'));
    expect(JSON.stringify(logged.mock.calls)).not.toContain(invalid);
  });

  test('accepts both raw and base64 argon2 hashes', () => {
    expect(decodePasswordHash(HASH)).toBe(HASH);
    expect(decodePasswordHash(Buffer.from(HASH).toString('base64'))).toBe(HASH);
  });

  test('still hard-fails when entry one is missing', () => {
    expect(() => loadConfig(env({ AUTH_USERNAME: undefined }))).toThrow(/AUTH_USERNAME is not set/);
    expect(() => loadConfig(env({ AUTH_PASSWORD_HASH: undefined }))).toThrow(
      /AUTH_PASSWORD_HASH is not set/
    );
  });
});
