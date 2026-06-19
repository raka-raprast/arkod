# AGENTS.md

## Project

Simple macOS Electron desktop app ("Oh My Pi") — a text field + LLM reply window, inspired by Codex.

## Tech Stack

- **Runtime:** Electron (macOS target)
- **LLM:** TBD — likely OpenAI-compatible API or Ollama for local inference
- **Package manager:** npm (node)
- **Renderer:** plain HTML/CSS/JS or a minimal framework — keep it simple

## Architecture Plan

```
main process    →  Electron window + IPC
renderer        →  text input + response display
llm layer       →  call LLM API, stream or return full reply
```

- Single window, single page
- Text field at bottom, LLM reply above
- IPC bridge: renderer sends user input → main process → LLM call → response back to renderer
- Handle Enter to submit, Shift+Enter for newline

## Dev Commands

```bash
npm install          # install deps (electron, etc.)
npm start            # launch the Electron app
npm run lint         # lint JS
npm test             # run tests (when added)
```

## Conventions

- Keep the app single-window, minimal dependencies
- Use `contextIsolation: true` and `nodeIntegration: false` (Electron security defaults)
- Store API keys in macOS Keychain or `.env` (never commit secrets)
- No TypeScript unless decided later — start with plain JS for speed
