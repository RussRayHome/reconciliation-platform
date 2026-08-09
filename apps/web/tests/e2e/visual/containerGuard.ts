// Imported for its side effect only, at the top of visual-baseline.spec.ts. Throws immediately on
// module load -- before any test runs -- if this isn't the canonical container from
// docker/e2e-visual.Dockerfile. Without this, a developer running the visual project directly on
// their host would silently compare against (or overwrite) baselines using their own OS's font
// rasterization, reintroducing the exact cross-platform divergence this container exists to fix.
if (process.env.PLAYWRIGHT_CANONICAL_CONTAINER !== '1') {
  throw new Error(
    'The visual Playwright project only runs inside the canonical container -- run it via ' +
      '`npm run test:e2e:visual:container` (or `test:e2e:visual:container:update-snapshots` to ' +
      'regenerate baselines), not directly on the host. Host Chromium renders fonts/subpixel ' +
      'antialiasing differently per OS, which is exactly the divergence this container exists to ' +
      'remove.',
  );
}
