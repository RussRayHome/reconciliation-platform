/**
 * Generates API reference markdown from exported TypeScript classes and enforces
 * documentation coverage for class, method, and property declarations.
 *
 * Usage:
 *   npm run docs:api:generate
 *   npm run docs:api:check
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';

type CliOptions = {
  outFile: string;
  checkOnly: boolean;
};

type ParsedFlagValue = {
  value: string;
  nextIndex: number;
};

type ClassMemberKind = 'constructor' | 'method' | 'property';

type MemberDoc = {
  kind: ClassMemberKind;
  name: string;
  signature: string;
  summary: string;
  documented: boolean;
  line: number;
};

type ClassDoc = {
  name: string;
  sourcePath: string;
  line: number;
  summary: string;
  documented: boolean;
  members: MemberDoc[];
};

type MissingDocItem = {
  sourcePath: string;
  line: number;
  symbol: string;
  kind: 'class' | ClassMemberKind;
};

const defaultOutputPath = 'docs/api-reference-generated.md';
const sourceRoots = ['apps', 'packages', 'scripts'];
const ignoredDirectories = new Set([
  '.git',
  '.vscode',
  'coverage',
  'dist',
  'node_modules',
  'playwright-browsers',
  'playwright-report',
  'test-results',
]);

const usage = [
  'Usage: tsx scripts/generate-api-docs.ts [--out docs/api-reference-generated.md] [--check]',
  '',
  'Examples:',
  '  tsx scripts/generate-api-docs.ts',
  '  tsx scripts/generate-api-docs.ts --check',
  '  tsx scripts/generate-api-docs.ts --out docs/api-reference-generated.md',
].join('\n');

const printUsageAndExit = (): never => {
  console.log(usage);
  process.exit(0);
};

const parseFlagValue = (
  token: string,
  key: 'out',
  argv: string[],
  index: number,
): ParsedFlagValue | null => {
  const equalsPrefix = `--${key}=`;

  if (token.startsWith(equalsPrefix)) {
    const value = token.slice(equalsPrefix.length);
    if (!value) {
      throw new Error(`Missing value for --${key}.`);
    }

    return {
      value,
      nextIndex: index + 1,
    };
  }

  if (token !== `--${key}`) {
    return null;
  }

  const value = argv[index + 1];
  if (!value) {
    throw new Error(`Missing value for --${key}.`);
  }

  return {
    value,
    nextIndex: index + 2,
  };
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    outFile: defaultOutputPath,
    checkOnly: false,
  };

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token) {
      index += 1;
      continue;
    }

    if (token === '--help' || token === '-h') {
      printUsageAndExit();
    }

    if (token === '--check') {
      options.checkOnly = true;
      index += 1;
      continue;
    }

    const outFlag = parseFlagValue(token, 'out', argv, index);
    if (outFlag) {
      options.outFile = outFlag.value;
      index = outFlag.nextIndex;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
};

const isTypeScriptSource = (name: string): boolean => {
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) {
    return false;
  }

  if (name.endsWith('.d.ts')) {
    return false;
  }

  if (
    name.endsWith('.test.ts') ||
    name.endsWith('.test.tsx') ||
    name.endsWith('.spec.ts') ||
    name.endsWith('.spec.tsx')
  ) {
    return false;
  }

  return true;
};

const collectTypeScriptFiles = (directoryPath: string): string[] => {
  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }

      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }

    if (isTypeScriptSource(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
};

const isExported = (declaration: ts.DeclarationStatement): boolean =>
  (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Export) !== 0;

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean => {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }

  return Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
};

const toSingleLine = (value: string): string => value.replaceAll(/\s+/g, ' ').trim();

const getNodeLine = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

const getDocText = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  declaration: ts.Node,
  nameNode?: ts.Node,
): string => {
  if (nameNode) {
    const symbol = checker.getSymbolAtLocation(nameNode);
    const symbolText = toSingleLine(
      ts.displayPartsToString(symbol?.getDocumentationComment(checker) ?? []),
    );
    if (symbolText) {
      return symbolText;
    }
  }

  const nodeSymbol = checker.getSymbolAtLocation(declaration);
  const nodeText = toSingleLine(
    ts.displayPartsToString(nodeSymbol?.getDocumentationComment(checker) ?? []),
  );
  if (nodeText) {
    return nodeText;
  }

  const jsDocs = ts
    .getJSDocCommentsAndTags(declaration)
    .filter((tag): tag is ts.JSDoc => ts.isJSDoc(tag));
  if (jsDocs.length > 0) {
    const text = toSingleLine(
      jsDocs
        .map((doc) => (typeof doc.comment === 'string' ? doc.comment : ''))
        .filter((doc) => doc.length > 0)
        .join(' '),
    );

    if (text) {
      return text;
    }
  }

  const ranges = ts.getLeadingCommentRanges(sourceFile.text, declaration.pos) ?? [];
  for (const range of ranges) {
    const comment = sourceFile.text.slice(range.pos, range.end).trim();
    if (comment.startsWith('/**')) {
      const cleaned = toSingleLine(
        comment
          .replaceAll('/**', '')
          .replaceAll('*/', '')
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/u, ''))
          .join(' '),
      );
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return '';
};

