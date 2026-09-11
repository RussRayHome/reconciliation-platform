import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/**
 * UI-0b (#399). Phase 0 of the screen redesign establishes the token foundation every later phase
 * consumes; its acceptance criteria were written as grep checks, which nothing ran. That is the
 * failure mode `EXPECTED_ABSENT_FROM_RAIL` exists to prevent on the rail: a value silently
 * reintroduced passes unnoticed until a visual baseline moves weeks later and nobody can say why.
 *
 * These are the [OBJECT] rules from the design handoff's `02_DESIGN_DECISIONS.md`, asserted
 * statically against the CSS:
 *
 *   rule 24  radii are 6 row / 8 control / 12 panel / 999 pill -- no 10px, no other values
 *   rule 25  IBM Plex Mono labels at 10.5px (meta 12px); no JetBrains Mono
 *   rule 27  motion only where something is interactive
 *
 * Each allowlist below names *why* an exception exists and which phase owns retiring it, so
 * clearing one is an edit to this file -- a visible decision -- rather than a test that quietly
 * stops failing.
 */

const STYLES_DIR = join(__dirname);

const collectCssFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectCssFiles(fullPath));
    } else if (entry.endsWith('.css')) {
      files.push(fullPath);
    }
  }
  return files;
};

/** `apps/web/src/styles/components/triage.css` -> `components/triage.css` */
const shortName = (file: string): string => file.split('/styles/')[1] ?? file;

const cssFiles = collectCssFiles(STYLES_DIR);

type Decl = { file: string; selector: string; prop: string; value: string };

const allDeclarations = (): Decl[] => {
  const out: Decl[] = [];
  for (const file of cssFiles) {
    postcss.parse(readFileSync(file, 'utf-8')).walkRules((rule) => {
      rule.walkDecls((decl) => {
        out.push({ file: shortName(file), selector: rule.selector, prop: decl.prop, value: decl.value.trim() });
      });
    });
  }
  return out;
};

