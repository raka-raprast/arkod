const crypto = require('crypto');

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

function parseQueryString(qs) {
  const out = [];
  if (!qs) return out;
  qs.split('&').forEach((pair) => {
    if (!pair) return;
    const idx = pair.indexOf('=');
    let key, value;
    if (idx < 0) { key = pair; value = ''; }
    else { key = pair.slice(0, idx); value = pair.slice(idx + 1); }
    try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (_) {}
    try { value = decodeURIComponent(value.replace(/\+/g, ' ')); } catch (_) {}
    out.push({ key, value, enabled: true });
  });
  return out;
}

// Postman url can be a string or { raw, host, path, query, variables }.
function normalizeUrl(urlField) {
  if (!urlField) return { url: '', queryParams: [] };
  if (typeof urlField === 'string') {
    const qIdx = urlField.indexOf('?');
    if (qIdx < 0) return { url: urlField, queryParams: [] };
    return { url: urlField.slice(0, qIdx), queryParams: parseQueryString(urlField.slice(qIdx + 1)) };
  }
  let raw = urlField.raw || '';
  let queryField = Array.isArray(urlField.query) ? urlField.query : [];
  if (!raw) {
    // best-effort reconstruction when raw is missing
    const host = Array.isArray(urlField.host) ? urlField.host.join('.') : '';
    const p = Array.isArray(urlField.path) ? urlField.path.map(encodeURIComponent).join('/') : '';
    raw = host ? (host + '/' + p) : p;
  }
  if (raw.indexOf('?') >= 0) {
    const qIdx = raw.indexOf('?');
    if (queryField.length === 0) queryField = parseQueryString(raw.slice(qIdx + 1));
    raw = raw.slice(0, qIdx);
  }
  const queryParams = queryField.map((q) => ({
    key: q.key || '',
    value: q.value || '',
    enabled: !q.disabled,
  }));
  return { url: raw, queryParams };
}

function normalizeHeaders(headerArr) {
  if (!Array.isArray(headerArr)) return [];
  return headerArr.map((h) => ({
    key: h.key || '',
    value: h.value || '',
    enabled: !h.disabled,
  }));
}

function normalizeBody(bodyObj) {
  const out = { mode: 'none', raw: '', urlencoded: [], formdata: [] };
  if (!bodyObj || !bodyObj.mode) return out;
  const mode = bodyObj.mode;
  if (mode === 'raw') {
    out.mode = 'raw';
    out.raw = bodyObj.raw || '';
  } else if (mode === 'urlencoded') {
    out.mode = 'urlencoded';
    out.urlencoded = (Array.isArray(bodyObj.urlencoded) ? bodyObj.urlencoded : []).map((p) => ({
      key: p.key || '',
      value: p.value || '',
      enabled: !p.disabled,
    }));
  } else if (mode === 'formdata') {
    out.mode = 'formdata';
    out.formdata = (Array.isArray(bodyObj.formdata) ? bodyObj.formdata : [])
      .filter((p) => p.type !== 'file')
      .map((p) => ({ key: p.key || '', value: p.value || '', enabled: !p.disabled }));
  }
  return out;
}

function normalizeAuth(authObj) {
  const out = { type: 'none', basic: { user: '', pass: '' }, bearer: { token: '' }, apikey: { key: '', value: '', addTo: 'header' } };
  if (!authObj || !authObj.type || authObj.type === 'noauth') return out;
  if (authObj.type === 'basic') {
    const list = Array.isArray(authObj.basic) ? authObj.basic : [];
    const get = (k) => {
      const x = list.find((p) => p.key === k);
      return x ? x.value : '';
    };
    out.type = 'basic';
    out.basic = { user: get('username') || get('user'), pass: get('password') || get('pass') };
  } else if (authObj.type === 'bearer') {
    out.type = 'bearer';
    out.bearer = { token: (authObj.bearer && authObj.bearer.token) || '' };
  } else if (authObj.type === 'apikey') {
    out.type = 'apikey';
    const list = Array.isArray(authObj.apikey) ? authObj.apikey : [];
    const get = (k) => {
      const x = list.find((p) => p.key === k);
      return x ? x.value : '';
    };
    out.apikey = {
      key: get('key') || '',
      value: get('value') || '',
      addTo: get('in') === 'query' ? 'query' : 'header',
    };
  }
  return out;
}

function normalizeV2Request(item, folder) {
  const req = item.request;
  const name = item.name || (req && (req.name || '')) || 'Request';
  const method = (req && req.method ? String(req.method) : 'GET').toUpperCase();
  const urlInfo = normalizeUrl(req ? req.url : '');
  return {
    id: genId(),
    name: name,
    method: method,
    url: urlInfo.url,
    queryParams: urlInfo.queryParams,
    headers: normalizeHeaders(req ? req.header : []),
    body: normalizeBody(req ? req.body : null),
    auth: normalizeAuth(req ? req.auth : null),
    folder: folder || '',
  };
}

function walkV2(items, prefix, requests) {
  items.forEach((item) => {
    if (item && Array.isArray(item.item)) {
      const folder = prefix ? prefix + ' / ' + (item.name || '') : (item.name || '');
      walkV2(item.item, folder, requests);
    } else if (item && item.request) {
      requests.push(normalizeV2Request(item, prefix));
    }
  });
}

// Legacy Postman v1 collection: { name, requests: [...], folders: [...] }
function parseV1Headers(headersStr) {
  if (!headersStr) return [];
  return headersStr.split(/\r?\n/).map((line) => {
    const idx = line.indexOf(':');
    if (idx < 0) return null;
    return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim(), enabled: true };
  }).filter(Boolean);
}

function parseV1Body(r) {
  const out = { mode: 'none', raw: '', urlencoded: [], formdata: [] };
  if (r.rawModeData) { out.mode = 'raw'; out.raw = r.rawModeData; return out; }
  if (Array.isArray(r.data) && r.data.length) {
    if (r.dataMode === 'urlencoded') {
      out.mode = 'urlencoded';
      out.urlencoded = r.data.map((p) => ({ key: p.key || '', value: p.value || '', enabled: true }));
    } else if (r.dataMode === 'params') {
      out.mode = 'formdata';
      out.formdata = r.data.filter((p) => p.type !== 'file').map((p) => ({ key: p.key || '', value: p.value || '', enabled: true }));
    } else {
      out.mode = 'raw';
      out.raw = r.data.map((p) => p.value || '').join('\n');
    }
  }
  return out;
}

function parsePostmanCollection(json) {
  if (!json || typeof json !== 'object') throw new Error('Invalid Postman collection JSON');
  let name = 'Imported Collection';
  let requests = [];
  if (Array.isArray(json.item)) {
    if (json.info && json.info.name) name = json.info.name;
    walkV2(json.item, '', requests);
  } else if (Array.isArray(json.requests)) {
    // v1
    if (json.name) name = json.name;
    requests = json.requests.map((r) => ({
      id: genId(),
      name: r.name || 'Request',
      method: (r.method || 'GET').toUpperCase(),
      url: typeof r.url === 'string' ? r.url : (r.url && r.url.raw) || '',
      queryParams: [],
      headers: parseV1Headers(r.headers),
      body: parseV1Body(r),
      auth: { type: 'none', basic: { user: '', pass: '' }, bearer: { token: '' } },
      folder: '',
    }));
  } else {
    throw new Error('Unrecognized Postman collection format (expected v2.x "item" or v1 "requests")');
  }
  return { name: name, requests: requests };
}

module.exports = { parsePostmanCollection };
