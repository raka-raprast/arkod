const { MongoClient, ObjectId, Decimal128, Binary } = require('mongodb');

function toPlain(v, seen) {
  if (v == null) return null;
  if (typeof v !== 'object') return v;
  if (v instanceof ObjectId) return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Decimal128) return v.toString();
  if (v instanceof Binary) return v.buffer.toString('base64');
  if (Array.isArray(v)) return v.map((x) => toPlain(x, seen));
  if (v.buffer && typeof v.subarray === 'function' && v.BYTES_PER_ELEMENT) {
    return Buffer.from(v).toString('base64');
  }
  if (seen && seen.has(v)) return '[Circular]';
  seen && seen.add(v);
  const out = {};
  for (const k of Object.keys(v)) out[k] = toPlain(v[k], seen);
  seen && seen.delete(v);
  return out;
}

function bsonTypeName(v) {
  if (v == null) return 'null';
  if (v instanceof ObjectId) return 'objectId';
  if (v instanceof Date) return 'date';
  if (v instanceof Decimal128) return 'decimal';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : typeof v;
}

class MongoDriver {
  constructor(config) {
    this.config = config;
    this.client = null;
  }

  db(name) {
    return this.client.db(name || this.config.database || null);
  }

  async connect() {
    if (!this.config.uri) throw new Error('A connection string (uri) is required for MongoDB');
    this.client = new MongoClient(this.config.uri, { serverSelectionTimeoutMS: 10000 });
    await this.client.connect();
    await this.client.db(this.config.database || 'admin').command({ ping: 1 });
  }

  async testConnection() {
    if (!this.config.uri) throw new Error('A connection string (uri) is required for MongoDB');
    const client = new MongoClient(this.config.uri, { serverSelectionTimeoutMS: 8000 });
    try {
      await client.connect();
      await client.db(this.config.database || 'admin').command({ ping: 1 });
    } finally { try { await client.close(); } catch (_) {} }
  }

  async schemas() {
    const res = await this.client.db().admin().listDatabases();
    return res.databases
      .filter((d) => !['admin', 'local', 'config'].includes(d.name))
      .map((d) => ({ name: d.name }));
  }

  async tables(schema) {
    const cols = await this.db(schema).listCollections().toArray();
    return cols.map((c) => ({ name: c.name, type: c.type === 'view' ? 'view' : 'collection' }));
  }

  async columns(schema, table) {
    const sample = await this.db(schema).collection(table)
      .aggregate([{ $sample: { size: 100 } }]).toArray();
    const map = new Map();
    for (const doc of sample) {
      for (const [k, v] of Object.entries(doc)) {
        if (!map.has(k)) map.set(k, bsonTypeName(v));
      }
    }
    return [...map.entries()].map(([name, type]) => ({
      name, type, notNull: false, pk: name === '_id', defaultValue: null,
    }));
  }

  async indexes(schema, table) {
    const idxs = await this.db(schema).collection(table).indexes();
    return idxs.map((i) => ({
      name: i.name,
      columns: Object.keys(i.key || {}),
      unique: !!i.unique,
    }));
  }

  async query(queryStr) {
    const start = Date.now();
    let q;
    try { q = typeof queryStr === 'string' ? JSON.parse(queryStr) : queryStr; }
    catch (e) { throw new Error('MongoDB query must be valid JSON: ' + e.message); }
    if (!q || typeof q !== 'object') throw new Error('MongoDB query must be a JSON object');

    const dbName = q.db || this.config.database;
    const coll = q.aggregate || q.collection;
    if (!coll) throw new Error('MongoDB query requires a "collection" (or "aggregate") field');
    const collection = this.db(dbName).collection(coll);

    let rows;
    if (q.aggregate) {
      const pipeline = Array.isArray(q.pipeline) ? q.pipeline : [];
      rows = await collection.aggregate(pipeline).limit(q.limit || 1000).toArray();
    } else {
      let cur = collection.find(q.filter || {});
      if (q.projection) cur = cur.project(q.projection);
      if (q.sort) cur = cur.sort(q.sort);
      cur = cur.limit(q.limit || 1000);
      rows = await cur.toArray();
    }
    const plain = rows.map((r) => toPlain(r, new Set()));
    const columns = plain.length ? Object.keys(plain[0]) : [];
    return { columns, rows: plain, rowCount: plain.length, affected: 0, timeMs: Date.now() - start };
  }

  async tableData(schema, table, opts = {}) {
    const start = Date.now();
    const limit = Math.max(1, Math.min(opts.limit != null ? opts.limit : 1000, 1000));
    const offset = Math.max(0, opts.offset || 0);
    const coll = this.db(schema).collection(table);
    let cur = coll.find(opts.where ? parseFilter(opts.where) : {});
    cur = cur.skip(offset).limit(limit);
    if (opts.orderBy) cur = cur.sort(parseSort(opts.orderBy));
    const rows = await cur.toArray();
    const total = await coll.countDocuments(opts.where ? parseFilter(opts.where) : {});
    const plain = rows.map((r) => toPlain(r, new Set()));
    const columns = plain.length ? Object.keys(plain[0]) : [];
    return { columns, rows: plain, total, limit, offset, timeMs: Date.now() - start };
  }

  async close() {
    if (this.client) { try { await this.client.close(); } catch (_) {} this.client = null; }
  }
}

function parseFilter(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (_) { return {}; }
}

function parseSort(s) {
  if (!s) return undefined;
  const out = {};
  String(s).split(',').map((p) => p.trim()).filter(Boolean).forEach((p) => {
    const m = p.match(/^(\w+)(\s+(ASC|DESC))?$/i);
    if (m) out[m[1]] = m[3] && /desc/i.test(m[3]) ? -1 : 1;
  });
  return out;
}

module.exports = MongoDriver;
