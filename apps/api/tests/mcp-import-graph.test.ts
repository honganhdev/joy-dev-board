import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const SRC = resolve(import.meta.dir, '../src');
const ANCHORS = [resolve(SRC, 'mcp/server.ts'), resolve(SRC, 'mcp/tools.ts')];
const ALLOWED = new Set([
  'mcp/server.ts',
  'mcp/tools.ts',
  'board/assemble.ts',
  'board/categories.ts',
  'board/classify.ts',
  'board/extra-columns.ts',
  'board/search.ts',
  'board/types.ts',
]);

function runtimeImports(source: string): string[] {
  const imports: string[] = [];
  const pattern = /import\s+(?!type\b)[\s\S]*?\sfrom\s+['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

function resolveImport(from: string, specifier: string): string {
  const candidate = resolve(dirname(from), specifier);
  for (const path of [candidate, `${candidate}.ts`, resolve(candidate, 'index.ts')]) {
    if (existsSync(path)) return path;
  }
  throw new Error(`Cannot resolve ${specifier} from ${from}`);
}

function walkRuntimeGraph(): Set<string> {
  const pending = [...ANCHORS];
  const reached = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reached.has(path)) continue;
    reached.add(path);
    const source = readFileSync(path, 'utf8');
    for (const specifier of runtimeImports(source)) pending.push(resolveImport(path, specifier));
  }
  return reached;
}


/** Packages the reviewed graph may pull in. A new one is a review decision. */
const ALLOWED_PACKAGES = new Set([
  '@modelcontextprotocol/sdk/server/mcp.js',
  '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js',
  'zod',
]);

function packageImports(source: string): string[] {
  const imports: string[] = [];
  const pattern = /import\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^.'"][^'"]*)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

/** The exact dependency surface tools may reach. Adding one is a review decision. */
const EXPECTED_DEPS = [
  'readTickets',
  'readTicket',
  'readStatusHistory',
  'readLastPull',
  'readLastSuccessfulPull',
  'countTickets',
  'resolveTags',
];

describe('MCP read-only import boundary', () => {
  test('both the server and tools stay inside the reviewed runtime graph', () => {
    const reached = [...walkRuntimeGraph()].map((path) => relative(SRC, path));
    expect(reached.filter((path) => !ALLOWED.has(path))).toEqual([]);
    expect(reached).toContain('mcp/server.ts');
    expect(reached).toContain('mcp/tools.ts');
  });

  test('the graph contains no direct write spelling or dynamic import', () => {
    const forbidden = [
      /db\.insert\s*\(/,
      /db\.update\s*\(/,
      /db\.delete\s*\(/,
      /db\.run\s*\(/,
      /\.exec\s*\(/,
      /\.transaction\s*\(/,
      /\bsql\s*`/,
      /\bimport\s*\(/,
    ];
    for (const path of walkRuntimeGraph()) {
      const source = readFileSync(path, 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(source), `${relative(SRC, path)} matches ${pattern}`).toBe(false);
      }
    }
  });

  test('tools receive narrow functions rather than a database handle', () => {
    const source = readFileSync(resolve(SRC, 'mcp/tools.ts'), 'utf8');
    expect(source).not.toContain("from '../db/client'");
    expect(source).not.toMatch(/\bdb\s*:/);
    for (const dependency of [
      'readTickets',
      'readTicket',
      'readStatusHistory',
      'readLastPull',
      'readLastSuccessfulPull',
      'countTickets',
      'resolveTags',
    ]) {
      expect(source).toContain(`${dependency}:`);
    }
  });


  test('the graph pulls in no package outside the reviewed set', () => {
    for (const path of walkRuntimeGraph()) {
      const source = readFileSync(path, 'utf8');
      for (const specifier of packageImports(source)) {
        expect(
          ALLOWED_PACKAGES.has(specifier),
          `${relative(SRC, path)} imports unreviewed package ${specifier}`
        ).toBe(true);
      }
    }
  });

  test('McpToolDeps declares exactly the seven read dependencies', () => {
    const source = readFileSync(resolve(SRC, 'mcp/tools.ts'), 'utf8');
    const block = /export type McpToolDeps = \{([\s\S]*?)\n\};/.exec(source)?.[1];
    expect(block).toBeTruthy();
    const declared = [...block!.matchAll(/^\s{2}(\w+)\s*:/gm)].map((match) => match[1]);
    expect(declared.sort()).toEqual([...EXPECTED_DEPS].sort());
  });

  test('the server uses only the Web-standard Bun transport', () => {
    const source = readFileSync(resolve(SRC, 'mcp/server.ts'), 'utf8');
    expect(source).toContain('/webStandardStreamableHttp.js');
    expect(source).not.toContain('/streamableHttp.js');
    expect(source).toContain('sessionIdGenerator: undefined');
  });
});
