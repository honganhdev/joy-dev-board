import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';

const FORBIDDEN_LANGUAGE = /\b(SLAs?|overdue|breach(?:es|ed|ing)?|deadlines?)\b/i;
const REPORT_COMPONENTS = new URL('../src/components/report/', import.meta.url);

describe('the report component language', () => {
  for (const name of readdirSync(REPORT_COMPONENTS).sort()) {
    test(`${name} does not imply a target, commitment or deadline`, () => {
      const source = readFileSync(new URL(name, REPORT_COMPONENTS), 'utf8');
      expect(source.match(FORBIDDEN_LANGUAGE)).toBeNull();
    });
  }
});
