import {
  createSampleBankWorkbook,
  createSampleQboWorkbook,
} from '@recon/test-fixtures';
import { mkdir, writeFile } from 'node:fs/promises';

import path from 'node:path';

const outputDirectory = path.resolve('docs', 'sample-files');

const main = async (): Promise<void> => {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, 'sample-bank.xlsx'), await createSampleBankWorkbook());
  await writeFile(path.join(outputDirectory, 'sample-qbo.xlsx'), await createSampleQboWorkbook());
  console.log(`Wrote fixture workbooks to ${outputDirectory}`);
};

void main();
