/**
 * A malformed account list must not take the board down, and no account
 * material may reach a log or a response.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { loadConfig } from '../src/config';
import type { AuthConfig } from '../src/config';
import { openDatabase } from '../src/db/client';
import { createRouter } from '../src/routes';

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

describe('a broken account entry never throws', () => {
  test('every shape of broken entry 2 leaves entry 1 serving the board', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const broken: NodeJS.ProcessEnv[] = [
      { AUTH_USER_2_NAME: 'binh' }, // half pair: no hash
      { AUTH_USER_2_HASH: HASH }, // half pair: no name
      { AUTH_USER_2_NAME: 'anh', AUTH_USER_2_HASH: HASH }, // duplicates entry 1
      { AUTH_USER_2_NAME: 'binh', AUTH_USER_2_HASH: 'not-a-hash' }, // unusable hash
      { AUTH_USER_2_NAME: '   ', AUTH_USER_2_HASH: HASH }, // whitespace name
      { AUTH_USER_2_NAME: 'binh', AUTH_USER_2_HASH: '   ' }, // whitespace hash
      { AUTH_USER_2_NAME: 'binh', AUTH_USER_2_HASH: Buffer.from('nonsense').toString('base64') },
    ];

    for (const overrides of broken) {
      const config = (() => loadConfig(env(overrides)))();
      expect(config.auth.users).toEqual([{ username: 'anh', passwordHash: HASH }]);
    }
    expect(logged).toHaveBeenCalled();
  });

  test('a duplicate between two numbered entries drops only the later one', () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const users = loadConfig(
      env({
        AUTH_USER_2_NAME: 'binh',
        AUTH_USER_2_HASH: HASH,
        AUTH_USER_3_NAME: 'binh',
        AUTH_USER_3_HASH: HASH,
        AUTH_USER_4_NAME: 'dung',
        AUTH_USER_4_HASH: HASH,
      })
    ).auth.users;

    expect(users.map((user) => user.username)).toEqual(['anh', 'binh', 'dung']);
  });

  test('a mistyped key is silently ignored, with no account and no warning', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const users = loadConfig(
      env({ AUTH_USER_2_NAM: 'binh', AUTH_USER_2_HSAH: HASH, AUTH_USER2_NAME: 'binh' })
    ).auth.users;

    expect(users).toEqual([{ username: 'anh', passwordHash: HASH }]);
    // The account simply never exists; nothing tells the operator why.
    expect(logged).not.toHaveBeenCalled();
  });

  test('entries past the scanned range are silently ignored', () => {
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    const users = loadConfig(
      env({ AUTH_USER_20_NAME: 'twenty', AUTH_USER_20_HASH: HASH, AUTH_USER_21_NAME: 'twentyone', AUTH_USER_21_HASH: HASH })
    ).auth.users;

    expect(users.map((user) => user.username)).toEqual(['anh', 'twenty']);
    expect(logged).not.toHaveBeenCalled();
  });

  test('a fully broken list still boots on entry 1 alone', () => {
    spyOn(console, 'error').mockImplementation(() => {});
    const overrides: NodeJS.ProcessEnv = {};
    for (let index = 2; index <= 20; index += 1) {
      overrides[`AUTH_USER_${index}_NAME`] = 'anh';
      overrides[`AUTH_USER_${index}_HASH`] = 'garbage';
    }
    expect(() => loadConfig(env(overrides))).not.toThrow();
    expect(loadConfig(env(overrides)).auth.users).toHaveLength(1);
  });
});

describe('nothing secret reaches a log or a response', () => {
  const USERNAME = 'boarduser';
  const PASSWORD = 'correct horse battery staple';

  test('neither the password nor its hash appears in login output', async () => {
    const passwordHash = await Bun.password.hash(PASSWORD, { algorithm: 'argon2id' });
    const auth: AuthConfig = {
      users: [{ username: USERNAME, passwordHash }],
      sessionTtlMs: 60_000,
      cookieSecure: false,
      trustProxy: false,
    };
    const { db } = openDatabase(':memory:');
    const handle = createRouter({
      db,
      pulls: { run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }), whenIdle: async () => {} },
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth,
      webhookSecret: 'test-webhook-secret',
      webhooks: { process: async () => {} },
      year: 2026,
    });

    const log = spyOn(console, 'log').mockImplementation(() => {});
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    let bodies = '';
    let setCookie = '';
    try {
      for (const password of [PASSWORD, 'wrong password']) {
        const response = await handle(
          new Request('http://localhost/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: USERNAME, password }),
          })
        );
        bodies += await response.text();
        setCookie += response.headers.get('set-cookie') ?? '';
      }
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }

    const logs = JSON.stringify([...log.mock.calls, ...warn.mock.calls, ...error.mock.calls]);
    for (const secret of [PASSWORD, passwordHash, 'wrong password']) {
      expect(logs).not.toContain(secret);
      expect(bodies).not.toContain(secret);
      expect(setCookie).not.toContain(secret);
    }
    // The session id is a bearer credential too and must not be logged.
    const sessionId = /board_session=([^;]+)/.exec(setCookie)?.[1];
    expect(sessionId).toBeTruthy();
    expect(logs).not.toContain(sessionId!);
  });
});
