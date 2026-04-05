import apiDoc from '../../../../docs/api.md?raw';
import architectureDoc from '../../../../docs/architecture.md?raw';
import changelogDoc from '../../../../CHANGELOG.md?raw';
import classMethodReferenceDoc from '../../../../docs/class-method-reference.md?raw';
import developerSetupDoc from '../../../../docs/developer-setup.md?raw';
import projectReadmeDoc from '../../../../README.md?raw';
import reconciliationRulesDoc from '../../../../docs/reconciliation-rules.md?raw';
import releaseDoc from '../../../../RELEASE.md?raw';
import sampleConfigDoc from '../../../../docs/sample-config.md?raw';
import scriptsReadmeDoc from '../../../../scripts/README.md?raw';
import testStrategyDoc from '../../../../docs/test-strategy.md?raw';

export type ProjectDocument = {
  id: string;
  title: string;
  category: 'Overview' | 'Architecture' | 'Setup' | 'Reference' | 'Operations';
  summary: string;
  audience: string;
  pathLabel: string;
  content: string;
};

export const projectDocuments: ProjectDocument[] = [
  {
    id: 'readme',
    title: 'Project Overview',
    category: 'Overview',
    summary:
      'Start here for the product purpose, workspace layout, developer dashboard, and core scripts.',
    audience: 'New contributors and reviewers',
    pathLabel: 'README.md',
    content: projectReadmeDoc,
  },
  {
    id: 'architecture',
    title: 'Architecture',
    category: 'Architecture',
    summary:
      'Explains the monorepo structure, application boundaries, data flow, and runtime responsibilities.',
    audience: 'Engineers changing system design or major flows',
    pathLabel: 'docs/architecture.md',
    content: architectureDoc,
  },
  {
    id: 'api',
    title: 'API Reference',
    category: 'Reference',
    summary:
      'Documents the reconciliation endpoints, developer endpoints, request payloads, and response shapes.',
    audience: 'Backend and integration engineers',
    pathLabel: 'docs/api.md',
    content: apiDoc,
  },
  {
    id: 'developer-setup',
    title: 'Developer Setup',
    category: 'Setup',
    summary:
      'Covers local environment setup, install steps, dev commands, and expected workflows for contributors.',
    audience: 'Developers onboarding to the repo',
    pathLabel: 'docs/developer-setup.md',
    content: developerSetupDoc,
  },
  {
    id: 'reconciliation-rules',
    title: 'Reconciliation Rules',
    category: 'Reference',
    summary:
      'Defines the matching heuristics, exception categories, and business logic used by the engine.',
    audience: 'Engineers validating reconciliation behavior',
    pathLabel: 'docs/reconciliation-rules.md',
    content: reconciliationRulesDoc,
  },
  {
    id: 'sample-config',
    title: 'Sample Config',
    category: 'Setup',
    summary:
      'Shows example configuration structure and how account-specific overrides are represented.',
    audience: 'Engineers adjusting account config or defaults',
    pathLabel: 'docs/sample-config.md',
    content: sampleConfigDoc,
  },
  {
    id: 'test-strategy',
    title: 'Test Strategy',
    category: 'Operations',
    summary:
      'Summarizes the unit, integration, and end-to-end test layers and how quality is validated.',
    audience: 'Engineers extending coverage or validating releases',
    pathLabel: 'docs/test-strategy.md',
    content: testStrategyDoc,
  },
  {
    id: 'class-method-reference',
    title: 'Class and Method Reference',
    category: 'Reference',
    summary:
      'Captures API-level class and method responsibilities for the main modules in the system.',
    audience: 'Engineers navigating implementation details',
    pathLabel: 'docs/class-method-reference.md',
    content: classMethodReferenceDoc,
  },
  {
    id: 'scripts-guide',
    title: 'Scripts Guide',
    category: 'Operations',
    summary:
      'Explains reusable scripts, workbook diagnostics, and how to run local investigation utilities safely.',
    audience: 'Engineers using repo tooling and diagnostics',
    pathLabel: 'scripts/README.md',
    content: scriptsReadmeDoc,
  },
  {
    id: 'changelog',
    title: 'Changelog',
    category: 'Operations',
    summary:
      'Tracks notable repository changes and milestone-level release history.',
    audience: 'Release reviewers and maintainers',
    pathLabel: 'CHANGELOG.md',
    content: changelogDoc,
  },
  {
    id: 'release-guide',
    title: 'Release Guide',
    category: 'Operations',
    summary:
      'Defines release note expectations, validation evidence, and rollback metadata.',
    audience: 'Engineers preparing handoff or release notes',
    pathLabel: 'RELEASE.md',
    content: releaseDoc,
  },
];

export const docsById = new Map(projectDocuments.map((document) => [document.id, document]));