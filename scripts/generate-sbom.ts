/**
 * Generates a CycloneDX software bill of materials (SBOM) for the npm dependency tree and each
 * published container image, as CI artifacts retained per run (ISSUE-035).
 *
 * Trivy already scans these same images for vulnerabilities (security-component-scan.mjs), and
 * emits CycloneDX directly from the same scan data -- this is deliberately a separate, minimal
 * script rather than a mode bolted onto that scanner: an SBOM is an inventory artifact, not a
 * vulnerability finding, and that file's parsing is tightly coupled to CVE output shape.
 *
 * The npm SBOM points at package-lock.json specifically, not `trivy fs .` on the whole repo --
 * the latter also picks up incidental manifests bundled inside third-party packages (e.g. a
 * templated pom.xml shipped inside aws-cdk's own init-templates), which aren't dependencies of
 * this project at all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

type CliOptions = {
  outDir: string;
};

const usage = [
  'Usage: tsx scripts/generate-sbom.ts [--out-dir .ci-out/sbom]',
  '',
  'Requires trivy and (for image SBOMs) the target images already built locally --',
  'see "Build container images" in .github/workflows/dashboard-status.yml\'s security job.',
].join('\n');

const defaultOutDir = '.ci-out/sbom';

// The two images actually shipped/deployed -- migrate and the postgres base image are internal
// build/infra images, not product artifacts a buyer's diligence process is asking about.
const PUBLISHED_IMAGES: Array<{ name: string; image: string }> = [
  { name: 'api', image: '${COMPOSE_PROJECT_NAME:-reconciliation-platform-dev}-api' },
  { name: 'web', image: '${COMPOSE_PROJECT_NAME:-reconciliation-platform-dev}-web' },
];

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { outDir: defaultOutDir };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      console.log(usage);
      process.exit(0);
    }
    if (token === '--out-dir') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --out-dir.');
      }
      options.outDir = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}. \n\n${usage}`);
  }

  return options;
};

const resolveImageName = (template: string): string => {
  const projectName = process.env.COMPOSE_PROJECT_NAME ?? 'reconciliation-platform-dev';
  return template.replace('${COMPOSE_PROJECT_NAME:-reconciliation-platform-dev}', projectName);
};

const runTrivy = (args: string[]): void => {
  execFileSync('trivy', args, { stdio: 'inherit' });
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.outDir, { recursive: true });

  const lockfilePath = 'package-lock.json';
  if (!existsSync(lockfilePath)) {
    throw new Error(`${lockfilePath} not found -- run from the repo root.`);
  }

  const npmSbomPath = path.join(options.outDir, 'npm-workspace.cdx.json');
  console.log(`Generating npm workspace SBOM -> ${npmSbomPath}`);
  runTrivy(['fs', '--format', 'cyclonedx', '--output', npmSbomPath, lockfilePath]);

  for (const target of PUBLISHED_IMAGES) {
    const imageRef = resolveImageName(target.image);
    const imageSbomPath = path.join(options.outDir, `${target.name}-image.cdx.json`);

    let imageExists = true;
    try {
      execFileSync('docker', ['image', 'inspect', imageRef], { stdio: 'ignore' });
    } catch {
      imageExists = false;
    }

    if (!imageExists) {
      console.log(`Skipping ${target.name} image SBOM: ${imageRef} is not built locally.`);
      continue;
    }

    console.log(`Generating ${target.name} image SBOM (${imageRef}) -> ${imageSbomPath}`);
    runTrivy(['image', '--format', 'cyclonedx', '--output', imageSbomPath, imageRef]);
  }

  console.log(`SBOMs written to ${options.outDir}`);
};

main();
