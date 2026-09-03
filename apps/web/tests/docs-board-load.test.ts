import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/app.tsx', import.meta.url), 'utf8');
const boardHookSource = readFileSync(new URL('../src/hooks/use-board.ts', import.meta.url), 'utf8');

test('mounting on the docs path leaves /api/tickets idle', () => {
  // apps/web deliberately has no DOM renderer. Pin both halves of the mount
  // contract instead: Docs disables the hook, and the hook refuses to run its
  // board-loading effect while disabled.
  expect(appSource).toMatch(/useBoard\(\s+reportPull,\s+view !== 'docs'\s+\)/);
  expect(boardHookSource).toMatch(
    /useEffect\(\(\) => \{\s+if \(!active \|\| loadStarted\.current\) return;\s+loadStarted\.current = true;\s+void load\(\);\s+\}, \[active, load\]\)/
  );
});
