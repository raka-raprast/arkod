const { spawn } = require('child_process');
const { StreamMessageReader, StreamMessageWriter } = require('vscode-jsonrpc/node');

class LspConnection {
  constructor(process) {
    this.process = process;
    this.reader = new StreamMessageReader(process.stdout);
    this.writer = new StreamMessageWriter(process.stdin);
    this.nextId = 1;
    this.pending = new Map();
    this._notificationHandlers = new Map();
    this._disposed = false;

    this.reader.listen((msg) => this._handle(msg));
  }

  sendRequest(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writer.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  sendNotification(method, params) {
    this.writer.write({ jsonrpc: '2.0', method, params });
  }

  onNotification(method, handler) {
    if (!this._notificationHandlers.has(method)) {
      this._notificationHandlers.set(method, []);
    }
    this._notificationHandlers.get(method).push(handler);
  }

  _handle(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message || msg.error}`));
      else resolve(msg.result);
    } else if (msg.method && this._notificationHandlers.has(msg.method)) {
      for (const handler of this._notificationHandlers.get(msg.method)) {
        try { handler(msg.params); } catch (_) {}
      }
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try { this.reader.dispose(); } catch (_) {}
    try { this.process.kill(); } catch (_) {}
  }
}

function pathToUri(filePath) {
  const p = filePath.replace(/\\/g, '/');
  if (p.match(/^[a-zA-Z]:/)) return 'file:///' + p;
  return 'file://' + p;
}

function uriToPath(uri) {
  let p = uri.replace('file://', '');
  if (p.startsWith('/') && p.match(/^\/[a-zA-Z]:/)) p = p.slice(1);
  return p;
}

function spawnServer(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let settled = false;

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      console.error(`[lsp:${command}] spawn error:`, err.message);
      reject(err);
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[lsp:${command}]`, msg);
    });

    proc.on('exit', (code) => {
      if (!settled && code !== 0 && code !== null) {
        console.log(`[lsp:${command}] exited with code ${code}`);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(proc);
      }
    }, 200);
  });
}

module.exports = { LspConnection, pathToUri, uriToPath, spawnServer };
