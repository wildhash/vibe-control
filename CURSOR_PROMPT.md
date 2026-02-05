# VibeControl - Cursor Agent Prompt

## Project Context

This is **VibeControl**, a Generative UI IDE for the Tambo hackathon "The UI Strikes Back" by WeMakeDevs. 

**Key Links:**
- Tambo Docs: https://docs.tambo.co/
- Charlie Labs: https://charlielabs.ai/
- Hackathon: https://www.wemakedevs.org/hackathons/tambo/schedule

## Architecture

```
Browser (Next.js + Chat UI)
    │ 
    │ fetch('/api/agent')
    ▼
API Routes (Tool Orchestration)
    │
    │ Direct function calls
    ▼
lib/mcp-tools.ts (Filesystem + Terminal + Git)
    │
    ▼
Local Filesystem / Shell
```

## What's Already Built

### Working Components (`/web/components/vibe/`)
- ✅ `ApprovalCard.tsx` - Permission UI with token flow + terminal execution
- ✅ `WorkspaceTree.tsx` - File explorer with expand/collapse
- ✅ `CodePanel.tsx` - Monaco editor with syntax highlighting
- ✅ `TerminalStream.tsx` - Live terminal output display
- ✅ `DiffReview.tsx` - Code diff viewer

### Working API Routes (`/web/app/api/`)
- ✅ `/api/agent` - Gemini + tool orchestration
- ✅ `/api/approve` - Token generation
- ✅ `/api/execute` - Command execution with token validation

### Working Libraries (`/web/lib/`)
- ✅ `mcp-tools.ts` - Direct filesystem/terminal/git operations
- ⚠️ `mcp-host.ts` - stdio bridge (not used, kept for reference)

## What Needs to Be Done

### Priority 1: Get It Running
```bash
cd C:\Users\OMNI\projects\vibe-control\web
npm install
# Create .env.local with GEMINI_API_KEY=your_key
npm run dev
```

### Priority 2: Test the Demo Flow
1. Open http://localhost:3000
2. Type: "Show me the project structure"
3. Type: "Read the package.json"
4. Type: "Run npm test" (should show approval card)

### Priority 3: Polish for Hackathon

**If basic flow works, enhance these:**

1. **Tambo Integration** - Register components with Tambo SDK
   - Read https://docs.tambo.co/concepts/components/interactable-components
   - Wrap components with Tambo's component registry
   - Add proper Zod schemas for all props

2. **Streaming Terminal Output**
   - Use `/api/stream` SSE endpoint
   - Update TerminalStream to subscribe to stream
   - Show real-time command output

3. **Better Error Handling**
   - Add loading states
   - Show friendly error messages
   - Handle network failures gracefully

4. **Demo Video Polish**
   - Add smooth animations (framer-motion)
   - Add "magic" transitions between states
   - Record a 2-minute demo

## File Structure

```
C:\Users\OMNI\projects\vibe-control\
├── web/
│   ├── app/
│   │   ├── page.tsx              # Main chat UI
│   │   ├── layout.tsx            # Root layout
│   │   ├── globals.css           # Tailwind styles
│   │   └── api/
│   │       ├── agent/route.ts    # Gemini orchestration
│   │       ├── approve/route.ts  # Token generation
│   │       ├── execute/route.ts  # Command execution
│   │       └── stream/route.ts   # SSE streaming
│   ├── components/vibe/
│   │   ├── ApprovalCard.tsx      # ⭐ Key component
│   │   ├── WorkspaceTree.tsx
│   │   ├── CodePanel.tsx
│   │   ├── TerminalStream.tsx
│   │   ├── DiffReview.tsx
│   │   └── index.ts
│   ├── lib/
│   │   ├── mcp-tools.ts          # ⭐ Core tools
│   │   └── mcp-host.ts           # (backup)
│   ├── package.json
│   └── .env.example
└── mcp-server/                   # (not used, kept for reference)
```

## Key Code Patterns

### Tool → Component Flow (in `/api/agent/route.ts`)
```typescript
case "list_workspace_files": {
  const tree = await workspaceList(path, depth);
  return {
    result: tree,
    component: {
      type: "workspace_tree",
      props: { tree, rootPath: path },
    },
  };
}
```

### Approval Token Security (in `/lib/mcp-tools.ts`)
```typescript
// 1. Agent requests approval → returns request_id
const result = await requestApproval(action, reason, command);

// 2. User clicks Approve → UI calls /api/approve → returns token
const { approval_token } = await grantApproval(request_id);

// 3. Execute with token (one-time use, 60s expiry)
await runTerminal(command, approval_token);
```

## Troubleshooting

**"GEMINI_API_KEY not configured"**
- Create `.env.local` in `/web` folder
- Add: `GEMINI_API_KEY=your_key_here`

**Components not rendering**
- Check browser console for errors
- Verify `/api/agent` returns `components` array
- Check component types match in `page.tsx` switch statement

**Approval flow broken**
- Tokens expire after 60 seconds
- Tokens are one-time use
- Check `/api/approve` and `/api/execute` routes

## Commands Reference

```bash
# Install deps
cd C:\Users\OMNI\projects\vibe-control\web
npm install

# Run dev server
npm run dev

# Build for production
npm run build
```

## Hackathon Winning Tips

1. **Demo Flow Must Be Smooth** - Practice the exact sequence
2. **Show the "Magic Moment"** - UI transforming based on AI decisions
3. **Approval Flow is the Climax** - This shows safety + control
4. **Keep It Simple** - Don't add features that might break

## Contact

Project created for Willy's hackathon submission.
Tambo Hackathon: "The UI Strikes Back"
