/**
 * Generates representative sample bank and GL reconciliation workbooks and writes them
 * to `docs/sample-files/`. Used to produce reference artifacts for documentation and
 * manual testing. Invoked via `npm run fixtures:generate`.
 */
import {
  createAllExceptionsBankWorkbook,
  createAllExceptionsGlWorkbook,
  createSampleBankWorkbook,
  createSampleGlWorkbook,
} from '@recon/test-fixtures';
import { mkdir, writeFile } from 'node:fs/promises';

import path from 'node:path';

const outputDirectory = path.resolve('docs', 'sample-files');

const main = async (): Promise<void> => {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, 'sample-bank.xlsx'), await createSampleBankWorkbook()),
    writeFile(path.join(outputDirectory, 'sample-gl.xlsx'), await createSampleGlWorkbook()),
    writeFile(
      path.join(outputDirectory, 'sample-all-exceptions-bank.xlsx'),
      await createAllExceptionsBankWorkbook(),
    ),
    writeFile(
      path.join(outputDirectory, 'sample-all-exceptions-gl.xlsx'),
      await createAllExceptionsGlWorkbook(),
    ),
  ]);
  console.log(`Wrote fixture workbooks to ${outputDirectory}`);
};

void main();
