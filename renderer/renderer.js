const responseEl = document.getElementById('response');
const promptEl = document.getElementById('prompt');
const cwdPathEl = document.getElementById('cwd-path');
const cwdBarEl = document.getElementById('cwd-bar');
const newSessionBtn = document.getElementById('new-session');
const sessionListEl = document.getElementById('session-list');

console.log('api available:', !!window.api);

let thinkingEl = null;
let textBuf = '';
let textEl = null;
let activeSessionId = null;

let inFence = false;
let fenceLang = '';
let fenceEl = null;

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatMdLine(line) {
  let html = escapeHtml(line);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html;
}

function appendFormattedLine(html) {
  if (inFence) {
    if (fenceEl) fenceEl.textContent += html;
  } else {
    const span = document.createElement('span');
    span.innerHTML = html;
    responseEl.appendChild(span);
  }
}

function appendText(text) {
  if (!text) return;
  if (inFence) {
    if (fenceEl) {
      fenceEl.textContent += text;
    }
  } else {
    if (!textEl || textEl.tagName === 'PRE') {
      const parent = textEl && textEl.tagName === 'PRE' ? textEl : null;
      textEl = document.createElement('span');
      if (parent) {
        parent.after(textEl);
      } else {
        responseEl.appendChild(textEl);
      }
    }
    textEl.textContent += text;
  }
}

function processTextChunk(chunk) {
  if (!inFence) {
    appendText(chunk);
    return;
  }
  textBuf += chunk;
  let i;
  while ((i = textBuf.indexOf('\n')) !== -1) {
    const line = textBuf.slice(0, i + 1);
    textBuf = textBuf.slice(i + 1);
    processLine(line);
  }
}

function processLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('```')) {
    if (inFence) {
      inFence = false;
      fenceEl = null;
      textEl = null;
    } else {
      inFence = true;
      fenceLang = trimmed.slice(3).trim();
      fenceEl = document.createElement('pre');
      fenceEl.className = 'code-block';
      const codeEl = document.createElement('code');
      if (fenceLang) codeEl.className = 'language-' + fenceLang;
      fenceEl.appendChild(codeEl);
      responseEl.appendChild(fenceEl);
      textEl = null;
    }
  } else {
    appendText(line);
  }
}

function flushTextBuf() {
  if (textBuf) {
    appendText(textBuf);
    textBuf = '';
  }
}

function closeFence() {
  if (inFence) {
    inFence = false;
    fenceEl = null;
    textEl = null;
  }
}

function appendPrompt(text) {
  const div = document.createElement('div');
  div.className = 'user-prompt';
  div.textContent = text;
  responseEl.appendChild(div);
}

function scrollDown() {
  responseEl.scrollTop = responseEl.scrollHeight;
}

async function refreshCwd() {
  cwdPathEl.textContent = await window.api.getCwd();
}
refreshCwd();

async function loadSessions() {
  const sessions = await window.api.listSessions();
  sessionListEl.innerHTML = '';
  for (const s of sessions) {
    const div = document.createElement('div');
    div.className = 'session-item';
    if (s.id === activeSessionId) div.classList.add('active');
    const project = document.createElement('span');
    project.className = 'session-project';
    project.textContent = s.project;
    div.appendChild(project);
    div.appendChild(document.createTextNode(s.title));
    div.addEventListener('click', () => selectSession(s.id));
    sessionListEl.appendChild(div);
  }
}

function selectSession(id) {
  activeSessionId = id;
  responseEl.innerHTML = '';
  window.api.resumeSession(id);
  loadSessions();
  renderHistory(id);
  promptEl.focus();
}

function renderBlock(text) {
  let buf = text;
  let i;
  while ((i = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, i + 1);
    buf = buf.slice(i + 1);
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      processLine(line);
    } else {
      appendFormattedLine(formatMdLine(line));
    }
  }
  if (buf) {
    if (inFence) {
      appendText(buf);
    } else {
      appendFormattedLine(formatMdLine(buf));
    }
  }
}

