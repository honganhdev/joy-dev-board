import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { argon2Parameters, decodePasswordHash, loadConfig } from '../src/config';

const HASH = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g';
/** Same algorithm and version, cheaper cost — the mismatch that breaks the decoy. */
const CHEAPER = '$argon2id$v=19$m=512,t=1,p=1$c29tZXNhbHQ$c29tZWhhc2g';

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

/**
 * `selectVerificationTarget` verifies an unknown username against entry 1's hash
 * so a wrong username costs the same as a wrong password. Measured on the test
 * machine, `m=512,t=1` verifies in 1.2 ms against 2843 ms for `m=262144,t=4` —
 * a ~2400x gap that tells an attacker which of the two they got wrong. The only
 * way the decoy holds is if a mismatched hash can never reach the list.
 */
describe('argon2 parameters across configured accounts', () => {
  test('reads the parameter prefix and ignores salt and digest', () => {
    expect(argon2Parameters(HASH)).toBe('argon2id$v=19$m=65536,t=2,p=1');
    expect(argon2Parameters(CHEAPER)).toBe('argon2id$v=19$m=512,t=1,p=1');
    expect(argon2Parameters(HASH)).not.toBe(argon2Parameters(CHEAPER));
    expect(argon2Parameters('definitely-not-a-hash')).toBeNull();
    // A different argon2 variant at the same cost is still a different cost to
    // verify, so it must not read as a match.
    expect(argon2Parameters('$argon2i$v=19$m=65536,t=2,p=1$c2FsdA$aGFzaA')).not.toBe(
      argon2Parameters(HASH)
    );
  });

  test('accepts a later entry that matches entry one', () => {
    expect(
      loadConfig(env({ AUTH_USER_2_NAME: 'binh', AUTH_USER_2_HASH: HASH })).auth.users
    ).toEqual([
      { username: 'anh', passwordHash: HASH },
      { username: 'binh', passwordHash: HASH },
    ]);
  });

  test('skips a later entry whose parameters differ, naming the key and the mismatch', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const users = loadConfig(
      env({
        AUTH_USER_2_NAME: 'binh',
        AUTH_USER_2_HASH: CHEAPER,
        AUTH_USER_3_NAME: 'chi',
        AUTH_USER_3_HASH: HASH,
      })
    ).auth.users;

    // The mismatched account is gone; the matching one after it is unaffected,
    // because a bad later entry must never take the live board down.
    expect(users).toEqual([
      { username: 'anh', passwordHash: HASH },
      { username: 'chi', passwordHash: HASH },
    ]);

    const message = JSON.stringify(logged.mock.calls);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('AUTH_USER_2_HASH'));
    expect(message).toContain('m=512,t=1,p=1');
    expect(message).toContain('m=65536,t=2,p=1');
    // The salt and digest are not part of the mismatch and are not printed.
    expect(message).not.toContain('c29tZXNhbHQ');
  });

  test('refuses to start when entry one itself has no readable parameters', () => {
    // `$argon2` gets past `decodePasswordHash`, so this is the case where only
    // the parameter read can catch it — and entry one is the one thing that
    // does hard-fail, as it already did before this check existed.
    expect(() =>
      loadConfig(env({ AUTH_PASSWORD_HASH: Buffer.from('$argon2id$nonsense').toString('base64') }))
    ).toThrow(/AUTH_PASSWORD_HASH is not a usable argon2id hash/);
    expect(() => loadConfig(env({ AUTH_PASSWORD_HASH: 'definitely-not-a-hash' }))).toThrow(
      /AUTH_PASSWORD_HASH is not a usable argon2id hash/
    );
  });
});
