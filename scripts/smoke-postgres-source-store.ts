import 'dotenv/config';
import assert from 'node:assert/strict';
import {
  buildPostgresSourceStoreSchemaSql,
  buildSourceStoreFromPostgresRows,
  sourceStoreStatus,
} from '../src/lib/ingestion-store';

const connectionString = process.env.POSTGRES_SMOKE_DATABASE_URL?.trim();

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function main() {
  if (!connectionString) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: 'POSTGRES_SMOKE_DATABASE_URL is not set; skipping write smoke against Postgres.',
    }, null, 2));
    return;
  }

  const { Pool } = await import('pg');
  const schemaName = `lingbi_smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    await client.query(`SET LOCAL search_path TO ${quoteIdentifier(schemaName)}`);

    for (const statement of buildPostgresSourceStoreSchemaSql()) {
      await client.query(statement);
    }

    const chunkFtsIndex = await client.query(
      `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = $1
          AND indexname = 'lingbi_source_chunks_fts_idx'
      `,
      [schemaName],
    );
    assert.equal(chunkFtsIndex.rowCount, 1);
    assert.match(String(chunkFtsIndex.rows[0].indexdef), /to_tsvector\('simple'::regconfig/);

    const status = (() => {
      const previousAdapter = process.env.SOURCE_STORE_ADAPTER;
      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.SOURCE_STORE_ADAPTER = 'postgres';
      process.env.DATABASE_URL = connectionString;
      try {
        return sourceStoreStatus();
      } finally {
        if (previousAdapter === undefined) {
          delete process.env.SOURCE_STORE_ADAPTER;
        } else {
          process.env.SOURCE_STORE_ADAPTER = previousAdapter;
        }
        if (previousDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = previousDatabaseUrl;
        }
      }
    })();

    assert.equal(status.provider, 'postgres');
    assert.equal(status.configured, true);
    assert.equal(status.normalizedSchema, true);
    assert.deepEqual(status.tables, [
      'lingbi_source_store',
      'lingbi_sources',
      'lingbi_source_chunks',
      'lingbi_ingestion_stages',
    ]);

    const sourceId = 'smoke-source';
    const chunkId = `${sourceId}::chunk-1`;
    const timestamp = new Date().toISOString();

    await client.query(
      `
        INSERT INTO lingbi_sources (
          id, file_name, file_type, file_size, title, short_name, storage_key, file_url,
          status, error, chunk_count, token_estimate,
          vector_status, vector_model, vector_dimension, vector_count, vector_path, vector_error,
          mineru_status, mineru_figure_count, mineru_error,
          created_at, updated_at, payload
        )
        VALUES (
          $1, 'smoke.txt', 'txt', 128, 'Postgres Smoke Source', 'Smoke. 2026', null, null,
          'succeeded', null, 1, 24,
          'not_configured', null, null, null, null, null,
          'not_configured', null, null,
          $2::timestamptz, $2::timestamptz, $3::jsonb
        )
      `,
      [sourceId, timestamp, JSON.stringify({ id: sourceId })],
    );

    await client.query(
      `
        INSERT INTO lingbi_source_chunks (
          id, source_id, source_index, chunk_index, page, paper_short_name,
          source_title, text, token_estimate, payload
        )
        VALUES ($1, $2, 0, 0, 1, 'Smoke. 2026', 'Postgres Smoke Source', '引用片段 smoke', 12, $3::jsonb)
      `,
      [chunkId, sourceId, JSON.stringify({ id: chunkId })],
    );

    await client.query(
      `
        INSERT INTO lingbi_ingestion_stages (
          source_id, name, status, started_at, completed_at, error, payload
        )
        VALUES ($1, 'chunk', 'succeeded', $2::timestamptz, $2::timestamptz, null, $3::jsonb)
      `,
      [sourceId, timestamp, JSON.stringify({ name: 'chunk', status: 'succeeded' })],
    );

    const counts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM lingbi_sources) AS sources,
        (SELECT count(*)::int FROM lingbi_source_chunks) AS chunks,
        (SELECT count(*)::int FROM lingbi_ingestion_stages) AS stages
    `);

    assert.deepEqual(counts.rows[0], { sources: 1, chunks: 1, stages: 1 });

    const ftsQuery = await client.query(
      `
        SELECT
          id,
          ts_rank(
            to_tsvector('simple', coalesce(source_title, '') || ' ' || coalesce(paper_short_name, '') || ' ' || coalesce(text, '')),
            plainto_tsquery('simple', $1)
          ) AS search_rank
        FROM lingbi_source_chunks
        WHERE to_tsvector('simple', coalesce(source_title, '') || ' ' || coalesce(paper_short_name, '') || ' ' || coalesce(text, ''))
          @@ plainto_tsquery('simple', $1)
        ORDER BY search_rank DESC, source_id ASC, chunk_index ASC
      `,
      ['smoke'],
    );
    assert.equal(ftsQuery.rowCount, 1);
    assert.equal(ftsQuery.rows[0].id, chunkId);

    const sources = await client.query('SELECT * FROM lingbi_sources ORDER BY created_at ASC');
    const chunks = await client.query('SELECT * FROM lingbi_source_chunks ORDER BY source_id ASC, chunk_index ASC');
    const stages = await client.query('SELECT * FROM lingbi_ingestion_stages ORDER BY source_id ASC, name ASC');
    const rebuiltStore = buildSourceStoreFromPostgresRows({
      sources: sources.rows,
      chunks: chunks.rows,
      stages: stages.rows,
      updatedAt: timestamp,
    });
    assert.equal(rebuiltStore.sources[0].id, sourceId);
    assert.equal(rebuiltStore.sources[0].chunks[0].id, chunkId);
    assert.equal(rebuiltStore.sources[0].stages[0].name, 'chunk');

    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      ok: true,
      skipped: false,
      checked: [
        'Postgres connection with dedicated smoke database URL',
        'transaction-scoped schema creation',
        'source store normalized DDL',
        'source chunk full-text GIN index DDL',
        'source/chunk/stage insert contract',
        'source chunk full-text query contract',
        'normalized table read-model reconstruction',
        'source store health status contract',
        'rollback leaves no smoke schema behind',
      ],
      schemaName,
      counts: counts.rows[0],
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
