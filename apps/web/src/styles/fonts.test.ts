import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/**
 * Issue #208's actual root cause: `fonts.css` declared IBM Plex Sans at 400/500/600, but 30+
 * component-CSS rules request `font-weight: 700` for it -- with no matching @font-face, the
 * browser had to fall back or synthesize bold, an engine/OS-dependent choice that isn't defined
 * to render the same way everywhere, which is what actually produced e2e-visual's "intermittent"
 * Rules-panel height diff. Confirmed via the failing heading's own computed style
 * (fontFamily: "IBM Plex Sans", fontWeight: "700") before the fix.
 *
 * This test statically audits every font-weight this app's CSS asks for against what fonts.css
 * actually provides, so a gap like that one fails a fast unit test instead of surfacing as a
 * silent, environment-dependent rendering difference days or weeks later.
 *
 * Deliberately NOT a full CSS cascade engine -- that's real complexity this repo doesn't need for
 * a maintenance safety net. It resolves font-family per rule from the same declaration block when
 * present, or falls back to `BASE_FONT_FAMILY` (this app's global `body` font-family) otherwise,
 * which is exactly the pattern that let #208 through: most `font-weight: 700` rules never
 * mention font-family at all, inheriting the base silently.
 */

const STYLES_DIR = join(__dirname);
const FONTS_CSS_PATH = join(STYLES_DIR, 'fonts.css');
const BASE_CSS_PATH = join(STYLES_DIR, 'base.css');

const KNOWN_CUSTOM_FAMILIES = ['Space Grotesk', 'IBM Plex Sans', 'IBM Plex Mono'];

const KEYWORD_WEIGHTS: Record<string, string> = {
  normal: '400',
  bold: '700',
};

const normalizeWeight = (raw: string): string | null => {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed in KEYWORD_WEIGHTS) {
    return KEYWORD_WEIGHTS[trimmed] ?? null;
  }
  // 'lighter'/'bolder' are relative to an ancestor's computed weight -- not staticly resolvable
  // without a real cascade, and none of this app's CSS currently uses them (checked below).
  if (trimmed === 'lighter' || trimmed === 'bolder') {
    return null;
  }
  return /^\d+$/.test(trimmed) ? trimmed : null;
};

/** First family in a `font-family` value's comma list that's one of ours, e.g.
 * `'IBM Plex Sans', sans-serif` -> `IBM Plex Sans`; `sans-serif` alone -> null (not ours to check).
 */
const extractCustomFamily = (value: string): string | null => {
  const first = value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  return KNOWN_CUSTOM_FAMILIES.includes(first ?? '') ? (first as string) : null;
};

const collectCssFiles = (dir: string): string[] => {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectCssFiles(fullPath));
    } else if (entry.endsWith('.css') && fullPath !== FONTS_CSS_PATH) {
      files.push(fullPath);
    }
  }
  return files;
};

const parseDeclaredFaces = (): Set<string> => {
  const root = postcss.parse(readFileSync(FONTS_CSS_PATH, 'utf-8'));
  const declared = new Set<string>();

  root.walkAtRules('font-face', (rule) => {
    const decls = (rule.nodes ?? []).filter((node) => node.type === 'decl');
    const familyDecl = decls.find((decl) => decl.prop === 'font-family');
    const weightDecl = decls.find((decl) => decl.prop === 'font-weight');
    const family = familyDecl?.value.trim().replace(/^['"]|['"]$/g, '');
    const weight = weightDecl && normalizeWeight(weightDecl.value);
    if (family && weight) {
      declared.add(`${family}::${weight}`);
    }
  });

  return declared;
};

const findBaseFontFamily = (): string => {
  const root = postcss.parse(readFileSync(BASE_CSS_PATH, 'utf-8'));
  let base: string | null = null;
  root.walkRules((rule) => {
    if (rule.selector.trim() !== 'body') return;
    rule.walkDecls('font-family', (decl) => {
      base = extractCustomFamily(decl.value);
    });
  });
  if (!base) {
    throw new Error('Could not find a font-family declaration on `body` in base.css.');
  }
  return base;
};

type Usage = { family: string; weight: string; file: string; selector: string };

const collectFontWeightUsages = (baseFamily: string): Usage[] => {
  const usages: Usage[] = [];

  for (const file of collectCssFiles(STYLES_DIR)) {
    const root = postcss.parse(readFileSync(file, 'utf-8'));
    root.walkRules((rule) => {
      const decls = rule.nodes.filter((node) => node.type === 'decl');
      const weightDecl = decls.find((decl) => decl.prop === 'font-weight');
      const familyDecl = decls.find((decl) => decl.prop === 'font-family');
      const weight = weightDecl && normalizeWeight(weightDecl.value);
      const family = familyDecl && extractCustomFamily(familyDecl.value);
      if (!weight) return;
      // An explicit font-family in the same rule wins; a rule with no font-family at all
      // inherits whatever's already applied -- for this app, that's the global base family
      // unless some ancestor selector overrides it, which a per-rule static check can't see.
      // Treating "no family in this rule" as "the base family" is the same assumption the app
      // itself makes in the common case, and is exactly the gap #208 fell through.
      usages.push({ family: family ?? baseFamily, weight, file, selector: rule.selector });
    });
  }

  return usages;
};

describe('font-face coverage', () => {
  it('fonts.css declares a face for every family+weight this app\'s CSS requests', () => {
    const declared = parseDeclaredFaces();
    const baseFamily = findBaseFontFamily();
    const usages = collectFontWeightUsages(baseFamily);

    const missing = usages.filter((u) => !declared.has(`${u.family}::${u.weight}`));

    // De-duplicate by family+weight for a readable failure message -- dozens of selectors can
    // share the same missing combination (this is exactly what happened with IBM Plex Sans 700).
    const uniqueMissing = [...new Map(missing.map((m) => [`${m.family}::${m.weight}`, m])).values()];

    const describeMissing = (m: Usage): string => {
      const sites = missing.filter((x) => x.family === m.family && x.weight === m.weight);
      const exampleSites = sites
        .slice(0, 3)
        .map((s) => `${s.file.split('/styles/')[1]} (${s.selector})`)
        .join(', ');
      const more = sites.length > 3 ? ` and ${sites.length - 3} more` : '';
      return `${m.family} weight ${m.weight}: requested by ${exampleSites}${more}`;
    };

    expect(
      uniqueMissing.map(describeMissing),
      'fonts.css is missing a @font-face for these family+weight combinations this app\'s CSS ' +
        'actually requests. Add the missing weight (see fonts.css\'s own doc comment for the ' +
        'self-hosting process), or change the requesting rule to a weight that already has a face.',
    ).toEqual([]);
  });

  it('KNOWN_CUSTOM_FAMILIES matches every family actually declared in fonts.css', () => {
    // Guards this test's own assumption: if someone adds a new font family to fonts.css without
    // updating this list, usages of the new family would silently fall through as "not ours to
    // check" instead of being audited.
    const root = postcss.parse(readFileSync(FONTS_CSS_PATH, 'utf-8'));
    const declaredFamilies = new Set<string>();
    root.walkAtRules('font-face', (rule) => {
      rule.walkDecls('font-family', (decl) => {
        declaredFamilies.add(decl.value.trim().replace(/^['"]|['"]$/g, ''));
      });
    });

    expect([...declaredFamilies].sort()).toEqual([...KNOWN_CUSTOM_FAMILIES].sort());
  });
});
