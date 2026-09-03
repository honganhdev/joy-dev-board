import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AGENT_CONFIG_SAMPLE,
  MCP_GUIDE_BLOCKS,
  TOOL_SECTIONS,
} from '../src/docs/mcp-guide';
import { MCP_CORPUS } from '../src/mcp/corpus';

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
