// Regression-detection load test, not a capacity/stress benchmark -- run the same golden path
// (login, create an import run, submit, wait for validation+matching, approve) repeatedly against
// Stage and compare this run's numbers against a previous run's in Grafana (same $environment
// dashboard everything else already uses -- see reconciliation-platform-overview.json). A laptop
// running Stage alongside Dev cannot produce an honest absolute-capacity number (see the
// discussion this script came out of) -- what it *can* do reliably is answer "did the last code
// change make this slower than before," which is the actual goal.
//
// Usage (via npm script -- preferred):
//   npm run perf:k6:stage
//
// Direct:
//   docker run --rm --network reconciliation-platform-stage_app \
//     -v "$(pwd)/scripts/perf:/scripts:ro" \
//     -v "$(pwd)/docs/sample-files/multi-account-merge-test:/fixtures:ro" \
//     -e K6_BASE_URL=http://reconciliation-platform-stage-api-1:4000 \
//     -e K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
//     grafana/k6:2.2.0 run --out experimental-prometheus-rw /scripts/k6-golden-path.js
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend } from 'k6/metrics';

// Custom trend metric covering the entire golden-path flow end-to-end, not just one HTTP call --
// this is the number worth comparing run-over-run in Grafana.
const goldenPathDuration = new Trend('golden_path_duration', true);

const BASE_URL = __ENV.K6_BASE_URL || 'http://reconciliation-platform-stage-api-1:4000';
const SUBMITTER_USERNAME = __ENV.K6_SUBMITTER_USERNAME || 'bray2';
const SUBMITTER_PASSWORD = __ENV.K6_SUBMITTER_PASSWORD || 'P@ssw0rd';
const APPROVER_USERNAME = __ENV.K6_APPROVER_USERNAME || 'rray';
const APPROVER_PASSWORD = __ENV.K6_APPROVER_PASSWORD || 'P@ssw0rd';
const FIXTURES_DIR = __ENV.K6_FIXTURES_DIR || '/fixtures';
const POLL_MAX_ATTEMPTS = Number(__ENV.K6_POLL_MAX_ATTEMPTS || 20);
const POLL_INTERVAL_SECONDS = Number(__ENV.K6_POLL_INTERVAL_SECONDS || 1);

// SharedArray runs its loader once and shares the (immutable) result across every VU -- cheaper
// than each VU re-reading the same three small fixture files off disk on every single iteration.
const fixtures = new SharedArray('bank/gl fixtures', () => [
  {
    field: 'bankFiles',
    filename: '1234_bank.csv',
    data: open(`${FIXTURES_DIR}/bank_1234_20260228.csv`),
  },
  {
    field: 'bankFiles',
    filename: '5678_bank.csv',
    data: open(`${FIXTURES_DIR}/bank_5678_20260228.csv`),
  },
  { field: 'glFile', filename: 'gl.csv', data: open(`${FIXTURES_DIR}/gl_20260228.csv`) },
]);

export const options = {
  // Deliberately small and short by default -- a regression check, not a stress test. Override
  // K6_VUS/K6_DURATION for a heavier run if you specifically want one.
  vus: Number(__ENV.K6_VUS || 2),
  duration: __ENV.K6_DURATION || '1m',
  thresholds: {
    // Fails the run (non-zero exit) on a real regression signal, not just a slow individual
    // request -- a single golden-path iteration involves several HTTP calls, so this reads as
    // "the whole flow", not a per-request SLA.
    http_req_failed: ['rate<0.01'],
    golden_path_duration: ['p(95)<15000'],
  },
};

const login = (username, password) => {
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );
  check(response, { 'login succeeded': (r) => r.status === 200 });
  if (response.status !== 200) {
    fail(`login failed for ${username}: ${response.status} ${response.body}`);
  }
  return response.json('token');
};

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

// k6's object-body multipart encoder (http.post(url, { field: http.file(...) })) does not iterate
// an array value into repeated same-name parts -- given { bankFiles: [file1, file2] } it just
// stringifies the array (literally sends "[0x... 0x...]" as the field's text value), confirmed via
// --http-debug=full while building this script. The API's multer config
// (bankFiles maxCount: MAX_BANK_ACCOUNTS) needs genuinely repeated `bankFiles` parts, which isn't
// expressible as a single JS object key -- so this builds the multipart/form-data body by hand.
const MULTIPART_BOUNDARY = '----k6GoldenPathBoundary';

const buildMultipartBody = (textFields, fileFields) => {
  const parts = [];
  for (const [name, value] of Object.entries(textFields)) {
    parts.push(
      `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`,
    );
  }
  for (const { name, filename, contentType, data } of fileFields) {
    parts.push(
      `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n${data}`,
    );
  }
  return parts.join('\r\n') + `\r\n--${MULTIPART_BOUNDARY}--\r\n`;
};

export default function goldenPath() {
  const startedAt = Date.now();

  const submitterToken = login(SUBMITTER_USERNAME, SUBMITTER_PASSWORD);

  const createBody = buildMultipartBody(
    {
      label: `k6 load test ${Date.now()}-${__VU}-${__ITER}`,
      frequency: 'MONTHLY',
      periodYear: '2026',
      periodMonth: '2',
    },
    fixtures.map((f) => ({
      name: f.field,
      filename: f.filename,
      contentType: 'text/csv',
      data: f.data,
    })),
  );
  const createResponse = http.post(`${BASE_URL}/api/imports/runs`, createBody, {
    headers: {
      ...authHeaders(submitterToken),
      'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
    },
    tags: { name: 'create_run' },
  });
  check(createResponse, { 'run created': (r) => r.status === 201 });
  if (createResponse.status !== 201) {
    fail(`create run failed: ${createResponse.status} ${createResponse.body}`);
  }
  const runId = createResponse.json('id');

  const submitResponse = http.post(`${BASE_URL}/api/imports/runs/${runId}/submit`, null, {
    headers: authHeaders(submitterToken),
    tags: { name: 'submit_run' },
  });
  check(submitResponse, { 'run submitted': (r) => r.status === 200 });

  let finalStatus = null;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    sleep(POLL_INTERVAL_SECONDS);
    const statusResponse = http.get(`${BASE_URL}/api/imports/runs/${runId}`, {
      headers: authHeaders(submitterToken),
      tags: { name: 'poll_run_status' },
    });
    if (statusResponse.status !== 200) {
      continue;
    }
    const status = statusResponse.json('status');
    if (status === 'PENDING_APPROVAL' || status === 'VALIDATION_FAILED') {
      finalStatus = status;
      break;
    }
  }

  check(
    { finalStatus },
    { 'validation reached a terminal state': (r) => r.finalStatus !== null },
  );

  if (finalStatus === 'PENDING_APPROVAL') {
    const approverToken = login(APPROVER_USERNAME, APPROVER_PASSWORD);
    const decisionResponse = http.post(
      `${BASE_URL}/api/approvals/reconciliationRun/${runId}/decision`,
      JSON.stringify({ status: 'APPROVED', rationale: 'k6 golden-path load test' }),
      {
        headers: { ...authHeaders(approverToken), 'Content-Type': 'application/json' },
        tags: { name: 'approve_run' },
      },
    );
    check(decisionResponse, { 'run approved': (r) => r.status === 200 });
  }

  goldenPathDuration.add(Date.now() - startedAt);
}