const getMethodSignature = (
  checker: ts.TypeChecker,
  declaration:
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): string => {
  const signature = checker.getSignatureFromDeclaration(declaration);
  if (!signature) {
    const name = ts.isConstructorDeclaration(declaration)
      ? 'constructor'
      : (declaration.name?.getText() ?? 'unknown');
    return `${name}(...)`;
  }

  const signatureText = checker.signatureToString(signature);
  const name = ts.isConstructorDeclaration(declaration)
    ? 'constructor'
    : (declaration.name?.getText() ?? 'unknown');
  return `${name}${signatureText}`;
};

const getPropertySignature = (
  checker: ts.TypeChecker,
  declaration: ts.PropertyDeclaration,
): string => {
  const name = declaration.name.getText();
  const type = checker.getTypeAtLocation(declaration);
  return `${name}: ${checker.typeToString(type)}`;
};

const shouldSkipMember = (member: ts.ClassElement): boolean => {
  if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) {
    return true;
  }

  if (ts.isIndexSignatureDeclaration(member)) {
    return true;
  }

  return false;
};

const collectClassMembers = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  declaration: ts.ClassDeclaration,
): MemberDoc[] => {
  const members: MemberDoc[] = [];

  for (const member of declaration.members) {
    if (shouldSkipMember(member)) {
      continue;
    }

    if (ts.isConstructorDeclaration(member)) {
      const summary = getDocText(checker, sourceFile, member);
      members.push({
        kind: 'constructor',
        name: 'constructor',
        signature: getMethodSignature(checker, member),
        summary,
        documented: summary.length > 0,
        line: getNodeLine(sourceFile, member),
      });
      continue;
    }

    if (ts.isMethodDeclaration(member)) {
      const nameNode = member.name;
      const summary = getDocText(checker, sourceFile, member, nameNode);
      members.push({
        kind: 'method',
        name: nameNode.getText(),
        signature: getMethodSignature(checker, member),
        summary,
        documented: summary.length > 0,
        line: getNodeLine(sourceFile, member),
      });
      continue;
    }

    if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
      const nameNode = member.name;
      const summary = getDocText(checker, sourceFile, member, nameNode);
      members.push({
        kind: 'property',
        name: nameNode.getText(),
        signature: getMethodSignature(checker, member),
        summary,
        documented: summary.length > 0,
        line: getNodeLine(sourceFile, member),
      });
      continue;
    }

    if (ts.isPropertyDeclaration(member)) {
      const nameNode = member.name;
      const summary = getDocText(checker, sourceFile, member, nameNode);
      members.push({
        kind: 'property',
        name: nameNode.getText(),
        signature: getPropertySignature(checker, member),
        summary,
        documented: summary.length > 0,
        line: getNodeLine(sourceFile, member),
      });
    }
  }

  return members;
};

const collectExportedClassDocs = (program: ts.Program, filePaths: string[]): ClassDoc[] => {
  const checker = program.getTypeChecker();
  const docs: ClassDoc[] = [];

  for (const filePath of filePaths) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      continue;
    }

    for (const statement of sourceFile.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name || !isExported(statement)) {
        continue;
      }

      const summary = getDocText(checker, sourceFile, statement, statement.name);
      docs.push({
        name: statement.name.text,
        sourcePath: relative(process.cwd(), filePath).replaceAll('\\', '/'),
        line: getNodeLine(sourceFile, statement),
        summary,
        documented: summary.length > 0,
        members: collectClassMembers(checker, sourceFile, statement),
      });
    }
  }

  return docs.sort((a, b) => {
    if (a.sourcePath === b.sourcePath) {
      return a.name.localeCompare(b.name);
    }
    return a.sourcePath.localeCompare(b.sourcePath);
  });
};

