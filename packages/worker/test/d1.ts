/**
 * A D1 database for the tests: Node's own SQLite behind the few D1 calls the
 * Worker makes, with the real migration applied.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type Value = string | number | null;

export class TestD1 {
  readonly db = new DatabaseSync(':memory:');
  /** Every statement run, with its values: the tests check nothing else is written. */
  readonly log: { sql: string; values: Value[] }[] = [];

  migrate(): this {
    const sql = readFileSync(new URL('../migrations/0001_feedback.sql', import.meta.url), 'utf8');
    this.db.exec(sql);
    return this;
  }

  prepare(sql: string): D1PreparedStatement {
    const statement = (values: Value[]): D1PreparedStatement => ({
      bind: (...more: unknown[]) => statement([...values, ...(more as Value[])]),
      run: async () => {
        this.log.push({ sql, values });
        const r = this.db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
      all: async <T>() => ({ results: this.db.prepare(sql).all(...values) as T[] }),
      first: async <T>() => (this.db.prepare(sql).get(...values) as T | undefined) ?? null,
    });
    return statement([]);
  }

  rows(): Record<string, unknown>[] {
    return this.db.prepare('SELECT * FROM feedback ORDER BY created_at').all() as Record<
      string,
      unknown
    >[];
  }
}
