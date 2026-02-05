# VibeControl

**Generative UI IDE for the "UI Strikes Back" Hackathon**

A self-modifying IDE where AI is the driver and you are the navigator. Built with Tambo SDK + MCP architecture.

## Architecture

```
Browser (Next.js + Tambo) ←→ Next.js API Routes (MCP Host) ←→ MCP Server (stdio) ←→ Filesystem
```

## Quick Start

### 1. Install Dependencies

```bash
# Install web dependencies
cd web
npm install

# Install MCP server dependencies
cd ../mcp-server
npm install
```

### 2. Configure Environment

```bash
# In /web, create .env.local
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Run Development

```bash
# Terminal 1: Start the web app (this also spawns MCP server)
cd web
npm run dev
```

Open http://localhost:3000

## Demo Flow

1. **"Show me the project"** → AI renders WorkspaceTree
2. **"There's a bug in auth"** → AI renders CodePanel with diff
3. **"Apply the fix"** → AI renders ApprovalCard
4. **Click [Authorize]** → TerminalStream shows execution

## Project Structure

```
vibe-control/
├── web/                    # Next.js + Tambo frontend
│   ├── app/
│   │   ├── api/
│   │   │   ├── agent/      # Main agent orchestration
│   │   │   ├── stream/     # SSE for terminal output
│   │   │   └── approve/    # Approval token flow
│   │   └── page.tsx        # Main HUD interface
│   └── components/
│       └── vibe/           # Tambo-registered components
│           ├── WorkspaceTree.tsx
│           ├── CodePanel.tsx
│           ├── ApprovalCard.tsx
│           ├── TerminalStream.tsx
│           └── DiffReview.tsx
│
└── mcp-server/             # Local MCP server (stdio)
    ├── index.js            # Server entry
    ├── tools/              # Tool implementations
    └── approval.js         # Token management
```

## Tech Stack

- **Frontend:** Next.js 14, Tailwind, Tambo SDK, Monaco Editor
- **Backend:** Node.js MCP Server (@modelcontextprotocol/sdk)
- **AI:** Gemini 2.0 Flash (via Tambo)
- **Transport:** HTTP + SSE (browser ↔ Next.js), stdio (Next.js ↔ MCP)
