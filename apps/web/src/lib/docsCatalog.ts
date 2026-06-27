import apiDoc from '../../../../docs/api.md?raw';
import apiReferenceGeneratedDoc from '../../../../docs/api-reference-generated.md?raw';
import architectureDoc from '../../../../docs/architecture.md?raw';
import architectureDiagramSvgUrl from '../../../../docs/images/application-architecture.svg?url';
import changelogDoc from '../../../../CHANGELOG.md?raw';
import classMethodReferenceDoc from '../../../../docs/class-method-reference.md?raw';
import developerSetupDoc from '../../../../docs/developer-setup.md?raw';
import entityRelationshipDiagramDoc from '../../../../docs/erd.md?raw';
import entityRelationshipDiagramSvgUrl from '../../../../docs/images/erd-schema.svg?url';
import localDockerPlatformDoc from '../../../../docs/local-docker-platform.md?raw';
import projectReadmeDoc from '../../../../README.md?raw';
import reconciliationRulesDoc from '../../../../docs/reconciliation-rules.md?raw';
import releaseDoc from '../../../../RELEASE.md?raw';
import sampleConfigDoc from '../../../../docs/sample-config.md?raw';
import scriptsReadmeDoc from '../../../../scripts/README.md?raw';
import testStrategyDoc from '../../../../docs/test-strategy.md?raw';
import userQuickstartDoc from '../../../../docs/user-quickstart.md?raw';

const architectureDocWithResolvedAssets = architectureDoc
  .replaceAll('images/application-architecture.png', architectureDiagramSvgUrl)
  .replaceAll('images/application-architecture.svg', architectureDiagramSvgUrl);

const erdDocWithResolvedAssets = entityRelationshipDiagramDoc.replaceAll(
  'images/erd-schema.svg',
  entityRelationshipDiagramSvgUrl,
);

/** Metadata and Markdown content for one entry in the in-app Documentation Hub. */
type ProjectDocument = {
  id: string;
  title: string;
  track: 'Developer' | 'User';
  category: 'Overview' | 'Architecture' | 'Setup' | 'Reference' | 'Operations';
  summary: string;
  audience: string;
  pathLabel: string;
  content: string;
};

/** Ordered list of all project documents served by the Documentation Hub. */
export const projectDocuments: ProjectDocument[] = [
  {
    id: 'readme',
    title: 'Project Overview',
    track: 'User',
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
    track: 'Developer',
    category: 'Architecture',
    summary:
      'Explains the monorepo structure, application boundaries, data flow, and runtime responsibilities.',
    audience: 'Engineers changing system design or major flows',
    pathLabel: 'docs/architecture.md',
    content: architectureDocWithResolvedAssets,
  },
  {
    id: 'erd',
    title: 'Entity Relationship Diagram',
    track: 'Developer',
    category: 'Architecture',
    summary:
      'Provides the PostgreSQL entity relationship diagram for persistence tables and foreign-key links.',
    audience: 'Engineers working on schema design and persistence behavior',
    pathLabel: 'docs/erd.md',
    content: erdDocWithResolvedAssets,
  },
  {
    id: 'api',
    title: 'API Reference',
    track: 'Developer',
    category: 'Reference',
    summary:
      'Documents the reconciliation endpoints, developer endpoints, request payloads, and response shapes.',
    audience: 'Backend and integration engineers',
    pathLabel: 'docs/api.md',
    content: apiDoc,
  },
  {
    id: 'api-reference-generated',
    title: 'API Reference (Generated)',
    track: 'Developer',
    category: 'Reference',
    summary:
      'Generated class, method, and property documentation coverage and API reference for exported TypeScript classes.',
    audience: 'Engineers validating implementation-level API contracts',
    pathLabel: 'docs/api-reference-generated.md',
    content: apiReferenceGeneratedDoc,
  },
  {
    id: 'developer-setup',
    title: 'Developer Setup',
    track: 'Developer',
    category: 'Setup',
    summary:
      'Covers local environment setup, install steps, dev commands, and expected workflows for contributors.',
    audience: 'Developers onboarding to the repo',
    pathLabel: 'docs/developer-setup.md',
    content: developerSetupDoc,
  },
  {
    id: 'local-docker-platform',
    title: 'Local Docker Platform',
    track: 'Developer',
    category: 'Operations',
    summary:
      'Describes the hardened Docker Desktop topology, migration flow, health checks, and cleanup path.',
    audience: 'Engineers operating the local production-like stack',
    pathLabel: 'docs/local-docker-platform.md',
    content: localDockerPlatformDoc,
  },
  {
    id: 'reconciliation-rules',
    title: 'Reconciliation Rules',
    track: 'User',
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
    track: 'Developer',
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
    track: 'Developer',
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
    track: 'Developer',
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
    track: 'Developer',
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
    track: 'Developer',
    category: 'Operations',
    summary: 'Tracks notable repository changes and milestone-level release history.',
    audience: 'Release reviewers and maintainers',
    pathLabel: 'CHANGELOG.md',
    content: changelogDoc,
  },
  {
    id: 'release-guide',
    title: 'Release Guide',
    track: 'Developer',
    category: 'Operations',
    summary: 'Defines release note expectations, validation evidence, and rollback metadata.',
    audience: 'Engineers preparing handoff or release notes',
    pathLabel: 'RELEASE.md',
    content: releaseDoc,
  },
  {
    id: 'user-quickstart',
    title: 'User Quick Start',
    track: 'User',
    category: 'Setup',
    summary:
      'Walks analysts through running reconciliation, reviewing outcomes, and exporting audit handoff artifacts.',
    audience: 'Financial analysts and business reviewers',
    pathLabel: 'docs/user-quickstart.md',
    content: userQuickstartDoc,
  },
];

/** Fast O(1) lookup map from document ID to `ProjectDocument`, used by the docs viewer routing. */
export const docsById = new Map(projectDocuments.map((document) => [document.id, document]));
