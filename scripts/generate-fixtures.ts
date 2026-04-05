import {
  createAllExceptionsBankWorkbook,
  createAllExceptionsQboWorkbook,
  createSampleBankWorkbook,
  createSampleQboWorkbook,
} from '@recon/test-fixtures';
import { mkdir, writeFile } from 'node:fs/promises';

import path from 'node:path';

const outputDirectory = path.resolve('docs', 'sample-files');

const main = async (): Promise<void> => {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(outputDirectory, 'sample-bank.xlsx'), await createSampleBankWorkbook()),
    writeFile(path.join(outputDirectory, 'sample-qbo.xlsx'), await createSampleQboWorkbook()),
    writeFile(
      path.join(outputDirectory, 'sample-all-exceptions-bank.xlsx'),
      await createAllExceptionsBankWorkbook(),
    ),
    writeFile(
      path.join(outputDirectory, 'sample-all-exceptions-qbo.xlsx'),
      await createAllExceptionsQboWorkbook(),
    ),
  ]);
  console.log(`Wrote fixture workbooks to ${outputDirectory}`);
};

void main();
