const crypto = require('crypto');
const SqliteDriver = require('./sqlite');
const PostgresDriver = require('./postgres');
const MysqlDriver = require('./mysql');
const MongoDriver = require('./mongodb');

const DRIVERS = {
  sqlite: SqliteDriver,
  postgres: PostgresDriver,
  mysql: MysqlDriver,
  mongodb: MongoDriver,
};

const MAX_ROWS = 1000;
const READONLY_RE = /^\s*(SELECT|WITH|EXPLAIN|SHOW|DESCRIBE|PRAGMA)\b/i;

const connections = new Map(); // id -> { driver, config, connected, readOnly }

function isSqlType(type) {
  return type === 'sqlite' || type === 'postgres' || type === 'mysql';
}

function ensureType(type) {
  if (!type) throw new Error('Connection "type" is required');
  if (!DRIVERS[type]) throw new Error('Unsupported database type: ' + type);
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function enforceReadOnly(readOnly, type, sql) {
  if (!isSqlType(type)) return;
  if (readOnly && !READONLY_RE.test(sql)) {
    throw new Error('Read-only mode is ON. Only SELECT/WITH/EXPLAIN/PRAGMA/SHOW/DESCRIBE statements are allowed. Disable "Read-only" in the toolbar to run this statement.');
  }
}

function capRows(result) {
  if (result && Array.isArray(result.rows) && result.rows.length > MAX_ROWS) {
    result.truncated = true;
    result.truncationNote = `Result capped at ${MAX_ROWS} rows (query returned more).`;
    result.rows = result.rows.slice(0, MAX_ROWS);
  }
  return result;
}

const manager = {
  isSqlType,
  genId,
  MAX_ROWS,

  has(id) { return connections.has(id); },

  getConfig(id) {
    const e = connections.get(id);
    return e ? e.config : null;
  },

  defaultReadOnly(config) {
    return config.readOnly !== false;
  },

  setConfig(id, config) {
    const prev = connections.get(id);
    const readOnly = prev ? prev.readOnly : manager.defaultReadOnly(config);
    connections.set(id, { driver: null, config: { ...config, id }, connected: false, readOnly });
    return prev;
  },

  register(config) {
    const id = config.id || genId();
    manager.setConfig(id, config);
    return id;
  },

  remove(id) {
    return connections.delete(id);
  },

  isConnected(id) {
    const e = connections.get(id);
    return !!(e && e.connected);
  },

  setReadOnly(id, readOnly) {
    const e = connections.get(id);
    if (e) e.readOnly = !!readOnly;
  },

  getReadOnly(id) {
    const e = connections.get(id);
    return e ? e.readOnly : true;
  },

  allConfigs() {
    return [...connections.values()].map((e) => e.config);
  },

  async ensureOpen(id) {
    const entry = connections.get(id);
    if (!entry) throw new Error('Connection not found: ' + id);
    if (entry.connected && entry.driver) return entry.driver;
    ensureType(entry.config.type);
    const D = DRIVERS[entry.config.type];
    entry.driver = new D(entry.config);
    await entry.driver.connect();
    entry.connected = true;
    return entry.driver;
  },

  async test(config) {
    ensureType(config.type);
    const D = DRIVERS[config.type];
    const d = new D(config);
    try { await d.testConnection(); } finally { await d.close(); }
    return true;
  },

  async connect(id) {
    await manager.ensureOpen(id);
    return true;
  },

  async disconnect(id) {
    const entry = connections.get(id);
    if (!entry) return;
    if (entry.driver && entry.driver.close) {
      try { await entry.driver.close(); } catch (_) {}
    }
    entry.driver = null;
    entry.connected = false;
  },

  async closeAll() {
    const ids = [...connections.keys()];
    await Promise.all(ids.map((id) => manager.disconnect(id)));
  },

  async schemas(id) {
    const d = await manager.ensureOpen(id);
    return d.schemas();
  },

  async tables(id, schema) {
    const d = await manager.ensureOpen(id);
    return d.tables(schema);
  },

  async columns(id, schema, table) {
    const d = await manager.ensureOpen(id);
    return d.columns(schema, table);
  },

  async indexes(id, schema, table) {
    const d = await manager.ensureOpen(id);
    return d.indexes(schema, table);
  },

  async query(id, sql, params = []) {
    const entry = connections.get(id);
    if (!entry) throw new Error('Connection not found: ' + id);
    enforceReadOnly(entry.readOnly, entry.config.type, sql);
    const d = await manager.ensureOpen(id);
    const result = await d.query(sql, params);
    return capRows(result);
  },

  async tableData(id, schema, table, opts = {}) {
    const d = await manager.ensureOpen(id);
    const result = await d.tableData(schema, table, opts);
    return capRows(result);
  },
};

module.exports = manager;
