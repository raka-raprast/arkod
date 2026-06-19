const { LspConnection, pathToUri, uriToPath, spawnServer } = require('./protocol');
const { detectLanguages, getLanguageConfig, languageForFile, loadProjectConfig } = require('./detect');
const { EventEmitter } = require('events');
const path = require('path');

class LspManager extends EventEmitter {
  constructor() {
    super();
    this.servers = new Map();
    this.connections = new Map();
    this.serverCaps = new Map();
    this.openDocs = new Map();
    this.fileLang = new Map();
    this.cwd = null;
    this._diagnostics = new Map();
    this.initialized = false;
  }

  async initialize(cwd) {
    if (this._lastCwd === cwd) return;
    this.cwd = cwd;
    this.shutdown();
    this._lastCwd = cwd;

    const config = loadProjectConfig(cwd);
    const languages = detectLanguages(cwd);

    for (const lang of languages) {
      await this._startServer(lang, config);
    }

    this.initialized = true;
    this.emit('ready', { languages: [...this.connections.keys()] });
  }

  async _startServer(lang, config) {
    const cfg = getLanguageConfig(lang, config);
    if (!cfg) return;

    let proc;
    try {
      proc = await spawnServer(cfg.command, cfg.args, this.cwd);
    } catch (err) {
      console.error(`[lsp] Failed to start ${lang} server:`, err.message);
      return;
    }

    let initTimeout;
    const initPromise = new Promise((resolve, reject) => {
      const conn = new LspConnection(proc);
      this.connections.set(lang, conn);

      const cleanup = () => {
        clearTimeout(initTimeout);
        this.connections.delete(lang);
        try { conn.dispose(); } catch (_) {}
      };

      proc.on('error', () => cleanup());
      proc.on('exit', (code) => {
        if (code !== 0 && code !== null) cleanup();
      });

      initTimeout = setTimeout(() => {
        console.error(`[lsp] ${lang} server init timed out`);
        cleanup();
        resolve();
      }, 10000);

      const rootUri = pathToUri(this.cwd);
      conn.sendRequest('initialize', {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: true } },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            definition: { linkSupport: true },
            references: {},
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: {
            configuration: true,
            workspaceFolders: true,
            diagnostics: { relatedInformation: true },
          },
        },
        workspaceFolders: [{ uri: rootUri, name: path.basename(this.cwd) }],
      }).then((result) => {
        clearTimeout(initTimeout);
        conn.sendNotification('initialized', {});
        this.serverCaps.set(lang, result.capabilities);
        conn.onNotification('textDocument/publishDiagnostics', (params) => {
          this._diagnostics.set(params.uri, params.diagnostics || []);
          this.emit('diagnostics', params);
        });
        conn.onNotification('window/showMessage', (params) => {
          console.log(`[lsp:${lang}]`, params.message);
        });
        console.log(`[lsp] ${lang} server started (${cfg.command})`);
        resolve();
      }).catch((err) => {
        console.error(`[lsp] ${lang} initialize failed:`, err.message);
        cleanup();
        resolve();
      });
    });

    await initPromise;
  }

  async openDocument(filePath, text) {
    const lang = languageForFile(filePath);
    if (!lang || !this.connections.has(lang)) return null;

    const uri = pathToUri(filePath);
    this.openDocs.set(uri, { text, lang, version: 1 });
    this.fileLang.set(uri, lang);

    const conn = this.connections.get(lang);
    conn.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: lang,
        version: 1,
        text,
      },
    });

    return { uri, language: lang };
  }

  async changeDocument(filePath, text) {
    const uri = pathToUri(filePath);
    const doc = this.openDocs.get(uri);
    if (!doc) return;

    doc.version = (doc.version || 1) + 1;
    doc.text = text;

    const lang = this.fileLang.get(uri);
    const conn = this.connections.get(lang);
    if (!conn) return;

    conn.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: doc.version },
      contentChanges: [{ text }],
    });
  }

  closeDocument(filePath) {
    const uri = pathToUri(filePath);
    const lang = this.fileLang.get(uri);
    if (!lang) return;

    const conn = this.connections.get(lang);
    if (conn) {
      conn.sendNotification('textDocument/didClose', {
        textDocument: { uri },
      });
    }

    this.openDocs.delete(uri);
    this.fileLang.delete(uri);
  }

  async completion(filePath, line, character) {
    const uri = pathToUri(filePath);
    const lang = this.fileLang.get(uri);
    if (!lang) return null;

    const caps = this.serverCaps.get(lang);
    const triggerKind = caps?.textDocument?.completion?.completionItem
      ? (caps.textDocument.completion.completionItem.snippetSupport ? 2 : 1)
      : 1;

    const conn = this.connections.get(lang);
    if (!conn) return null;

    try {
      const result = await conn.sendRequest('textDocument/completion', {
        textDocument: { uri },
        position: { line, character },
        context: { triggerKind },
      });
      return result;
    } catch (err) {
      return null;
    }
  }

  async hover(filePath, line, character) {
    const uri = pathToUri(filePath);
    const lang = this.fileLang.get(uri);

    const conn = this.connections.get(lang);
    if (!conn) return null;

    try {
      return await conn.sendRequest('textDocument/hover', {
        textDocument: { uri },
        position: { line, character },
      });
    } catch (err) {
      return null;
    }
  }

  async definition(filePath, line, character) {
    const uri = pathToUri(filePath);
    const lang = this.fileLang.get(uri);

    const conn = this.connections.get(lang);
    if (!conn) return null;

    try {
      return await conn.sendRequest('textDocument/definition', {
        textDocument: { uri },
        position: { line, character },
      });
    } catch (err) {
      return null;
    }
  }

  async references(filePath, line, character) {
    const uri = pathToUri(filePath);
    const lang = this.fileLang.get(uri);

    const conn = this.connections.get(lang);
    if (!conn) return null;

    try {
      return await conn.sendRequest('textDocument/references', {
        textDocument: { uri },
        position: { line, character },
        context: { includeDeclaration: true },
      });
    } catch (err) {
      return null;
    }
  }

  getDiagnosticsForFile(filePath) {
    const uri = pathToUri(filePath);
    return this._diagnostics.get(uri) || [];
  }

  getAllDiagnostics() {
    const result = {};
    for (const [uri, diags] of this._diagnostics) {
      if (diags.length > 0) result[uri] = diags;
    }
    return result;
  }

  getReadyLanguages() {
    return [...this.connections.keys()];
  }

  isReady() {
    return this.initialized;
  }

  shutdown() {
    for (const [lang, conn] of this.connections) {
      try { conn.sendRequest('shutdown', {}).catch(() => {}); } catch (_) {}
    }
    for (const conn of this.connections.values()) {
      try { conn.dispose(); } catch (_) {}
    }
    this.connections.clear();
    this.serverCaps.clear();
    this.openDocs.clear();
    this.fileLang.clear();
    this._lastCwd = null;
    this.initialized = false;
  }
}

module.exports = LspManager;
