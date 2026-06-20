# Repository Guidelines

## Project Overview
Arkod is a macOS desktop LLM-powered coding assistant built on Electron. It provides a minimal but functional IDE experience, combining a VS Code-like interface (CodeMirror editor, LSP integration, multi-tab xterm.js terminal) with an AI chat interface that interacts with the filesystem via an external `omp` CLI agent.

## Architecture & Data Flow
The application follows a standard Electron multi-process architecture:
- **Main Process** (`main.js`): Handles window management, IPC routing, OS-level filesystem/persistence operations, terminal PTY processes (`node-pty`), diff calculation, and spawning the external `omp` CLI agent. It also manages Language Server Protocol (LSP) child processes via `vscode-jsonrpc`.
- **Preload Bridge** (`preload.js`): Acts as a secure `contextBridge` IPC surface, exposing a bounded `window.api` object for secure communication between Renderer and Main contexts.
- **Renderer Process** (`renderer/`): Orchestrates the UI (chat, terminal layout, code editor). It operates mostly as a thin view layer, delegating heavy lifting to `window.api`.
- **Data Flow**: Operations start in `renderer/renderer.js` as UI events, invoking bounded methods on `window.api`. These trigger `ipcRenderer.invoke` (request-response) or `.send` to `ipcMain` handlers. Async streams (LSP diagnostics, terminal stdout, LLM chat chunks) flow back via `mainWindow.webContents.send` and trigger `.on` callbacks in the renderer.

## Key Directories
- `/`: Main process code (`main.js`, `preload.js`), custom unified diff generation (`diff.js`), and build configurations (`build.mjs`, `package.json`).
- `renderer/`: Frontend UI shell containing the structural layout (`index.html`), flexbox-based styles (`style.css`), vanilla JS orchestrator (`renderer.js`), CodeMirror 6 bundling entry point (`editor.mjs`), and vendored libraries (xterm.js).
- `lsp/`: Language Server Protocol integration. Auto-detects languages based on heuristics (`detect.js`), wraps `vscode-jsonrpc/node` streams (`protocol.js`), and exposes high-level code intelligence operations centrally (`manager.js`).

## Development Commands
- `npm install`: Install dependencies and rebuild native modules (e.g., `node-pty`) via `@electron/rebuild`.
- `npm run dev` or `npm start`: Bundle the frontend code via esbuild and launch the Electron application with hot-reloading (`electron-reload`).
- `npm run build`: Use esbuild to bundle `renderer/editor.mjs` into an IIFE format (`renderer/bundle/editor-bundle.js`) for the browser.
- `npm run lint`: Run ESLint.

## Code Conventions & Common Patterns
- **Language**: Pure JavaScript across the stack. No TypeScript.
- **Security Defaults**: Strict Electron security defaults apply (`contextIsolation: true`, `nodeIntegration: false`).
- **State Management**: Ad-hoc, module-level variables keep track of UI state. Variables like `sidebarVisible`, `activeTabId`, and `sashDrag` live at the top of `renderer.js` and `editor.mjs`. There is no central store like Redux.
- **DOM Manipulation**: Imperative and vanilla. Directly uses `document.getElementById`, `document.createElement`, and `appendChild`. Complex blocks (e.g., side-by-side diffs, markdown chunks) are dynamically constructed via iterative DOM trees without components (no React/Vue).
- **Async Patterns**: Heavy reliance on `async/await` for IPC request/response cycles. Markdown streaming and similar flows are processed synchronously line-by-line as data arrives.
- **Native Modules**: Usage of native modules (like `node-pty`) requires explicit rebuilding during the install phase.

## Important Files
- `main.js`: Main Electron process entry point handling sessions, IPC, windows, and spawned tasks.
- `preload.js`: Defines the secure IPC boundary.
- `renderer/renderer.js`: The core frontend controller handling layout events, UI state, and custom text/markdown rendering.
- `renderer/editor.mjs`: Configures CodeMirror 6 extensions, themes, and LSP capabilities (diagnostics, completions).
- `lsp/manager.js`: Stateful manager that spawns and orchestrates Language Servers using stdio.
- `diff.js`: Computes custom unified diffs (longest common subsequence) for file changes.

## Runtime/Tooling Preferences
- **Runtime**: Node.js within Electron.
- **Package Manager**: npm.
- **Bundler**: ESBuild (used exclusively for the renderer CodeMirror bundle).

## Testing & QA
- **Current State**: There is no automated testing framework (e.g., Jest/Mocha) or existing test suite.
- **QA Expectation**: Verification requires manual QA via `npm run dev` to ensure UI components and IPC calls function correctly end-to-end.