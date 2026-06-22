const { Pool } = require('pg');

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function qualified(schema, table) {
  return quoteIdent(schema || 'public') + '.' + quoteIdent(table);
}

class PostgresDriver {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  connString() {
    if (this.config.uri) return this.config.uri;
    const c = this.config;
    const auth = c.user ? `${encodeURIComponent(c.user)}:${encodeURIComponent(c.password || '')}@` : '';
    const host = `${c.host || 'localhost'}:${c.port || 5432}`;
    const db = c.database || c.user || 'postgres';
    let s = `postgresql://${auth}${host}/${db}`;
    if (c.ssl) s += '?sslmode=require';
    return s;
  }

  async connect() {
    this.pool = new Pool({ connectionString: this.connString(), connectionTimeoutMillis: 10000 });
    // validate
    const r = await this.pool.query('SELECT 1');
    if (!r.rowCount) throw new Error('Postgres connection check failed');
  }

  async testConnection() {
    const pool = new Pool({ connectionString: this.connString(), connectionTimeoutMillis: 8000 });
    try { await pool.query('SELECT 1'); } finally { await pool.end(); }
  }

  async schemas() {
    const r = await this.pool.query(
      "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' ORDER BY schema_name"
    );
    return r.rows.map((x) => ({ name: x.name }));
  }

  async tables(schema) {
    const sch = schema || 'public';
    const r = await this.pool.query(
      'SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [sch]
    );
    return r.rows.map((x) => ({ name: x.name, type: x.type === 'VIEW' ? 'view' : 'table' }));
  }

  async columns(schema, table) {
    const sch = schema || 'public';
    const r = await this.pool.query(
      `SELECT column_name AS name, data_type AS type, is_nullable, column_default,
        (SELECT COUNT(*) FROM information_schema.key_column_usage k
          JOIN information_schema.table_constraints tc ON k.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND k.table_schema = $1
            AND k.table_name = $2 AND k.column_name = c.column_name) AS pk
       FROM information_schema.columns c
       WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
      [sch, table]
    );
    return r.rows.map((x) => ({
      name: x.name,
      type: x.type,
      notNull: x.is_nullable === 'NO',
      pk: Number(x.pk) > 0,
      defaultValue: x.column_default == null ? null : String(x.column_default),
    }));
  }

  async indexes(schema, table) {
    const sch = schema || 'public';
    const r = await this.pool.query(
      `SELECT i.relname AS name, am.amname AS method,
        pg_get_indexdef(i.oid) AS definition,
        (SELECT indisunique FROM pg_index WHERE indexrelid = i.oid) AS unique
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_am am ON am.oid = i.relam
       WHERE n.nspname = $1 AND t.relname = $2 ORDER BY i.relname`,
      [sch, table]
    );
    return r.rows.map((x) => {
      const m = /CREATE .* INDEX .* ON .* USING \w+ \((.*)\)/.exec(x.definition || '');
      const cols = m ? m[1].split(',').map((s) => s.trim().replace(/"/g, '')) : [];
      return { name: x.name, columns: cols, unique: !!x.unique };
    });
  }

  async query(sql, params = []) {
    const start = Date.now();
    const r = await this.pool.query(sql, Array.isArray(params) ? params : []);
    const columns = (r.fields || []).map((f) => f.name);
    return {
      columns,
      rows: r.rows || [],
      rowCount: (r.rows || []).length,
      affected: typeof r.rowCount === 'number' && r.command !== 'SELECT' ? r.rowCount : 0,
      timeMs: Date.now() - start,
    };
  }

  async tableData(schema, table, opts = {}) {
    const limit = Math.max(1, Math.min(opts.limit != null ? opts.limit : 1000, 1000));
    const offset = Math.max(0, opts.offset || 0);
    const where = opts.where ? ' WHERE ' + opts.where : '';
    const orderBy = opts.orderBy ? ' ORDER BY ' + opts.orderBy : '';
    const tq = qualified(schema, table);
    const r = await this.pool.query(`SELECT * FROM ${tq}${where}${orderBy} LIMIT $1 OFFSET $2`, [limit, offset]);
    const c = await this.pool.query(`SELECT COUNT(*) AS c FROM ${tq}${where}`);
    const columns = (r.fields || []).map((f) => f.name);
    return { columns, rows: r.rows || [], total: Number((c.rows[0] || {}).c) || 0, limit, offset };
  }

  async close() {
    if (this.pool) { try { await this.pool.end(); } catch (_) {} this.pool = null; }
  }
}

module.exports = PostgresDriver;
