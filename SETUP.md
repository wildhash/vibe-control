# VibeControl Setup Guide

## Quick Start

### Step 1: Add your Gemini API key

```bash
cd C:\Users\OMNI\projects\vibe-control\web

# Create .env.local file
copy .env.example .env.local
# Then edit .env.local and add your Gemini API key
```

### Step 2: Install dependencies

```bash
# Install web dependencies
cd C:\Users\OMNI\projects\vibe-control\web
npm install

# Install MCP server dependencies
cd ..\mcp-server
npm install
```

### Step 3: Run the app

```bash
cd C:\Users\OMNI\projects\vibe-control\web
npm run dev
```

Open http://localhost:3000

---

## Demo Flow

1. **"Show me the project structure"**
   - AI calls `list_workspace_files` via MCP
   - Renders `WorkspaceTree` component

2. **"Read the main config file"**
   - AI calls `read_file` via MCP
   - Renders `CodePanel` with syntax highlighting

3. **"Run the tests"**
   - AI requests approval (dangerous operation)
   - Renders `ApprovalCard`
   - You click **Authorize**
   - AI receives token, executes command
   - Renders `TerminalStream` with output

---

## Project Structure

```
vibe-control/
├── mcp-server/           # Local MCP server (stdio)
│   ├── index.js          # Server with approval token flow
│   └── package.json
│
└── web/                  # Next.js frontend
    ├── app/
    │   ├── api/
    │   │   ├── agent/    # Main orchestration
    │   │   └── approve/  # Token generation
    │   ├── layout.tsx
    │   └── page.tsx      # Chat interface
    ├── components/vibe/  # Generative UI components
    │   ├── ApprovalCard.tsx
    │   ├── CodePanel.tsx
    │   ├── TerminalStream.tsx
    │   └── WorkspaceTree.tsx
    └── lib/
        └── mcp-host.ts   # MCP bridge (stdio ↔ HTTP)
```

## Troubleshooting

**"GEMINI_API_KEY not configured"**
- Make sure `.env.local` exists in `/web` with your key

**MCP connection errors**
- Check that `mcp-server` dependencies are installed
- The server spawns automatically when you make API calls

**Components not rendering**
- Check browser console for errors
- Verify the API response includes `components` array