async function renderHistory(id) {
  const messages = await window.api.sessionHistory(id);
  console.log('history messages:', JSON.stringify(messages, null, 2));
  for (const m of messages) {
    if (m.role === 'user') {
      appendPrompt(m.text);
    } else {
      if (m.thinking) {
        const details = document.createElement('details');
        details.className = 'thinking-block';
        details.open = false;
        const summary = document.createElement('summary');
        summary.textContent = 'Thinking...';
        details.appendChild(summary);
        details.appendChild(document.createTextNode(m.thinking));
        responseEl.appendChild(details);
      }
      if (m.text) {
        renderBlock(m.text);
        flushTextBuf();
        closeFence();
        textEl = null;
        appendRaw('\n');
      }
    }
  }
  scrollDown();
}

cwdBarEl.addEventListener('click', async () => {
  await window.api.pickDir();
  refreshCwd();
});

newSessionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  activeSessionId = null;
  responseEl.innerHTML = '';
  window.api.newSession();
  loadSessions();
  promptEl.focus();
});

if (!promptEl || !responseEl) {
  console.error('Missing elements: prompt=', !!promptEl, 'response=', !!responseEl);
} else {
  responseEl.textContent = 'Oh My Pi ready.\n';
  loadSessions();

  window.api.onSession((id) => {
    activeSessionId = id;
  });

  window.api.onThinking((delta) => {
    if (!thinkingEl) {
      thinkingEl = document.createElement('details');
      thinkingEl.className = 'thinking-block';
      thinkingEl.open = true;
      const summary = document.createElement('summary');
      summary.textContent = 'Thinking...';
      thinkingEl.appendChild(summary);
      responseEl.appendChild(thinkingEl);
      scrollDown();
    }
    thinkingEl.appendChild(document.createTextNode(delta));
    scrollDown();
  });

  window.api.onText((delta) => {
    if (thinkingEl) {
      thinkingEl.open = false;
      thinkingEl = null;
    }
    processTextChunk(delta);
    scrollDown();
  });

  window.api.onChunk((chunk) => {
    appendRaw(chunk);
    scrollDown();
  });

  window.api.onDone((code) => {
    thinkingEl = null;
    flushTextBuf();
    closeFence();
    textEl = null;
    textBuf = '';
    promptEl.disabled = false;
    promptEl.focus();
    loadSessions();
    if (code !== 0) {
      appendRaw(`\n[exit ${code}]\n`);
      scrollDown();
    }
  });

  window.api.onError((msg) => {
    thinkingEl = null;
    flushTextBuf();
    closeFence();
    textEl = null;
    textBuf = '';
    appendRaw(`\nError: ${msg}\n`);
    scrollDown();
    promptEl.disabled = false;
    promptEl.focus();
  });

  promptEl.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;
      promptEl.value = '';
      promptEl.disabled = true;

      appendPrompt(text);
      scrollDown();

      window.api.send(text);
    }
  });

  promptEl.focus();
}

const termToggle = document.getElementById('term-toggle');
const termPanel = document.getElementById('terminal-panel');
const termEl = document.getElementById('terminal');
let term = null;
let fitAddon = null;

termToggle.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (!term) {
    term = new Terminal({ theme: { background: '#000000', foreground: '#d4d4d4' }, fontSize: 13, fontFamily: "'SF Mono', Monaco, Menlo, monospace" });
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(termEl);
    fitAddon.fit();

    term.onData((data) => window.api.termWrite(data));
    window.api.onTermData((data) => term.write(data));
    window.api.onTermExit(() => {
      term.clear();
      term.write('\r\n[terminal closed]\r\n');
    });

    await window.api.termCreate();

    new ResizeObserver(() => {
      if (fitAddon) {
        try { fitAddon.fit(); } catch (_) {}
        window.api.termResize(term.cols, term.rows);
      }
    }).observe(termPanel);
  }

  termPanel.classList.toggle('open');
  if (termPanel.classList.contains('open') && fitAddon) {
    setTimeout(() => {
      try { fitAddon.fit(); } catch (_) {}
      if (term) window.api.termResize(term.cols, term.rows);
    }, 50);
    term.focus();
  } else {
    promptEl.focus();
  }
});
