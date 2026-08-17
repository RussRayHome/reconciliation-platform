# infra — Production AWS environment

CDK app for `rb-kinneysoft.com`'s production environment. Kept torn down to near-zero cost until
Go Live, and designed to stay that way afterward between any necessary rebuilds — see "Cost" below.

## Architecture

**Three regions, one live at a time (disaster recovery, not active-active):**

| Region                 | Role                                                          |
| ----------------------- | -------------------------------------------------------------- |
| Ohio (`us-east-2`)      | **Primary** — serves all production traffic.                  |
| N. Virginia (`us-east-1`) | Cold standby — defined in code, not deployed day-to-day.    |
| Oregon (`us-west-2`)    | Cold standby — defined in code, not deployed day-to-day.      |

"Cold" means exactly that: a standby region has no running resources and costs nothing until an
actual failover. `bin/infra.ts` defines all three regions' stacks in one CDK app — defining a
stack costs nothing, only `cdk deploy <stack-id>` does — so day-to-day only the primary region's
stacks (plus `ReconDnsStack`) are ever deployed.

**Per region, two stacks** (`lib/persistent-stack.ts`, `lib/ephemeral-stack.ts`), suffixed by
region code (e.g. `ReconPersistentStack-us-east-2`):

- **PersistentStack** — durable, cheap-or-free-at-rest resources: ECR repositories, the S3
  uploads bucket, IAM roles, and two Secrets Manager secrets (`recon_app` master credentials,
  `app_user` runtime credentials). Never destroyed.
- **EphemeralStack** — the hourly-billed resources: VPC/NAT gateway, RDS, ECS Fargate, ALB. Safe
  to destroy and rebuild; `EphemeralStack` reads `PersistentStack`'s resources directly rather
  than recreating them, so a rebuild reconnects to the same ECR images, bucket, and credentials.

**One region-agnostic stack, `ReconDnsStack`** — a Route53 hosted zone for `rb-kinneysoft.com`,
plus an apex A/ALIAS record pointing at whichever region is currently live. This is the one thing
that must survive every failover: the domain's registrar NS delegation never changes, only the
record `ReconDnsStack` resolves to. Because Route53 alias records to an ALB in a *different*
region than this stack can't use a live CDK cross-region token, the target is passed as plain
strings via CDK context (`activeRegionAlbDnsName`, `activeRegion`) — see `lib/dns-stack.ts`.

**Why `PersistentStack`/`EphemeralStack` are split this way**: cost. NAT gateway, RDS, Fargate,
and the ALB bill hourly; ECR storage, S3, IAM, and Secrets Manager don't (or are flat-rate-cheap).
Destroying `EphemeralStack` between uses gets you to near-zero cost without losing anything
durable.

## The `app_user` credential — why the API doesn't connect as `recon_app`

Postgres row-level security (`docs/adr/0001-multi-tenant-isolation-model.md`) is what keeps one
organization's data away from another's, and it's enforced against the `app_user` role, not the
superuser `recon_app` migration/owner role (`recon_app` bypasses RLS entirely). Docker/local
already gets this right (`compose.yaml`'s `API_DATABASE_URL` fails loudly if not pointed at
`app_user`) — `PersistentStack`'s `appUserSecret` and `EphemeralStack`'s container `secrets` block
port that same pattern into AWS, so production doesn't regress behind Docker.

`app_user`'s password is a hardcoded dev-only placeholder in Liquibase changeset `0031`
(`P@ssw0rd`) until told otherwise — Postgres doesn't automatically learn `appUserSecret`'s
generated value. **One-time step per fresh database** (first deploy, or a standby restored from a
snapshot that predates this being rotated):

```sql
ALTER ROLE app_user WITH PASSWORD '<value from the app_user-credentials secret>';
```

## S3 file storage

`PersistentStack`'s `uploadsBucket` is provisioned and IAM-wired (`grantReadWrite` to the task
role) with a storage-class waterfall (Standard → Standard-IA at 30 days → Glacier Instant
Retrieval at 90 days → Glacier Deep Archive at 365 days) — these are durable originals, moved to
cheaper tiers over time, never deleted. `EphemeralStack` declares `UPLOADS_BUCKET_NAME` and
`RECON_BLOB_STORAGE_BACKEND=s3` on the API container.

**Not yet consumed by application code.** `apps/api`/`packages/persistence` don't read those env
vars yet — that's a separate change (`packages/persistence/src/blobStorage.ts` gains an
`S3BlobStorage` implementation of the existing `BlobStorage` interface), intentionally out of
scope for this infra build. The bucket exists, correctly configured, ready for that code to catch
up to — infra-ahead-of-app, not an oversight.

## Queueing: SQS in production, BullMQ in Dev/Stage

`apps/api/src/services/reconciliationQueue.ts` / `importValidationQueue.ts` are real, already-built
BullMQ queues, gated by `RECONCILIATION_QUEUE_REDIS_URL`/`IMPORT_VALIDATION_QUEUE_REDIS_URL` — that
stays the Dev/Stage path (Redis, already running in Docker Compose for rate-limiting, would need
those two vars pointed at it to actually enable the queues there). **Production uses SQS instead**,
not an ElastiCache Redis running the same BullMQ code — `QUEUE_BACKEND` will pick between them once
the app-side SQS implementation exists (not yet built, see below).

