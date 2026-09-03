import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase } from '../src/db/client';
import {
  AGENT_CONFIG_SAMPLE,
  MCP_GUIDE_BLOCKS,
  MCP_GUIDE_CONTACT,
  TOOL_SECTIONS,
} from '../src/docs/mcp-guide';
import { MCP_CORPUS } from '../src/mcp/corpus';
import { createRouter } from '../src/routes';

const TOOLS_SOURCE = resolve(import.meta.dir, '../src/mcp/tools.ts');
const GUIDE_SOURCE = resolve(import.meta.dir, '../src/docs/mcp-guide.ts');

describe('MCP guide stays aligned with the tool surface', () => {
  test('documents exactly the registered tools', () => {
    const source = readFileSync(TOOLS_SOURCE, 'utf8');
    const registered = [...source.matchAll(/server\.registerTool\(\s*'([a-z_]+)'/g)]
      .flatMap((match) => (match[1] ? [match[1]] : []))
      .sort();

    expect(Object.keys(TOOL_SECTIONS).sort()).toEqual(registered);
  });

  test('renders the typed agent config as valid JSON', () => {
    const sample = MCP_GUIDE_BLOCKS.find(
      (block) => block.kind === 'code' && block.text.includes('"mcpServers"')
    );

    expect(sample?.kind).toBe('code');
    if (sample?.kind !== 'code') throw new Error('Agent config code block is missing');
    expect(sample.text).toBe(JSON.stringify(AGENT_CONFIG_SAMPLE, null, 2));
    expect(() => JSON.parse(sample.text)).not.toThrow();
  });

  test('imports the shared corpus sentence instead of restating it', () => {
    const source = readFileSync(GUIDE_SOURCE, 'utf8');

    expect(source).toContain("import { MCP_CORPUS } from '../mcp/corpus';");
    expect(source).toContain("{ kind: 'code', text: MCP_CORPUS }");
    expect(source).not.toContain(MCP_CORPUS);
  });

  test('contains no credential-shaped value or argon2 hash', () => {
    const source = readFileSync(GUIDE_SOURCE, 'utf8');

    expect(source).not.toMatch(/[A-Za-z0-9_-]{40,}/);
    expect(source).not.toMatch(/\$argon2/);
  });
});

/**
 * The guide's sentences, long enough to be prose rather than a table cell:
 * `string` and `—` occur all over the web source and say nothing about a leak.
 */
function guideProse(): string[] {
  return blockStrings().filter((value) => value.length >= 24);
}

function blockStrings(): string[] {
  return MCP_GUIDE_BLOCKS.flatMap((block) => {
    switch (block.kind) {
      case 'ul':
        return [...block.items];
      case 'table':
        return [...block.headers, ...block.rows.flat()];
      default:
        return [block.text];
    }
  });
}

function webSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? webSources(path) : [readFileSync(path, 'utf8')];
  });
}

describe('the guide prose is only reachable with a session', () => {
  // The requirement is not "does not render" but "cannot be fetched". `dist` is
  // built from `apps/web/src` alone, so prose absent from every source file
  // there cannot reach the public bundle.
  test('no sentence of the guide is written into the web source', () => {
    const sources = webSources(resolve(import.meta.dir, '../../web/src'));
    // Guards the length filter above from quietly reducing this to nothing.
    expect(guideProse().length).toBeGreaterThan(20);
    const leaked = guideProse().filter((sentence) =>
      sources.some((source) => source.includes(sentence))
    );

    expect(leaked).toEqual([]);
  });

  test('/docs/mcp serves the app shell to a visitor with no session, prose-free', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'issue-board-docs-'));
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><html><body><div id="root"></div></body></html>'
    );
    const { db } = openDatabase(':memory:');
    const handle = createRouter({
      db,
      pulls: {
        run: async () => ({ pulled: 0, inserted: 0, statusChanges: 0 }),
        whenIdle: async () => {},
      },
      tags: { get: async () => ({ value: [], loadedAt: '', fromCache: false }) } as never,
      auth: {
        users: [{ username: 'teammate', passwordHash: 'unused' }],
        sessionTtlMs: 60_000,
        cookieSecure: false,
        trustProxy: false,
      },
      webhookSecret: 'test-webhook-secret',
      webhooks: { process: async () => {} },
      year: 2026,
      webDistPath: dist,
    });

    try {
      // The document itself is public — it is the login screen until a session
      // exists — so what matters is that it carries none of the guide's text.
      const page = await handle(new Request('http://localhost/docs/mcp'));
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      const html = await page.text();
      expect(guideProse().filter((sentence) => html.includes(sentence))).toEqual([]);

      // The prose route behind it stays shut without a session.
      const data = await handle(new Request('http://localhost/api/docs/mcp'));
      expect(data.status).toBe(401);
      expect(await data.text()).not.toContain(MCP_GUIDE_CONTACT);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
