const mysql = require('mysql2/promise');

function quoteIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

function qualified(schema, table) {
  const s = schema ? quoteIdent(schema) + '.' : '';
  return s + quoteIdent(table);
}

const SYS_SCHEMAS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

class MysqlDriver {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  poolOpts() {
    if (this.config.uri) {
      return { uri: this.config.uri, connectionLimit: 4, connectTimeout: 10000 };
    }
    const c = this.config;
    return {
      host: c.host || 'localhost',
      port: c.port || 3306,
      user: c.user || 'root',
      password: c.password || '',
      database: c.database || undefined,
      ssl: c.ssl ? {} : undefined,
      connectionLimit: 4,
      connectTimeout: 10000,
    };
  }

  async connect() {
    this.pool = mysql.createPool(this.poolOpts());
    const conn = await this.pool.getConnection();
    try { await conn.query('SELECT 1'); } finally { conn.release(); }
  }

  async testConnection() {
    const pool = mysql.createPool(this.poolOpts());
    try {
      const conn = await pool.getConnection();
      try { await conn.query('SELECT 1'); } finally { conn.release(); }
    } finally { await pool.end(); }
  }

  async schemas() {
    const [rows] = await this.pool.query(
      'SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name'
    );
    return rows.filter((r) => !SYS_SCHEMAS.has(r.name)).map((r) => ({ name: r.name }));
  }

  async tables(schema) {
    const [rows] = await this.pool.query(
      'SELECT table_name AS name, table_type AS type FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name',
      [schema || '']
    );
    return rows.map((r) => ({ name: r.name, type: r.type === 'VIEW' ? 'view' : 'table' }));
  }

  async columns(schema, table) {
    const [rows] = await this.pool.query(
      `SELECT column_name AS name, data_type AS type, is_nullable, column_default, column_key, extra
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [schema || '', table]
    );
    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      notNull: r.is_nullable === 'NO',
      pk: r.column_key === 'PRI',
      defaultValue: r.column_default == null ? null : String(r.column_default),
    }));
  }

  async indexes(schema, table) {
    const [rows] = await this.pool.query(
      `SELECT index_name AS name, column_name AS col, non_unique
       FROM information_schema.statistics
       WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index`,
      [schema || '', table]
    );
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.name)) map.set(r.name, { name: r.name, columns: [], unique: !r.non_unique });
      map.get(r.name).columns.push(r.col);
    }
    return [...map.values()];
  }

  async query(sql, params = []) {
    const start = Date.now();
    const [rows, fields] = await this.pool.query(sql, Array.isArray(params) ? params : []);
    const isSelect = Array.isArray(rows);
    const arr = isSelect ? rows : [];
    const columns = (fields || []).map((f) => f.name);
    return {
      columns,
      rows: arr,
      rowCount: arr.length,
      affected: !isSelect && rows ? rows.affectedRows || 0 : 0,
      timeMs: Date.now() - start,
    };
  }

  async tableData(schema, table, opts = {}) {
    const limit = Math.max(1, Math.min(opts.limit != null ? opts.limit : 1000, 1000));
    const offset = Math.max(0, opts.offset || 0);
    const where = opts.where ? ' WHERE ' + opts.where : '';
    const orderBy = opts.orderBy ? ' ORDER BY ' + opts.orderBy : '';
    const tq = qualified(schema, table);
    const [rows, fields] = await this.pool.query(`SELECT * FROM ${tq}${where}${orderBy} LIMIT ? OFFSET ?`, [limit, offset]);
    const [[c]] = await this.pool.query(`SELECT COUNT(*) AS c FROM ${tq}${where}`);
    const columns = (fields || []).map((f) => f.name);
    return { columns, rows, total: Number((c || {}).c) || 0, limit, offset };
  }

  async close() {
    if (this.pool) { try { await this.pool.end(); } catch (_) {} this.pool = null; }
  }
}

module.exports = MysqlDriver;
