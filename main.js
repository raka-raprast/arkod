const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

try { require('electron-reload')(__dirname); } catch (_) {}

let mainWindow;
let cwd = process.cwd();
let activeSessionId = null;
let busy = false;
let termProc = null;

const SESSIONS_DIR = path.join(os.homedir(), '.omp', 'agent', 'sessions');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('cwd:get', () => cwd);

ipcMain.handle('cwd:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Pick a project directory',
  });
  if (!result.canceled && result.filePaths.length > 0) {
    cwd = result.filePaths[0];
    activeSessionId = null;
  }
  return cwd;
});

ipcMain.handle('session:new', () => {
  activeSessionId = null;
});

ipcMain.handle('sessions:list', async () => {
  const sessions = [];
  try {
    const projectDirs = fs.readdirSync(SESSIONS_DIR);
    for (const proj of projectDirs) {
      const dirPath = path.join(SESSIONS_DIR, proj);
      if (!fs.statSync(dirPath).isDirectory()) continue;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const filePath = path.join(dirPath, file);
        const sessionId = file.replace(/\.jsonl$/, '');
        let title = file;
        try {
          const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
          const msg = JSON.parse(firstLine);
          if (msg.message && msg.message.content) {
            const texts = msg.message.content
              .filter(c => c.type === 'text')
              .map(c => c.text)
              .join(' ');
            if (texts) title = texts.slice(0, 80);
          }
        } catch (_) {}
        sessions.push({ id: sessionId, title, project: proj, filePath });
      }
    }
  } catch (_) {}
  sessions.sort((a, b) => b.id.localeCompare(a.id));
  return sessions;
});

ipcMain.handle('session:resume', (_event, id) => {
  activeSessionId = id;
  return id;
});

ipcMain.handle('session:history', async (_event, id) => {
  const messages = [];
  try {
    const projectDirs = fs.readdirSync(SESSIONS_DIR);
    for (const proj of projectDirs) {
      const fpath = path.join(SESSIONS_DIR, proj, id + '.jsonl');
      if (fs.existsSync(fpath)) {
        const lines = fs.readFileSync(fpath, 'utf8').split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'message' && ev.message) {
              const msg = ev.message;
              if (msg.role === 'toolResult') continue;
              const texts = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
              const thinkings = (msg.content || []).filter(c => c.type === 'thinking').map(c => c.thinking).join('');
              if (texts || thinkings) {
                messages.push({ role: msg.role, text: texts, thinking: thinkings });
              }
            }
          } catch (_) {}
        }
        break;
      }
    }
  } catch (_) {}
  console.log('history for', id, ':', JSON.stringify(messages, null, 2));
  return messages;
});

ipcMain.handle('llm:send', (_event, prompt) => {
  if (busy) return;
  busy = true;

  const args = ['-p', '--mode', 'json'];
  if (activeSessionId) {
    args.push('--resume', activeSessionId);
  }
  args.push(prompt);

  const proc = spawn('omp', args, { cwd });
  let buf = '';

  proc.stdout.on('data', (data) => {
    buf += data.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'session' && ev.id && !activeSessionId) {
          activeSessionId = ev.id;
          mainWindow.webContents.send('llm:session', ev.id);
        }
        if (ev.type === 'message_update') {
          const inner = ev.assistantMessageEvent;
          if (inner.type === 'thinking_delta' && inner.delta) {
            mainWindow.webContents.send('llm:thinking', inner.delta);
          } else if (inner.type === 'text_delta' && inner.delta) {
            mainWindow.webContents.send('llm:text', inner.delta);
          }
        }
      } catch (_) {
        mainWindow.webContents.send('llm:chunk', line);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    mainWindow.webContents.send('llm:chunk', data.toString());
  });

  proc.on('close', (code) => {
    busy = false;
    mainWindow.webContents.send('llm:done', code);
  });

  proc.on('error', (err) => {
    busy = false;
    mainWindow.webContents.send('llm:error', err.message);
  });
});

ipcMain.handle('term:create', () => {
  if (termProc) termProc.kill();
  const shell = process.env.SHELL || '/bin/zsh';
  const pty = require('node-pty');
  try {
    termProc = pty.spawn(shell, [], { cwd, env: process.env, cols: 80, rows: 24 });
  } catch (err) {
    console.error('pty spawn failed:', err.message);
    return;
  }
  termProc.onData((data) => mainWindow.webContents.send('term:data', data));
  termProc.onExit(() => { termProc = null; mainWindow.webContents.send('term:exit'); });
});

ipcMain.on('term:write', (_e, data) => {
  if (termProc) termProc.write(data);
});

ipcMain.on('term:resize', (_e, cols, rows) => {
  if (termProc) termProc.resize(cols, rows);
});

ipcMain.on('term:destroy', () => {
  if (termProc) { termProc.kill(); termProc = null; }
});
