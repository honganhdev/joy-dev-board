import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../src/config';

const PASSWORD_HASH = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$c29tZWhhc2g';

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    API_KEY_HELPDESK: 'test-key',
    WEBHOOK_SECRET: 'whsec-local-test',
    AUTH_USERNAME: 'boarduser',
    AUTH_PASSWORD_HASH: PASSWORD_HASH,
    ...overrides,
  };
}

describe('webhook secret configuration', () => {
  // The endpoint is the one publicly reachable route; the HMAC is its only
  // guard. Starting without a secret would leave that guard unconfigured, so
  // the process must refuse to come up at all.
  test('refuses to start when WEBHOOK_SECRET is absent', () => {
    expect(() => loadConfig(env({ WEBHOOK_SECRET: undefined }))).toThrow(
      /WEBHOOK_SECRET is not set/
    );
  });

  test('refuses to start when WEBHOOK_SECRET is blank or only whitespace', () => {
    expect(() => loadConfig(env({ WEBHOOK_SECRET: '' }))).toThrow(/WEBHOOK_SECRET is not set/);
    expect(() => loadConfig(env({ WEBHOOK_SECRET: '   ' }))).toThrow(/WEBHOOK_SECRET is not set/);
  });

  test('carries the trimmed secret through, so a stray newline cannot break every signature', () => {
    expect(loadConfig(env({ WEBHOOK_SECRET: '  whsec-padded\n' })).webhookSecret).toBe(
      'whsec-padded'
    );
  });

  test('never repeats the secret value in the startup error', () => {
    try {
      loadConfig(env({ WEBHOOK_SECRET: undefined }));
      throw new Error('loadConfig should have refused to start');
    } catch (cause) {
      expect((cause as Error).message).not.toContain('test-key');
      expect((cause as Error).message).toContain('Avada admin');
    }
  });
});
