/**
 * The OpenAPI path entries for routes beyond the original hand-written twelve (#462).
 *
 * A separate module because `app.ts` is already ~4,700 lines and this is ~50 entries of reference
 * material with no logic in it; keeping it here means the spec can be read and reviewed without
 * scrolling through route handlers.
 *
 * **Coverage is enforced, not trusted.** `scripts/generate-openapi-docs.ts --check` derives the real
 * route inventory from the Express router and fails when a registered route has no entry here or in
 * `buildOpenApiSpec`'s own literal. That check is the durable half of #462: before it, the check
 * compared the generated file against its own generator, so a route nobody documented was not a
 * mismatch and the gate passed while describing 16 of 67 operations.
 *
 * Response schemas are deliberately shallow -- a status code and a description. #462 scopes schema
 * depth as separate work, and a shallow-but-complete spec is more useful to an integrator than a
 * deep one covering a quarter of the surface.
 */

type ResponseMap = Readonly<Record<string, string>>;

type OperationInput = {
  summary: string;
  description?: string;
  responses: ResponseMap;
};

type PathParameter = {
  name: string;
  in: 'path';
  required: true;
  schema: { type: 'string' };
};

/**
 * Path parameters, read off the path itself so the two can never disagree. Written `{name}` here
 * because that is OpenAPI's spelling; Express spells the same thing `:name`, and the coverage check
 * normalises between them.
 */
const pathParameters = (path: string): PathParameter[] =>
  [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name: name!,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));

const toResponses = (responses: ResponseMap): Record<string, { description: string }> =>
  Object.fromEntries(
    Object.entries(responses).map(([status, description]) => [status, { description }]),
  );

const describe = (
  path: string,
  operations: Readonly<Record<string, OperationInput>>,
): Record<string, unknown> => {
  const parameters = pathParameters(path);

  return {
    [path]: {
      ...(parameters.length > 0 ? { parameters } : {}),
      ...Object.fromEntries(
        Object.entries(operations).map(([method, operation]) => [
          method,
          {
            summary: operation.summary,
            ...(operation.description ? { description: operation.description } : {}),
            responses: toResponses(operation.responses),
          },
        ]),
      ),
    },
  };
};

const NOT_FOUND = 'Not found, or not visible to this organization';
const UNAUTHORIZED = 'Missing or invalid credentials';
const FORBIDDEN = 'The signed-in role may not perform this action';
const VALIDATION = 'Request failed validation';

