# Phase 2: Add Tauri JS Mode - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wrap the existing React client in Tauri to enable web vs Tauri-JS performance comparison.

**Architecture:** Same React code runs in Tauri's webview with identical JS WebSocket handling. This isolates the comparison to runtime environment only.

**Tech Stack:** Tauri 2.x, existing React client

---

## Task 1: Initialize Tauri in Client

**Files:**
- Modify: `client/` (via Tauri CLI)
- Create: `client/src-tauri/` directory structure

**Step 1: Install Tauri CLI**

```bash
cd client
npm install -D @tauri-apps/cli@latest
```

**Step 2: Initialize Tauri**

```bash
npx tauri init
```

When prompted:
- App name: `tick-bench`
- Window title: `Tick Bench`
- Web assets location: `../dist`
- Dev server URL: `http://localhost:5173`
- Frontend dev command: `npm run dev`
- Frontend build command: `npm run build`

**Step 3: Add Tauri scripts to package.json**

Add to `client/package.json` scripts:

```json
"tauri": "tauri",
"tauri:dev": "tauri dev",
"tauri:build": "tauri build"
```

**Step 4: Verify Tauri dev mode launches**

```bash
npm run tauri:dev
```

Expected: Tauri window opens showing the React app.

**Step 5: Commit**

```bash
git add .
git commit -m "feat(client): add Tauri configuration"
```

---

## Task 2: Configure Tauri Window Settings

**Files:**
- Modify: `client/src-tauri/tauri.conf.json`

**Step 1: Update window configuration**

In `tauri.conf.json`, update the `app.windows` section:

```json
{
  "app": {
    "windows": [
      {
        "title": "Tick Bench",
        "width": 900,
        "height": 700,
        "resizable": true,
        "fullscreen": false
      }
    ]
  }
}
```

**Step 2: Enable necessary permissions for localhost connections**

Ensure the CSP allows WebSocket connections. In `tauri.conf.json` under `app.security`:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' ws://localhost:8080 http://localhost:8081; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

**Step 3: Verify WebSocket works in Tauri**

1. Start server: `cd server && npm run dev`
2. Start Tauri: `cd client && npm run tauri:dev`
3. Click Connect in the Tauri window
4. Verify messages flow and metrics display

**Step 4: Commit**

```bash
git add .
git commit -m "feat(client): configure Tauri window and CSP for WebSocket"
```

---

## Task 3: Add Mode Indicator to UI

**Files:**
- Modify: `client/src/App.tsx`

**Step 1: Detect if running in Tauri**

Add detection at the top of App.tsx:

```typescript
const isTauri = '__TAURI__' in window;
```

**Step 2: Display mode indicator**

Add to the UI header area:

```tsx
<div style={{ 
  display: 'inline-block',
  padding: '4px 8px',
  backgroundColor: isTauri ? '#7c3aed' : '#2563eb',
  borderRadius: '4px',
  fontSize: '12px',
  marginLeft: '10px'
}}>
  {isTauri ? 'Tauri' : 'Browser'}
</div>
```

**Step 3: Verify indicator shows correctly**

1. Open http://localhost:5173 in browser - should show "Browser" badge (blue)
2. Run `npm run tauri:dev` - should show "Tauri" badge (purple)

**Step 4: Commit**

```bash
git add .
git commit -m "feat(client): add Tauri/Browser mode indicator"
```

---

## Task 4: Add Tauri Type Declarations

**Files:**
- Create: `client/src/tauri.d.ts`

**Step 1: Create type declaration file**

```typescript
// client/src/tauri.d.ts
declare global {
  interface Window {
    __TAURI__?: {
      // Add Tauri API types as needed
    };
  }
}

export {};
```

**Step 2: Verify no TypeScript errors**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add .
git commit -m "feat(client): add Tauri type declarations"
```

---

## Phase 2 Complete

At this point you have:
- React app running in both browser and Tauri
- Same WebSocket code in both environments
- Visual indicator showing which mode you're in
- Ready to compare web vs Tauri-JS performance

**To test:**
1. Start server: `cd server && npm run dev`
2. Browser test: `cd client && npm run dev` → open http://localhost:5173
3. Tauri test: `cd client && npm run tauri:dev`
4. Compare metrics at same rate settings

**Next steps (Phase 3):**
- Add Rust WebSocket handler for Tauri-Rust mode
- Three-way comparison: Browser vs Tauri-JS vs Tauri-Rust