const collectMissingDocs = (classes: ClassDoc[]): MissingDocItem[] => {
  const missing: MissingDocItem[] = [];

  for (const classDoc of classes) {
    if (!classDoc.documented) {
      missing.push({
        sourcePath: classDoc.sourcePath,
        line: classDoc.line,
        symbol: classDoc.name,
        kind: 'class',
      });
    }

    for (const member of classDoc.members) {
      if (!member.documented) {
        missing.push({
          sourcePath: classDoc.sourcePath,
          line: member.line,
          symbol: `${classDoc.name}.${member.name}`,
          kind: member.kind,
        });
      }
    }
  }

  return missing;
};

const renderMemberSection = (className: string, title: string, members: MemberDoc[]): string[] => {
  const heading = `#### ${className} ${title}`;

  if (members.length === 0) {
    return [heading, '', '- None', ''];
  }

  const lines = [heading, ''];
  for (const member of members) {
    const summary = member.summary || '_No summary provided._';
    lines.push(`- \`${member.signature}\` — ${summary}`);
  }
  lines.push('');
  return lines;
};

const renderApiReferenceMarkdown = (classes: ClassDoc[], missing: MissingDocItem[]): string => {
  const nowIso = new Date().toISOString();
  const totalMembers = classes.reduce((count, classDoc) => count + classDoc.members.length, 0);

  const lines: string[] = [
    '# API Reference (Generated)',
    '',
    `Generated at ${nowIso}.`,
    '',
    '## Coverage Summary',
    '',
    `- Exported classes scanned: ${classes.length}`,
    `- Class members scanned: ${totalMembers}`,
    `- Missing documentation items: ${missing.length}`,
    '',
  ];

  if (missing.length > 0) {
    lines.push('## Missing Documentation', '');
    for (const item of missing) {
      lines.push(`- ${item.kind}: \`${item.symbol}\` (${item.sourcePath}:${item.line})`);
    }
    lines.push('');
  }

  lines.push('## Exported Classes', '');

  if (classes.length === 0) {
    lines.push('- No exported classes found.', '');
    return `${lines.join('\n').trimEnd()}\n`;
  }

  for (const classDoc of classes) {
    lines.push(
      `### ${classDoc.name}`,
      '',
      `- Source: \`${classDoc.sourcePath}:${classDoc.line}\``,
      `- Summary: ${classDoc.summary || '_No summary provided._'}`,
      '',
    );

    const constructors = classDoc.members.filter((member) => member.kind === 'constructor');
    const methods = classDoc.members.filter((member) => member.kind === 'method');
    const properties = classDoc.members.filter((member) => member.kind === 'property');

    lines.push(
      ...renderMemberSection(classDoc.name, 'Constructors', constructors),
      ...renderMemberSection(classDoc.name, 'Methods', methods),
      ...renderMemberSection(classDoc.name, 'Properties', properties),
    );
  }

  return `${lines.join('\n').trimEnd()}\n`;
};

const collectSourceFiles = (): string[] => {
  const rootPath = process.cwd();
  const files = sourceRoots
    .map((segment) => resolve(rootPath, segment))
    .flatMap((directoryPath) => collectTypeScriptFiles(directoryPath));

  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
};

const printMissingDocs = (missing: MissingDocItem[]): void => {
  if (missing.length === 0) {
    console.log(
      'Documentation coverage check passed for exported classes, methods, and properties.',
    );
    return;
  }

  console.error('Missing documentation detected for exported classes/methods/properties:');
  for (const item of missing) {
    console.error(`- ${item.kind}: ${item.symbol} (${item.sourcePath}:${item.line})`);
  }
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const sourceFiles = collectSourceFiles();

  const program = ts.createProgram(sourceFiles, {
    allowJs: false,
    checkJs: false,
    declaration: false,
    emitDeclarationOnly: false,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ES2022,
  });

  const classes = collectExportedClassDocs(program, sourceFiles);
  const missing = collectMissingDocs(classes);
  const markdown = renderApiReferenceMarkdown(classes, missing);

  if (!options.checkOnly) {
    const outputPath = resolve(process.cwd(), options.outFile);
    writeFileSync(outputPath, markdown, 'utf8');
    console.log(`Generated API documentation at ${relative(process.cwd(), outputPath)}.`);
  }

  printMissingDocs(missing);
  if (missing.length > 0) {
    process.exit(1);
  }
};

main();
