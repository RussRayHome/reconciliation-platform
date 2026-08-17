import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { FILE_VALIDATION_RULES } from './ruleCatalog';

/**
 * Guards the promise `ruleCatalog.ts`'s own header comment makes: the DB catalog
 * (validation_rule_version, changeset 0047) is seeded from FILE_VALIDATION_RULES, so if this file
 * and the engine's actual source ever disagree, validation_issue.rule_version_id lineage silently
 * points at the wrong thing. Scans the two source files for code-shaped string literals rather than
 * re-implementing the engine, so it catches both "engine grew a code the catalog doesn't know about"
 * and "catalog has a stale/typo'd entry nothing emits" without being a change-detector on the engine's
 * actual validation logic.
 */

// STRUCT_*/BANK_*/GL_* -- matches every code this engine emits (ruleCatalog.ts's own convention).
const CODE_LITERAL_PATTERN = /'((?:STRUCT|BANK|GL)_[A-Z_]+)'/g;

const extractCodesFromSource = (relativePath: string): Set<string> => {
  const source = readFileSync(join(__dirname, relativePath), 'utf8');
  const codes = new Set<string>();
  for (const match of source.matchAll(CODE_LITERAL_PATTERN)) {
    codes.add(match[1]!);
  }
  return codes;
};

describe('FILE_VALIDATION_RULES', () => {
  it('has no duplicate codes', () => {
    const codes = FILE_VALIDATION_RULES.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('contains exactly the codes structuralGates.ts and rowValidators.ts actually emit', () => {
    const emitted = new Set([
      ...extractCodesFromSource('structuralGates.ts'),
      ...extractCodesFromSource('rowValidators.ts'),
    ]);
    const cataloged = new Set(FILE_VALIDATION_RULES.map((rule) => rule.code));

    const uncataloged = [...emitted].filter((code) => !cataloged.has(code));
    const stale = [...cataloged].filter((code) => !emitted.has(code));

    expect(uncataloged, 'codes emitted by the engine but missing from FILE_VALIDATION_RULES').toEqual([]);
    expect(stale, 'codes in FILE_VALIDATION_RULES that the engine no longer emits').toEqual([]);
  });

  it('every BANK_*/GL_* entry declares the matching sourceType, STRUCT_* declares null', () => {
    for (const rule of FILE_VALIDATION_RULES) {
      if (rule.code.startsWith('BANK_')) expect(rule.sourceType).toBe('BANK');
      else if (rule.code.startsWith('GL_')) expect(rule.sourceType).toBe('GL');
      else if (rule.code.startsWith('STRUCT_')) expect(rule.sourceType).toBeNull();
    }
  });
});
