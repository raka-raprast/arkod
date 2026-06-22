const Database = require('better-sqlite3');

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

class SqliteDriver {
  constructor(config) {
    this.config = config;
    this.db = null;
  }

  async connect() {
    const filePath = this.config.filePath;
    if (!filePath) throw new Error('filePath is required for a SQLite connection');
    this.db = new Database(filePath, { fileMustExist: true });
  }

  async testConnection() {
    const filePath = this.config.filePath;
    if (!filePath) throw new Error('filePath is required for a SQLite connection');
    const tmp = new Database(filePath, { readonly: true, fileMustExist: true });
    try { tmp.prepare('SELECT 1').get(); } finally { tmp.close(); }
  }

  async schemas() {
    return [{ name: 'main' }];
  }

  async tables() {
    const rows = this.db.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    return rows.map((r) => ({ name: r.name, type: r.type }));
  }

  async columns(_schema, table) {
    const info = this.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all();
    return info.map((c) => ({
      name: c.name,
      type: c.type || '',
      notNull: c.notnull === 1,
      pk: c.pk > 0,
      defaultValue: c.dflt_value == null ? null : String(c.dflt_value),
    }));
  }

  async indexes(_schema, table) {
    const list = this.db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all();
    return list.map((i) => {
      const cols = this.db.prepare(`PRAGMA index_info(${quoteIdent(i.name)})`).all().map((c) => c.name);
      return { name: i.name, columns: cols, unique: i.unique === 1 };
    });
  }

  async query(sql, params = []) {
    const start = Date.now();
    const stmt = this.db.prepare(sql);
    const args = Array.isArray(params) ? params : [];
    if (stmt.reader) {
      const rows = stmt.all(...args);
      const columns = stmt.columns().map((c) => c.name);
      return { columns, rows, rowCount: rows.length, affected: 0, timeMs: Date.now() - start };
    }
    const info = stmt.run(...args);
    return { columns: [], rows: [], rowCount: 0, affected: info.changes, timeMs: Date.now() - start };
  }

  async tableData(_schema, table, opts = {}) {
    const limit = Math.max(1, Math.min(opts.limit != null ? opts.limit : 1000, 1000));
    const offset = Math.max(0, opts.offset || 0);
    const where = opts.where ? ' WHERE ' + opts.where : '';
    const orderBy = opts.orderBy ? ' ORDER BY ' + opts.orderBy : '';
    const rows = this.db.prepare(
      `SELECT * FROM ${quoteIdent(table)}${where}${orderBy} LIMIT ? OFFSET ?`
    ).all(limit, offset);
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const total = this.db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}${where}`).get().c;
    return { columns, rows, total, limit, offset };
  }

  async close() {
    if (this.db) { try { this.db.close(); } catch (_) {} this.db = null; }
  }
}

module.exports = SqliteDriver;
