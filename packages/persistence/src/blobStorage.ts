import type { Pool, PoolClient } from 'pg';

import { computeSha256Hex } from './reconciliationLifecycleStore';
import { runInTenantScope } from './postgres';

/** Input to `BlobStorage.put` -- the raw bytes for one `import_file` row. */
export interface PutBlobInput {
  importFileId: string;
  organizationId: string;
  bytes: Buffer;
}

/** Digest and size computed from the bytes actually stored, for the caller to persist/compare. */
export interface PutBlobResult {
  sha256: string;
  byteSize: number;
}

/**
 * Storage seam for `import_file`'s raw bytes (implementation-spec.md §7). One interface, two
 * planned implementations: `PostgresBlobStorage` (BYTEA, v1, this file) and a deferred
 * `S3BlobStorage` (later) -- the ingestion API and validation worker depend only on this
 * interface, so swapping the storage backend later needs no call-site changes.
 *
 * `put` is scoped to exactly one `import_file` row (its `import_file_id`) and is write-once for
 * that row -- the stored bytes are immutable once written (store it exactly as it was received),
 * so a second `put` for the same `import_file_id` fails on the primary key rather than silently
 * overwriting. It is not a content-addressed store: recognizing that two *different* import_file
 * rows happen to share identical bytes (re-upload dedupe) is an ingestion-layer decision made
 * from `import_file.content_sha256`, not something this seam does implicitly -- doing it here
 * would mean two different import_file rows could point at the same content row, which conflicts
 * with `import_file_content.import_file_id` being both primary key and foreign key (exactly one
 * content row per import_file, structurally enforced, matching
 * `reconciliation_source_file_content`'s own design).
 *
 * Both methods accept an optional already-open `client`. Without one, they open their own
 * transaction via `runInTenantScope` -- correct for a standalone call. With one, they run
 * directly on it instead, so a caller building a larger transaction (e.g. Phase 5's ingestion
 * API: create `import_file` -> store its blob -> create `reconciliation_run` -> link via
 * `run_source_file`, all-or-nothing) can include the blob write without triggering a second,
 * independent transaction that can't yet see the first one's uncommitted `import_file` row --
 * `import_file_content.import_file_id`'s FK would otherwise have nothing committed to reference.
 * The caller is responsible for having already set the tenant-scope GUC on a passed-in client
 * (i.e. it came from another store's own `runInTenantScope` callback).
 */
export interface BlobStorage {
  put(input: PutBlobInput, client?: PoolClient): Promise<PutBlobResult>;
  /** Returns the stored bytes for a given import_file, scoped to its organization. */
  get(importFileId: string, organizationId: string, client?: PoolClient): Promise<Buffer>;
}

/**
 * BYTEA-backed `BlobStorage`. Appropriate at the volumes this feature expects (files capped at
 * 50MB) -- keeps bytes in the same transaction and backup as the metadata describing them,
 * matching the reasoning `reconciliation_source_file_content`'s own changeset (0019) already
 * established for the older import path.
 */
export class PostgresBlobStorage implements BlobStorage {
  /** @param pool Used when a call site doesn't already hold a transaction's `client`. */
  constructor(private readonly pool: Pool) {}

  /** Stores `input.bytes` in `import_file_content`, keyed by `input.importFileId`. Fails on a
   * duplicate id rather than overwriting -- see the insert's own comment for why. */
  async put(input: PutBlobInput, client?: PoolClient): Promise<PutBlobResult> {
    const sha256 = computeSha256Hex(input.bytes);
    const byteSize = input.bytes.byteLength;

    // No ON CONFLICT clause: the stored bytes are meant to be immutable once written -- "store it
    // as it was received," verbatim, forever. A second put() for the same import_file_id is a
    // bug (every real call site generates a fresh import_file_id per file; dedupe reuses an
    // existing row's id specifically to skip calling put() again), so it should fail loudly via
    // the primary key's unique-violation error, not silently overwrite what's already stored.
    const insert = async (activeClient: PoolClient): Promise<void> => {
      await activeClient.query(
        `INSERT INTO import_file_content (import_file_id, organization_id, content, byte_size)
         VALUES ($1, $2, $3::bytea, $4)`,
        [input.importFileId, input.organizationId, input.bytes, byteSize],
      );
    };

    if (client) {
      await insert(client);
    } else {
      await runInTenantScope(this.pool, input.organizationId, insert);
    }

    return { sha256, byteSize };
  }

  async get(importFileId: string, organizationId: string, client?: PoolClient): Promise<Buffer> {
    const select = async (activeClient: PoolClient): Promise<Buffer> => {
      const result = await activeClient.query<{ content: Buffer }>(
        'SELECT content FROM import_file_content WHERE import_file_id = $1',
        [importFileId],
      );
      const row = result.rows[0];

      if (!row) {
        throw new Error(`import_file_content not found: ${importFileId}`);
      }

      return row.content;
    };

    return client ? select(client) : runInTenantScope(this.pool, organizationId, select);
  }
}
