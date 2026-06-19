const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (prompt) => ipcRenderer.invoke('llm:send', prompt),
  getCwd: () => ipcRenderer.invoke('cwd:get'),
  pickDir: () => ipcRenderer.invoke('cwd:pick'),
  newSession: () => ipcRenderer.invoke('session:new'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  resumeSession: (id) => ipcRenderer.invoke('session:resume', id),
  sessionHistory: (id) => ipcRenderer.invoke('session:history', id),
  termCreate: () => ipcRenderer.invoke('term:create'),
  termWrite: (data) => ipcRenderer.send('term:write', data),
  termResize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
  termDestroy: () => ipcRenderer.send('term:destroy'),
  onTermData: (cb) => ipcRenderer.on('term:data', (_e, d) => cb(d)),
  onTermExit: (cb) => ipcRenderer.on('term:exit', () => cb()),
  onChunk: (cb) => ipcRenderer.on('llm:chunk', (_e, d) => cb(d)),
  onThinking: (cb) => ipcRenderer.on('llm:thinking', (_e, d) => cb(d)),
  onText: (cb) => ipcRenderer.on('llm:text', (_e, d) => cb(d)),
  onSession: (cb) => ipcRenderer.on('llm:session', (_e, id) => cb(id)),
  onDone: (cb) => ipcRenderer.on('llm:done', (_e, c) => cb(c)),
  onError: (cb) => ipcRenderer.on('llm:error', (_e, m) => cb(m)),
});