describe('design tokens (UI-0b acceptance)', () => {
  it('requests no retired font family', () => {
    // fonts.css declares three families only; a JetBrains Mono request silently falls back to an
    // OS mono, which is environment-dependent and was a real source of visual-lane flake (#208).
    const offenders = cssFiles
      .filter((file) => readFileSync(file, 'utf-8').includes('JetBrains Mono'))
      .map(shortName);
    expect(offenders).toEqual([]);
  });

  it('declares none of the retired control-depth tokens', () => {
    // Replaced by --shadow-button / --shadow-button-secondary in the one button family.
    const retired = allDeclarations().filter(
      (d) => d.prop === '--gradient-control' || d.prop === '--shadow-control',
    );
    expect(retired.map((d) => `${d.file} (${d.selector}) ${d.prop}`)).toEqual([]);
  });

  it('uses only the four radius tokens, with named exceptions', () => {
    /** Off-scale radii that survive Phase 0, each with the phase that owns retiring it. Pre-auth
     * screens are rebuilt wholesale later, so correcting them now would spend a baseline round on
     * pixels those phases move again. */
    const OFF_SCALE: Record<string, string> = {
      'components/login.css::.login-brand__logo': 'Phase 12 rebuilds auth (10a-10d)',
      'components/signup.css::.signup-header__logo': 'Phase 7 rebuilds signup (4a/4b)',
      'components/signup.css::.signup-pw-meter__bar': 'Phase 7 rebuilds signup (4a/4b)',
      'components/signup.css::.signup-terms__box': 'Phase 7 rebuilds signup (4a/4b)',
      'components/signup.css::.signup-modal': 'Phase 7 rebuilds signup (4a/4b)',
      'components/triage.css::.exception-decision-button kbd': 'Phase 3 owns the keycap treatment',
      'components/docs.css::.docs-image-zoom-trigger': 'Phase 11 rebuilds the run book (10e)',
    };
    // `50%` is a circle (avatars, dots), not a point on the radius scale; `0` is a reset.
    const NON_SCALE_LITERALS = new Set(['50%', '0']);

    const offenders = allDeclarations()
      .filter((d) => d.prop === 'border-radius')
      .filter((d) => !d.value.includes('var(--radius-'))
      .filter((d) => !NON_SCALE_LITERALS.has(d.value))
      .filter((d) => !(`${d.file}::${d.selector}` in OFF_SCALE))
      .map((d) => `${d.file} (${d.selector}): ${d.value}`);

    expect(
      offenders,
      'Radii are 6 row / 8 control / 12 panel / 999 pill (rule 24). Use the token by name, or add ' +
        'the selector to OFF_SCALE above with the phase that owns retiring it.',
    ).toEqual([]);
  });

  it('sizes every uppercase label from the label/meta pair, with named exceptions', () => {
    /** Uppercase, letter-spaced text is an eyebrow: 10.5px (rule 25). The exceptions are all
     * screens a later phase rebuilds, plus the rail, whose section headers are 10px by design --
     * a documented rail-specific value, and Phase 1 re-measures the rail's whole height budget. */
    const EXCEPTIONS: Record<string, string> = {
      'components/nav-rail.css': 'rail section headers are 10px by design; Phase 1 rewrites the rail',
      'components/login.css': 'Phase 12 rebuilds auth (10a-10d)',
      'components/signup.css': 'Phase 7 rebuilds signup (4a/4b)',
      'components/mapping.css': 'Phase 11 rebuilds the mapping family (9a-9d)',
      'patterns/tables.css': 'one 11px caption; Phase 8 copy sweep',
    };

    const offenders: string[] = [];
    for (const file of cssFiles) {
      const short = shortName(file);
      if (short in EXCEPTIONS) continue;
      postcss.parse(readFileSync(file, 'utf-8')).walkRules((rule) => {
        const decls = rule.nodes.filter((node) => node.type === 'decl');
        const isUppercase = decls.some(
          (d) => d.prop === 'text-transform' && d.value.trim() === 'uppercase',
        );
        const size = decls.find((d) => d.prop === 'font-size');
        if (!isUppercase || !size) return;
        if (size.value.includes('--font-label') || size.value.includes('--font-meta')) return;
        offenders.push(`${short} (${rule.selector}): ${size.value}`);
      });
    }

    expect(
      offenders,
      'Uppercase labels are eyebrows: size them var(--font-label) (10.5px) or var(--font-meta) ' +
        '(12px), per rule 25. Seven sizes had drifted across 0.62-0.82rem before UI-0b.',
    ).toEqual([]);
  });

  it('animates only what a user is interacting with or waiting on', () => {
    /** Rule 27: motion only where something is interactive. Each keyframe kept here earns it by
     * being a response to input, a rise on an overlay, or a live "still working" signal. */
    const ALLOWED: Record<string, string> = {
      'skeleton-shimmer': 'loading placeholder -- the wait itself is the thing being shown',
      'popover-rise': 'overlay entrance on user action',
      riseIn: 'overlay entrance on user action (signup modal)',
      runBarSegmentStripe: 'live progress on an in-flight run',
      pulse: 'the run step that is actively working; the queued step is deliberately still',
      'rule-variance-item-flash': 'acknowledges the row the user just scrolled into view',
      signupSpin: 'in-flight submit spinner',
    };

    const offenders = allDeclarations()
      .filter((d) => d.prop === 'animation' && d.value !== 'none')
      .map((d) => ({ ...d, name: d.value.split(/\s+/)[0] ?? '' }))
      .filter((d) => !(d.name in ALLOWED))
      .map((d) => `${d.file} (${d.selector}): ${d.name}`);

    expect(
      offenders,
      'Motion only where something is interactive (rule 27). Decorative entrances on containers ' +
        '(fadeInUp, slideInLeft) were removed in UI-0b; add to ALLOWED above only with a reason.',
    ).toEqual([]);
  });

  it('declares every token these guards depend on', () => {
    // Guards this file's own assumptions: if a token is renamed, the checks above would silently
    // pass against CSS that no longer resolves.
    const tokens = readFileSync(join(STYLES_DIR, 'tokens.css'), 'utf-8');
    for (const token of [
      '--radius-row',
      '--radius-control',
      '--radius-panel',
      '--radius-pill',
      '--font-label',
      '--font-meta',
      '--shadow-button',
      '--shadow-button-secondary',
    ]) {
      expect(tokens, `tokens.css must declare ${token}`).toContain(`${token}:`);
    }
  });
});
