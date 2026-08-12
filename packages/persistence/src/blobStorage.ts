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
 * `put` is scoped to exactly one `import_file` row (its `import_file_id`) and is idempotent for
 * that row -- it is not a content-addressed store. Recognizing that two *different* import_file
 * rows happen to share identical bytes (re-upload dedupe) is an ingestion-layer decision made
 * from `import_file.content_sha256`, not something this seam does implicitly -- doing it here
 * would mean two different import_file rows could point at the same content row, which conflicts
 * with `import_file_content.import_file_id` being both primary key and foreign key (exactly one
 * content row per import_file, structurally enforced, matching
 * `reconciliation_source_file_content`'s own design).
 */
export interface BlobStorage {
  put(input: PutBlobInput): Promise<PutBlobResult>;
  /** Returns the stored bytes for a given import_file, scoped to its organization. */
  get(importFileId: string, organizationId: string): Promise<Buffer>;
}

/**
 * BYTEA-backed `BlobStorage`. Appropriate at the volumes this feature expects (files capped at
 * 50MB) -- keeps bytes in the same transaction and backup as the metadata describing them,
 * matching the reasoning `reconciliation_source_file_content`'s own changeset (0019) already
 * established for the older import path.
 */
export class PostgresBlobStorage implements BlobStorage {
  constructor(private readonly pool: Pool) {}

  async put(input: PutBlobInput): Promise<PutBlobResult> {
    const sha256 = computeSha256Hex(input.bytes);
    const byteSize = input.bytes.byteLength;

    await runInTenantScope(this.pool, input.organizationId, async (client: PoolClient) => {
      await client.query(
        `INSERT INTO import_file_content (import_file_id, organization_id, content, byte_size)
         VALUES ($1, $2, $3::bytea, $4)
         ON CONFLICT (import_file_id) DO UPDATE
            SET content = EXCLUDED.content,
                byte_size = EXCLUDED.byte_size`,
        [input.importFileId, input.organizationId, input.bytes, byteSize],
      );
    });

    return { sha256, byteSize };
  }

  async get(importFileId: string, organizationId: string): Promise<Buffer> {
    return runInTenantScope(this.pool, organizationId, async (client: PoolClient) => {
      const result = await client.query<{ content: Buffer }>(
        'SELECT content FROM import_file_content WHERE import_file_id = $1',
        [importFileId],
      );
      const row = result.rows[0];

      if (!row) {
        throw new Error(`import_file_content not found: ${importFileId}`);
      }

      return row.content;
    });
  }
}
