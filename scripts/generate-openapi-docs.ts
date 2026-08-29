import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiSpec } from '../apps/api/src/app';

type CliOptions = {
  outFile: string;
  checkOnly: boolean;
};

const defaultOutputPath = 'generated/openapi.generated.json';

const usage = [
  'Usage: tsx scripts/generate-openapi-docs.ts [--out generated/openapi.generated.json] [--check]',
  '',
  'Examples:',
  '  tsx scripts/generate-openapi-docs.ts',
  '  tsx scripts/generate-openapi-docs.ts --check',
  '  tsx scripts/generate-openapi-docs.ts --out generated/openapi.generated.json',
].join('\n');

type ParsedOutFlag = {
  value: string;
  consumeNext: boolean;
};

const parseOutFlag = (token: string, nextToken: string | undefined): ParsedOutFlag | null => {
  if (token === '--out') {
    if (!nextToken) {
      throw new Error('Missing value for --out');
    }

    return {
      value: nextToken,
      consumeNext: true,
    };
  }

  if (!token.startsWith('--out=')) {
    return null;
  }

  const value = token.slice('--out='.length);
  if (!value) {
    throw new Error('Missing value for --out');
  }

  return {
    value,
    consumeNext: false,
  };
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    outFile: defaultOutputPath,
    checkOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token) {
      continue;
    }

    if (token === '--help' || token === '-h') {
      console.log(usage);
      process.exit(0);
    }

    if (token === '--check') {
      options.checkOnly = true;
      continue;
    }

    const parsedOutFlag = parseOutFlag(token, argv[index + 1]);
    if (parsedOutFlag) {
      options.outFile = parsedOutFlag.value;
      if (parsedOutFlag.consumeNext) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
};

const renderSpec = (): string => `${JSON.stringify(buildOpenApiSpec(), null, 2)}\n`;

const run = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = resolve(process.cwd(), options.outFile);
  const rendered = renderSpec();

  if (options.checkOnly) {
    if (!existsSync(outputPath)) {
      throw new Error(`OpenAPI output is missing: ${options.outFile}`);
    }

    const existing = readFileSync(outputPath, 'utf8');
    if (existing !== rendered) {
      throw new Error(
        `OpenAPI output is out of date. Run: tsx scripts/generate-openapi-docs.ts --out ${options.outFile}`,
      );
    }

    console.log(`OpenAPI output is up to date: ${options.outFile}`);
    return;
  }

  writeFileSync(outputPath, rendered, 'utf8');
  console.log(`Wrote OpenAPI output to ${options.outFile}`);
};

run();
