import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The document head is not covered by any component test — nothing renders `index.html` — so the
 * favicon and title can be deleted, renamed or pointed at a missing file and every other suite
 * stays green. This is the only thing watching them.
 */
const ROOT = join(__dirname, '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

describe('index.html head', () => {
  it('sets a real product title, not a filename', () => {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
    expect(title).toBe('Recon Platform');
    // Short enough to survive a crowded tab. A browser shows well under 20 characters when several
    // tabs are open, and a title that truncates to its least distinctive word identifies nothing.
    expect(title.length).toBeLessThanOrEqual(20);
    // A tab reading "index" or "Vite + React" is the default nobody replaced.
    expect(title).not.toMatch(/vite|react|index|untitled/i);
  });

  it('declares the SVG mark first, ahead of the PNG fallback', () => {
    // Order is the point, not just presence. The SVG is the only asset carrying the light-mode
    // fill; the PNG can hold one colour and is there for engines without SVG favicon support.
    const iconLinks = [...html.matchAll(/<link[^>]+rel="icon"[^>]*>/g)].map((match) => match[0]);

    expect(iconLinks.length).toBeGreaterThan(1);
    expect(iconLinks[0]).toContain('type="image/svg+xml"');
    expect(iconLinks[0]).toContain('href="/favicon.svg"');
  });

  it('keeps the light-mode fill rule inside favicon.svg', () => {
    // The whole reason favicon.svg is hand-authored rather than exported. Every shape is
    // `class="m"` with no fill attribute, so losing this rule does not make the mark uncoloured --
    // it makes it SVG's initial fill, solid black, which is invisible on the dark browser chrome
    // the switch exists to serve. Nothing renders an error and the file still parses. The bundled
    // export shipped without it, which is what this assertion is here to catch on the way back in.
    const svg = readFileSync(join(ROOT, 'public', 'favicon.svg'), 'utf8');

    expect(svg).toMatch(/@media\s*\(prefers-color-scheme:\s*light\)/);
    expect(svg).toMatch(/\.m\s*{[^}]*fill:/);
  });

  it('points every icon at a file that actually exists', () => {
    // The failure this catches is a broken href, which renders exactly like having no favicon at
    // all — the browser silently falls back to its generic glyph and nothing reports an error.
    const hrefs = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]+href="([^"]+)"/g)]
      .map((match) => match[1]!)
      .map((href) => href.replace(/^\//, ''));

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(existsSync(join(ROOT, 'public', href))).toBe(true);
    }
  });

  it('keeps the icons small enough to be worth serving', () => {
    // A tab icon has no business being large: it is fetched on every cold load to fill 16 physical
    // pixels. The caps are loose enough not to be a tripwire on ordinary re-exports.
    expect(readFileSync(join(ROOT, 'public', 'favicon-32.png')).byteLength).toBeLessThan(20_000);

    // The SVG is a dozen polygons and a circle — well under 1KB when hand-authored. Tens of KB
    // means someone either embedded a raster or pasted a provenance manifest back in; the bundled
    // export was 8KB of base64 metadata around 600 bytes of drawing.
    expect(readFileSync(join(ROOT, 'public', 'favicon.svg')).byteLength).toBeLessThan(4_000);
  });
});