`PersistentStack` provisions two SQS queues (`reconciliationQueue`, `importValidationQueue`), each
with its own dead-letter queue (3 failed receives before a message moves to the DLQ instead of
retrying forever; 15-minute visibility timeout so a long-running job isn't redelivered to a second
worker while the first is still processing it).

**Why a separate worker service, not just a separate queue.** Today, in both Dev/Stage and this
infra build, the BullMQ/queue worker runs in the *same Node.js process* as the HTTP server
(`apps/api`'s single entrypoint, one Docker `CMD`) — Node is single-threaded for JS execution, so a
heavy reconciliation job can still stall the event loop and slow down concurrent HTTP requests on
that same task, even with the queue "enabled." `EphemeralStack`'s `WorkerService` is a genuinely
separate ECS Fargate service — same image, but no `portMappings` and no ALB target group
attachment, since it never receives inbound traffic, only pulls from SQS. This is what actually
prevents "many users uploading at once slows everything down": heavy processing runs on dedicated
worker tasks, isolated from the tasks answering HTTP requests.

**IAM is split, not shared**, matching the persistent/ephemeral least-privilege pattern already
used for `app_user` vs `recon_app`: `taskRole` (API) can `SendMessage` on both queues but never
consumes; `workerTaskRole` can `ReceiveMessage`/`DeleteMessage` on both, plus `SendMessage` on
`reconciliationQueue` only — the import-validation worker chains straight into triggering
reconciliation once a run is approved (`triggerMatchingForImportRun`), without going back through
the API.

**Auto-scaling is on queue backlog, not CPU/memory** — two independent target-tracking policies
(one per queue, `ApproximateNumberOfMessagesVisible`, target 10 messages, min 1/max 5 tasks) on
`WorkerService`'s scalable task count. This is the concrete mechanism behind "concurrent uploads
from users anywhere in the country don't slow down": as either queue backs up, ECS adds worker
capacity to drain it, then scales back in once it clears. Target values are a starting point, easy
to tune once there's real traffic to measure against.

**Not yet consumed by application code.** Same infra-ahead-of-app situation as S3: `PROCESS_MODE`,
`QUEUE_BACKEND=sqs`, and the queue URLs are declared on both the API and worker containers, but
`apps/api` doesn't yet have a worker-mode entrypoint or an SQS-backed implementation of the queue
interface `reconciliationQueue.ts`/`importValidationQueue.ts` would need to expose. The queues,
IAM, and worker service all exist and are correctly configured, ready for that app-code change.

## Runbook

### One-time setup

```bash
bash scripts/bootstrap.sh
```

Bootstraps CDK in all three regions, deploys `ReconDnsStack` (hosted zone, no record yet) and the
primary region's `ReconPersistentStack-us-east-2`. Prints next steps.

### Bringing the primary region up

```bash
npm run infra:push                    # build + push API/web images (replicates to standby ECRs)
npm run infra:up                      # deploy ReconEphemeralStack-us-east-2
```

Then, once (per fresh database): run the `ALTER ROLE app_user ...` step above, and repoint
`ReconDnsStack` at the new ALB:

```bash
npx cdk deploy ReconDnsStack \
  --context activeRegionAlbDnsName=<AlbDnsName output from infra:up> \
  --context activeRegion=us-east-2
```

Then prove it actually works:

```bash
psql "$RECON_APP_DATABASE_URL" -f scripts/seed-smoke-orgs.sql   # once per fresh database
npm run infra:smoke-test -- --base-url https://rb-kinneysoft.com
```

### Tearing down to near-zero cost

```bash
npm run infra:down                    # snapshots RDS, destroys ReconEphemeralStack-us-east-2
```

`PersistentStack` (and the DNS zone) are untouched. Repeat push → up → smoke-test → down as many
times as needed before Go Live.

### Disaster recovery

Keep standby regions restorable:

```bash
bash scripts/dr-snapshot-copy.sh      # copies the primary's latest snapshot to both standbys
```

Run this periodically (e.g. right after `infra:down`, while a fresh snapshot already exists) — not
scheduled/automated, matching the cold-standby posture. Without it, a standby has nothing to
restore from.

On an actual failover:

```bash
bash scripts/dr-failover.sh --region us-east-1   # or us-west-2
```

Deploys that region's `EphemeralStack` from its latest copied snapshot, then repoints
`ReconDnsStack` at it. Then run the smoke test against `https://rb-kinneysoft.com` again before
trusting it — a snapshot-restored database already has `app_user` set correctly if it was
snapshotted after that credential was rotated in; the `ALTER ROLE` step is only needed if not.

Failover is a deliberate, scripted action, not automated health-check failover — automatic
failover implies an always-running standby to check against, which contradicts near-zero-cost
cold standby.

## Cost

**Always on:** `ReconDnsStack` (hosted zone, ~$0.50/mo), primary `PersistentStack` (ECR/S3
storage, Secrets Manager — a few dollars/mo depending on image/upload volume).

**On when deployed, gone when torn down:** NAT gateway, RDS, Fargate, ALB — the bulk of the cost,
and the reason `infra:down` exists.

**Standby regions:** nothing, until an actual failover deploys them.

## Testing

```bash
npm run -w @recon/infra build          # typecheck
npm run -w @recon/infra test           # CDK assertion tests (aws-cdk-lib/assertions)
npx cdk list                           # confirm all 7 stacks synthesize, without deploying anything
```

`test/ephemeral-stack.test.ts` includes a regression guard synthesizing all three regions
together — the circular-dependency class of bug fixed once already (PR #129) only surfaces at
synth time, not at typecheck time.