export const additionalOpenApiPaths: Record<string, unknown> = {
  // ── Accounts and aliases (Track A: account identity) ────────────────────────────────────────
  ...describe('/api/accounts', {
    get: {
      summary: 'List reconciliation accounts',
      responses: { 200: 'The organization’s accounts', 401: UNAUTHORIZED },
    },
    post: {
      summary: 'Register a reconciliation account',
      responses: { 201: 'Account created', 400: VALIDATION, 401: UNAUTHORIZED, 403: FORBIDDEN },
    },
  }),
  ...describe('/api/accounts/suggest', {
    get: {
      summary: 'Suggest an account for an uploaded statement',
      description:
        'Matches a bank file name against registered accounts. Advisory only — the operator confirms the assignment, and a disagreement is reported rather than auto-resolved.',
      responses: { 200: 'Ranked suggestions', 401: UNAUTHORIZED },
    },
  }),
  ...describe('/api/accounts/{id}', {
    patch: {
      summary: 'Amend a reconciliation account',
      responses: { 200: 'Updated account', 400: VALIDATION, 404: NOT_FOUND, 403: FORBIDDEN },
    },
  }),
  ...describe('/api/aliases', {
    get: { summary: 'List account aliases', responses: { 200: 'Aliases', 401: UNAUTHORIZED } },
    post: {
      summary: 'Create an account alias',
      responses: { 201: 'Alias created', 400: VALIDATION, 403: FORBIDDEN },
    },
  }),
  ...describe('/api/aliases/{id}', {
    put: {
      summary: 'Replace an account alias',
      responses: { 200: 'Alias updated', 400: VALIDATION, 404: NOT_FOUND, 403: FORBIDDEN },
    },
    delete: {
      summary: 'Remove an account alias',
      responses: { 204: 'Alias removed', 404: NOT_FOUND, 403: FORBIDDEN },
    },
  }),

  // ── Subledger entity registries (AP / AR) ──────────────────────────────────────────────────
  ...describe('/api/subledger-entities/{kind}', {
    get: {
      summary: 'List registered AP or AR entities',
      description: 'kind is "ap" or "ar". One entity id may legitimately exist in both registries.',
      responses: { 200: 'Registered entities', 401: UNAUTHORIZED },
    },
    post: {
      summary: 'Register an AP or AR entity',
      responses: { 201: 'Entity registered', 400: VALIDATION, 409: 'Entity id already registered', 403: FORBIDDEN },
    },
  }),
  ...describe('/api/subledger-entities/{kind}/{entityRowId}', {
    patch: {
      summary: 'Amend or deactivate a subledger entity',
      description:
        'The entity id itself is immutable once any import references it; entities are deactivated, never deleted.',
      responses: { 200: 'Updated entity', 400: VALIDATION, 404: NOT_FOUND, 403: FORBIDDEN },
    },
  }),

  // ── Authentication and identity ────────────────────────────────────────────────────────────
  ...describe('/api/auth/signup', {
    post: {
      summary: 'Create an account',
      responses: { 201: 'Account created', 400: VALIDATION, 409: 'Username or email already in use' },
    },
  }),
  ...describe('/api/auth/identity/confirm', {
    post: {
      summary: 'Confirm an identity challenge',
      responses: { 200: 'Identity confirmed', 400: VALIDATION, 401: UNAUTHORIZED },
    },
  }),
  ...describe('/api/auth/identity/resend', {
    post: {
      summary: 'Resend an identity challenge',
      responses: { 202: 'Challenge resent', 400: VALIDATION, 401: UNAUTHORIZED },
    },
  }),
  ...describe('/api/entity-verification/check', {
    post: {
      summary: 'Check an organization’s entity verification status',
      responses: { 200: 'Verification result', 400: VALIDATION },
    },
  }),
  ...describe('/api/organizations/entity-verification/retry', {
    post: {
      summary: 'Retry entity verification for an organization',
      responses: { 202: 'Retry accepted', 403: FORBIDDEN, 404: NOT_FOUND },
    },
  }),

  // ── Import runs ────────────────────────────────────────────────────────────────────────────
  ...describe('/api/imports/runs', {
    post: {
      summary: 'Create an import run',
      description:
        'Multipart. Bank statements (1–4) and one GL workbook are required; AP, AR and payroll files are additive and optional.',
      responses: { 201: 'Run created', 400: VALIDATION, 403: FORBIDDEN, 409: 'Bank account assignment conflict' },
    },
  }),
  ...describe('/api/imports/runs/latest', {
    get: { summary: 'Fetch the most recent import run', responses: { 200: 'Latest run, or null', 401: UNAUTHORIZED } },
  }),
  ...describe('/api/imports/runs/{id}', {
    get: { summary: 'Fetch an import run', responses: { 200: 'Run summary', 404: NOT_FOUND } },
  }),
  ...describe('/api/imports/runs/{id}/submit', {
    post: { summary: 'Submit an import run for approval', responses: { 200: 'Run submitted', 409: 'Run is not in a submittable state', 403: FORBIDDEN } },
  }),
  ...describe('/api/imports/runs/{id}/withdraw', {
    post: { summary: 'Withdraw a submitted import run', responses: { 200: 'Run withdrawn', 409: 'Run is not withdrawable', 403: FORBIDDEN } },
  }),
  ...describe('/api/imports/runs/{id}/import', {
    post: { summary: 'Import an approved run’s validated rows', responses: { 202: 'Import started', 409: 'Run is not approved', 403: FORBIDDEN } },
  }),
  ...describe('/api/imports/runs/{id}/close', {
    post: { summary: 'Close an import run', responses: { 200: 'Run closed', 409: 'Run is not closeable', 403: FORBIDDEN } },
  }),
  ...describe('/api/imports/runs/{id}/reopen', {
    post: { summary: 'Reopen a closed import run', responses: { 200: 'Run reopened', 409: 'Run is not reopenable', 403: FORBIDDEN } },
  }),
  ...describe('/api/imports/runs/{id}/events', {
    get: { summary: 'List an import run’s lifecycle events', responses: { 200: 'Ordered event history', 404: NOT_FOUND } },
  }),
  ...describe('/api/imports/runs/{id}/issues', {
    get: { summary: 'List validation issues for a run', responses: { 200: 'Paged validation issues', 404: NOT_FOUND } },
  }),
  ...describe('/api/imports/runs/{id}/records', {
    get: { summary: 'List canonical records produced by a run', responses: { 200: 'Paged canonical records', 404: NOT_FOUND } },
  }),
  ...describe('/api/imports/runs/{id}/error-report.csv', {
    get: { summary: 'Download a run’s validation errors as CSV', responses: { 200: 'CSV error report', 404: NOT_FOUND } },
  }),
  ...describe('/api/imports/runs/{id}/files/{fileId}/failure-detail', {
    get: {
      summary: 'Explain why one file failed validation',
      description:
        'Drives the structure-failure and all-rows-invalid screens. headerComparison is null when no expected-header set exists for the file’s source type.',
      responses: { 200: 'Failure detail', 404: NOT_FOUND },
    },
  }),
  ...describe('/api/imports/runs/{id}/files/{fileId}/rows', {
    get: { summary: 'List one file’s parsed rows', responses: { 200: 'Paged rows', 404: NOT_FOUND } },
  }),
  ...describe('/api/imports/open-items/{id}/write-off', {
    post: { summary: 'Write off an open item', responses: { 200: 'Item written off', 403: FORBIDDEN, 404: NOT_FOUND } },
  }),

  // ── Reconciliation results ─────────────────────────────────────────────────────────────────
  ...describe('/api/reconciliation/runs', {
    get: { summary: 'List reconciliation runs', responses: { 200: 'Runs', 401: UNAUTHORIZED } },
  }),
  ...describe('/api/reconciliation/runs/{id}/rollforward', {
    get: { summary: 'Fetch a run’s roll-forward proof', responses: { 200: 'Roll-forward figures', 404: NOT_FOUND } },
  }),
  ...describe('/api/reconciliation/open-items', {
    get: {
      summary: 'List open reconciling items',
      description:
        'Bank and general ledger activity only. Unpaid AR invoices are not represented until AR subledger import ships.',
      responses: { 200: 'Open items schedule', 401: UNAUTHORIZED },
    },
  }),
  ...describe('/api/reconciliation/{id}/reviewer-decisions', {
    get: { summary: 'List reviewer decisions for a run', responses: { 200: 'Decisions', 404: NOT_FOUND } },
    post: { summary: 'Record a reviewer decision', responses: { 201: 'Decision recorded', 400: VALIDATION, 403: FORBIDDEN } },
  }),
  ...describe('/api/reconciliation/{id}/reviewer-decisions/{targetId}', {
    delete: { summary: 'Withdraw a reviewer decision', responses: { 204: 'Decision withdrawn', 403: FORBIDDEN, 404: NOT_FOUND } },
  }),

  // ── Approvals ──────────────────────────────────────────────────────────────────────────────
  ...describe('/api/approvals', {
    get: { summary: 'List pending approvals', responses: { 200: 'Approvals grouped by type', 401: UNAUTHORIZED } },
  }),
  ...describe('/api/approvals/counts', {
    get: {
      summary: 'Count pending approvals by group',
      description: 'Drives the rail badge, which is absent rather than zero when nothing is pending.',
      responses: { 200: 'Counts by group', 401: UNAUTHORIZED },
    },
  }),
  ...describe('/api/approvals/{type}/{id}/claim', {
    post: { summary: 'Claim an approval for review', responses: { 200: 'Claim recorded', 409: 'Already claimed', 403: FORBIDDEN } },
  }),
  ...describe('/api/approvals/{type}/{id}/decision', {
    post: {
      summary: 'Approve or reject a claimed item',
      description:
        'Self-approval is refused by a database constraint (segregation of duty), not only by this endpoint.',
      responses: { 200: 'Decision recorded', 403: 'Forbidden, including self-approval', 409: 'Not claimed by this reviewer' },
    },
  }),

  // ── Mapping profiles ───────────────────────────────────────────────────────────────────────
  ...describe('/api/mapping/canonical-fields', {
    get: { summary: 'List canonical fields a mapping may target', responses: { 200: 'Canonical field catalog', 401: UNAUTHORIZED } },
  }),
  ...describe('/api/mapping/profiles', {
    get: { summary: 'List mapping profiles', responses: { 200: 'Profiles', 401: UNAUTHORIZED } },
    post: { summary: 'Create a mapping profile', responses: { 201: 'Profile created', 400: VALIDATION, 403: FORBIDDEN } },
  }),
  ...describe('/api/mapping/profiles/{name}', {
    get: { summary: 'Fetch a mapping profile', responses: { 200: 'Profile', 404: NOT_FOUND } },
  }),
  ...describe('/api/mapping/profiles/{name}/retire', {
    post: {
      summary: 'Retire a mapping profile',
      description: 'Retire is the only removal path; profiles are never deleted.',
      responses: { 200: 'Profile retired', 404: NOT_FOUND, 403: FORBIDDEN },
    },
  }),

  // ── Matching rules ─────────────────────────────────────────────────────────────────────────
  ...describe('/api/rules/catalog', {
    get: { summary: 'List matching rules and their platform defaults', responses: { 200: 'Rule catalog', 401: UNAUTHORIZED } },
  }),
  ...describe('/api/rules/versions', {
    get: { summary: 'List matching-config versions', responses: { 200: 'Versions, newest first', 401: UNAUTHORIZED } },
  }),
  ...describe('/api/rules/versions/draft', {
    post: { summary: 'Open a draft matching-config version', responses: { 201: 'Draft created', 409: 'A draft already exists', 403: FORBIDDEN } },
  }),
  ...describe('/api/rules/versions/{id}/publish', {
    post: {
      summary: 'Publish a draft matching-config version',
      description: 'Moves the draft to ACTIVE and the previously active version to SUPERSEDED in one transaction.',
      responses: { 200: 'Version published', 403: FORBIDDEN, 409: 'Version is not a publishable draft' },
    },
  }),
};
