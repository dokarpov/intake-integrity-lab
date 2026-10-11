function safeIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value || '')) throw new Error('unsafe_postgres_identifier');
  return value;
}

/**
 * Concurrency-safe PostgreSQL append store.
 * Requires infra/postgres/001_ledger.sql and an application role with SELECT/INSERT only.
 */
export class PostgresLedgerStore {
  constructor({ pool, table = 'compliance_ledger_events' } = {}) {
    if (!pool) throw new Error('postgres_pool_required');
    this.pool = pool;
    this.table = safeIdentifier(table);
  }

  static async fromDefault({ connectionString, table, max = 10, statementTimeoutMs = 10_000 } = {}) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString, max, statement_timeout: statementTimeoutMs });
    return new PostgresLedgerStore({ pool, table });
  }

  async atomicAppend(ledgerId, builder) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL lock_timeout = \'5s\'');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [ledgerId]);
      const q = await client.query(`SELECT event_json FROM ${this.table} WHERE ledger_id=$1 ORDER BY sequence DESC LIMIT 1`, [ledgerId]);
      const previous = q.rows[0]?.event_json || null;
      const sequence = previous ? Number(previous.sequence) + 1 : 1;
      const event = await builder({ previous, sequence });
      await client.query(
        `INSERT INTO ${this.table}(ledger_id,tenant_id,sequence,event_id,event_hash,intake_id,subject_ref,event_action,event_result,event_json)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [ledgerId, event.tenantId, sequence, event.eventId, event.eventHash, event.intakeId || null,
          typeof event.subjectRef === 'string' ? event.subjectRef : event.subjectRef?.ref || null,
          event.action, event.result, JSON.stringify(event)]
      );
      await client.query('COMMIT');
      return event;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async all(ledgerId, { afterSequence = 0, limit = 10_000 } = {}) {
    const q = await this.pool.query(
      `SELECT event_json FROM ${this.table} WHERE ledger_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`,
      [ledgerId, afterSequence, limit]
    );
    return q.rows.map(r => r.event_json);
  }

  async query(ledgerId, { intakeId, subjectRef, action, result, afterSequence = 0, limit = 100 } = {}) {
    const params = [ledgerId, afterSequence];
    const where = ['ledger_id=$1', 'sequence>$2'];
    const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };
    if (intakeId) add('intake_id=?', intakeId);
    const ref = typeof subjectRef === 'string' ? subjectRef : subjectRef?.ref;
    if (ref) add('subject_ref=?', ref);
    if (action) add('event_action=?', action);
    if (result) add('event_result=?', result);
    params.push(Math.min(Math.max(Number(limit) || 100, 1), 1000));
    const q = await this.pool.query(
      `SELECT event_json FROM ${this.table} WHERE ${where.join(' AND ')} ORDER BY sequence LIMIT $${params.length}`,
      params
    );
    return q.rows.map(r => r.event_json);
  }
}
