const crypto = require('crypto');
const { executeRequest } = require('./executor');
const { parsePostmanCollection } = require('./postman');

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

// In-memory store: id -> { id, name, scope, requests: [...] }
const collections = new Map();

function defaultRequest() {
  return {
    id: genId(),
    name: 'Untitled Request',
    method: 'GET',
    url: '',
    queryParams: [],
    headers: [],
    body: { mode: 'none', raw: '', urlencoded: [], formdata: [] },
    auth: { type: 'none', basic: { user: '', pass: '' }, bearer: { token: '' }, apikey: { key: '', value: '', addTo: 'header' } },
    folder: '',
  };
}

function cloneRequest(r) {
  return JSON.parse(JSON.stringify(r));
}

function cloneCollection(c) {
  return {
    id: c.id,
    name: c.name,
    scope: c.scope || 'global',
    requests: (c.requests || []).map(cloneRequest),
  };
}

const manager = {
  genId,
  defaultRequest,

  allCollections() {
    return [...collections.values()].map(cloneCollection);
  },

  getCollection(id) {
    const c = collections.get(id);
    return c ? cloneCollection(c) : null;
  },

  setCollection(id, data) {
    collections.set(id, {
      id: id,
      name: data.name || 'Untitled',
      scope: data.scope === 'project' ? 'project' : 'global',
      requests: Array.isArray(data.requests) ? data.requests.map(cloneRequest) : [],
    });
  },

  register(data) {
    const id = data.id || genId();
    manager.setCollection(id, data);
    return id;
  },

  remove(id) {
    return collections.delete(id);
  },

  rename(id, name) {
    const c = collections.get(id);
    if (c) c.name = name;
  },

  addRequest(collectionId, req) {
    const c = collections.get(collectionId);
    if (!c) throw new Error('Collection not found');
    const base = defaultRequest();
    const merged = Object.assign(base, req || {});
    if (!merged.id) merged.id = genId();
    c.requests.push(merged);
    return cloneRequest(merged);
  },

  updateRequest(collectionId, req) {
    const c = collections.get(collectionId);
    if (!c) throw new Error('Collection not found');
    const idx = c.requests.findIndex((r) => r.id === req.id);
    if (idx < 0) {
      const r = cloneRequest(req);
      if (!r.id) r.id = genId();
      c.requests.push(r);
      return r;
    }
    c.requests[idx] = cloneRequest(req);
    return cloneRequest(c.requests[idx]);
  },

  removeRequest(collectionId, reqId) {
    const c = collections.get(collectionId);
    if (!c) return;
    c.requests = c.requests.filter((r) => r.id !== reqId);
  },

  async execute(request) {
    return executeRequest(request);
  },

  importCollection(parsed, scope) {
    const id = genId();
    const coll = {
      id: id,
      name: (parsed && parsed.name) || 'Imported Collection',
      scope: scope === 'project' ? 'project' : 'global',
      requests: (parsed && Array.isArray(parsed.requests)) ? parsed.requests.map(cloneRequest) : [],
    };
    collections.set(id, coll);
    return manager.getCollection(id);
  },

  parsePostman(json) {
    return parsePostmanCollection(json);
  },
};

module.exports = manager;
