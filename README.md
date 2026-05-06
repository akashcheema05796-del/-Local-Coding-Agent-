# Gemma Agent V1 (Local Coding Agent)

A high-performance, bento-grid styled coding assistant inspired by DeepSeek-TUI. This agent is designed to simulate a local terminal-based development environment with real file-system capabilities.

## 🚀 Features

- **Bento UI Architecture**: Multi-pane layout for terminal, workspace visualization, and reasoning logs.
- **Local Tool System**: Real-time interaction with the project workspace.
  - `list_files`: Scan directories.
  - `read_file`: Inspect code safely.
  - `write_file`: Generate and modify project files.
- **AI Inference Engine**: Powered by Gemini 1.5 Flash for rapid token processing.
- **Hardware Simulation**: Real-time dashboard showing simulated GPU Load, VRAM usage, and System Latency.

## 🛠️ Architecture

### Tech Stack
- **Frontend**: React 19 + Vite (Tailwind CSS 4.0)
- **Backend**: Node.js / Express (Tool proxy server)
- **AI**: Gemini API (with streaming support)
- **Animation**: Motion (Framer Motion)

### Project Structure
- `/src/App.tsx`: Main application shell and UI logic.
- `/server.ts`: Express backend handling tool execution and API proxying.
- `/src/index.css`: Custom terminal-style theme variables and scrollbars.

## ⚙️ Configuration

1. **API Key**: Ensure `GEMINI_API_KEY` is set in your environment variables.
2. **Local Environment**: The agent operates within the `/usr/agent/work` context inside the AI Studio container.

## ⌨️ Global Shortcuts

- `Enter`: Submit token request.
- `Ctrl + K`: Quick search (focus input).
- `/status`: Check system module health.

## 📜 License

Apache-2.0
