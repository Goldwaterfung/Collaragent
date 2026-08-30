## Connecting OAuth 2.0 Tokens for the Threads API (Electron / Collaragent)

This guide is tailored for the **Collaragent Electron app**. It covers the full OAuth 2.0 flow using the **Custom Protocol (Deep Link)** approach — the recommended method for desktop apps — and maps every step to the existing project architecture (`main/`, `shared/ipc/`, `SecureStorage`, `ThreadsTools.ts`).

---

### Why Custom Protocol (Not BrowserWindow)?

Meta recommends against embedded webviews for OAuth. The custom protocol approach:
- Opens the auth URL in the user's **real system browser** (more trustworthy, no webview restrictions)
- Redirects back to the app via a registered URI scheme: `collaragent://auth/threads/callback`
- Keeps the **App Secret entirely in the main process** — never exposed to the renderer

---

### Prerequisites

- **Meta App Setup**: Create an app in the [Meta for Developers portal](https://developers.facebook.com/apps) with the Threads use case. Note your **Threads App ID** and **Threads App Secret** (App Dashboard → Settings → Basic → Threads App Secret).
- **Redirect URI**: In your Meta app dashboard (Products → Threads → Settings), add `collaragent://auth/threads/callback` as a valid redirect URI.
- **Permissions**: At minimum `threads_basic`. Add `threads_content_publish` for posting. These must pass App Review for production.
- **CSRF State**: Generate a random string per session to validate the callback and prevent CSRF attacks.

---

### Architecture Overview

```
Renderer (React UI)
  │
  │  IPC: 'threads:start-oauth'
  ▼
Main Process (src/main/)
  ├── Generates CSRF state, builds auth URL
  ├── Opens URL via shell.openExternal() → System Browser
  ├── Listens for deep link: app.on('open-url', ...)
  ├── Validates CSRF state
  ├── Exchanges code → short-lived token  (POST, server-side)
  ├── Exchanges short-lived → long-lived token (GET, server-side)
  ├── Stores tokens via SecureStorage (safeStorage encrypted)
  │
  │  IPC: 'threads:oauth-result'  { success, userId, error? }
  ▼
Renderer (React UI)
  └── Updates connected state / shows error
```

All token exchange happens in the **main process** — the App Secret never touches the renderer.

---

### Step 1: Register the Custom Protocol

In `src/main/index.ts`, register `collaragent` as a deep-link protocol **before** `app.whenReady()`:

```ts
// src/main/index.ts  (add near the top, before app.whenReady)
import { app, shell, ipcMain } from 'electron'

// Register custom protocol for OAuth deep links
if (process.defaultApp) {
  // Dev: pass the app path as an argument
  app.setAsDefaultProtocolClient('collaragent', process.execPath, [process.argv[1]])
} else {
  app.setAsDefaultProtocolClient('collaragent')
}
```

> **macOS note**: On macOS, `open-url` fires on the existing process. On Windows, a second instance is launched — you must handle `second-instance` too (see Step 4b).

---

### Step 2: Add IPC Channel Constants

Following the existing pattern in `src/shared/ipc/`, create a new channels file:

```ts
// src/shared/ipc/threads/channels.ts
export const THREADS_START_OAUTH   = 'threads:start-oauth'
export const THREADS_OAUTH_RESULT  = 'threads:oauth-result'
export const THREADS_GET_STATUS    = 'threads:get-status'
export const THREADS_DISCONNECT    = 'threads:disconnect'
```

And the corresponding types:

```ts
// src/shared/ipc/threads/types.ts
export interface ThreadsOAuthResultPayload {
  success: boolean
  userId?: string
  error?: string
}

export interface ThreadsStatusPayload {
  connected: boolean
  userId?: string
}
```

---

### Step 3: Implement the OAuth Handler in Main

Create a dedicated handler file, mirroring the pattern of `src/main/handlers/config.ts`:

```ts
// src/main/handlers/threads.ts
import { ipcMain, shell, app, BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import { SecureStorage } from '../config/SecureStorage'
import * as Channels from '../../shared/ipc/threads/channels'
import type { ThreadsOAuthResultPayload, ThreadsStatusPayload } from '../../shared/ipc/threads/types'

const THREADS_APP_ID     = process.env.THREADS_APP_ID     || 'YOUR_APP_ID'
const THREADS_APP_SECRET = process.env.THREADS_APP_SECRET || 'YOUR_APP_SECRET'
const REDIRECT_URI       = 'collaragent://auth/threads/callback'
const SCOPES             = 'threads_basic,threads_content_publish'

// In-memory CSRF state (valid for the lifetime of one auth attempt)
let pendingCsrfState: string | null = null

export function registerThreadsOAuthHandlers(
  secureStorage: SecureStorage,
  getMainWindow: () => BrowserWindow | null
) {

  // ── Renderer requests OAuth start ──────────────────────────────────────────
  ipcMain.handle(Channels.THREADS_START_OAUTH, async () => {
    pendingCsrfState = randomBytes(16).toString('hex')

    const authUrl = new URL('https://threads.net/oauth/authorize')
    authUrl.searchParams.set('client_id',      THREADS_APP_ID)
    authUrl.searchParams.set('redirect_uri',   REDIRECT_URI)
    authUrl.searchParams.set('scope',          SCOPES)
    authUrl.searchParams.set('response_type',  'code')
    authUrl.searchParams.set('state',          pendingCsrfState)

    // Open in the user's real browser — NOT an Electron BrowserWindow
    await shell.openExternal(authUrl.toString())
    return { started: true }
  })

  // ── Check connection status ─────────────────────────────────────────────────
  ipcMain.handle(Channels.THREADS_GET_STATUS, (): ThreadsStatusPayload => {
    const userId = secureStorage.getApiKey('threads_user_id')
    const token  = secureStorage.getApiKey('threads_access_token')
    return { connected: !!(userId && token), userId }
  })

  // ── Disconnect / revoke ─────────────────────────────────────────────────────
  ipcMain.handle(Channels.THREADS_DISCONNECT, () => {
    secureStorage.deleteKey('threads_access_token')
    secureStorage.deleteKey('threads_user_id')
    secureStorage.deleteKey('threads_token_expiry')
    return { success: true }
  })

  // ── Handle deep-link callback (macOS / Linux) ───────────────────────────────
  // Register this listener once; it fires when the OS redirects back to the app.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    void handleOAuthCallback(url, secureStorage, getMainWindow)
  })

  // ── Handle deep-link callback (Windows — second instance) ──────────────────
  app.on('second-instance', (_event, argv) => {
    const deepLink = argv.find(arg => arg.startsWith('collaragent://'))
    if (deepLink) {
      void handleOAuthCallback(deepLink, secureStorage, getMainWindow)
    }
    // Also bring the main window to focus
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// ── Core OAuth callback handler ─────────────────────────────────────────────
async function handleOAuthCallback(
  url: string,
  secureStorage: SecureStorage,
  getMainWindow: () => BrowserWindow | null
) {
  const win = getMainWindow()

  try {
    const parsed = new URL(url)

    // Validate CSRF state
    const returnedState = parsed.searchParams.get('state')
    if (!pendingCsrfState || returnedState !== pendingCsrfState) {
      throw new Error('Invalid OAuth state — possible CSRF attack.')
    }
    pendingCsrfState = null  // Consume the state

    // Check for user denial
    const error = parsed.searchParams.get('error')
    if (error) {
      throw new Error(`Authorization denied: ${error}`)
    }

    // Strip trailing '#_' that Threads sometimes appends
    let code = parsed.searchParams.get('code') || ''
    code = code.replace(/#_$/, '')
    if (!code) throw new Error('No authorization code received.')

    // Step 2: Exchange code → short-lived token
    const shortLivedToken = await exchangeCodeForToken(code)

    // Step 3: Exchange short-lived → long-lived token
    const { accessToken, expiresIn, userId } = await exchangeForLongLivedToken(
      shortLivedToken.access_token,
      shortLivedToken.user_id
    )

    // Store securely using existing SecureStorage (safeStorage encrypted)
    secureStorage.setApiKey('threads_access_token', accessToken)
    secureStorage.setApiKey('threads_user_id',      String(userId))
    secureStorage.setApiKey('threads_token_expiry', String(Date.now() + expiresIn * 1000))

    const result: ThreadsOAuthResultPayload = { success: true, userId: String(userId) }
    win?.webContents.send(Channels.THREADS_OAUTH_RESULT, result)

  } catch (err: any) {
    console.error('[Threads OAuth] Error:', err)
    const result: ThreadsOAuthResultPayload = { success: false, error: err.message }
    win?.webContents.send(Channels.THREADS_OAUTH_RESULT, result)
  }
}

// ── Step 2: Code → Short-Lived Token ───────────────────────────────────────
async function exchangeCodeForToken(code: string) {
  const body = new URLSearchParams({
    client_id:     THREADS_APP_ID,
    client_secret: THREADS_APP_SECRET,
    grant_type:    'authorization_code',
    redirect_uri:  REDIRECT_URI,
    code
  })

  const res  = await fetch('https://graph.threads.net/oauth/access_token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  const data = await res.json() as any
  if (!res.ok || data.error) throw new Error(data.error_message || 'Token exchange failed')

  // Returns: { access_token: string, user_id: number }
  return data as { access_token: string; user_id: number }
}

// ── Step 3: Short-Lived → Long-Lived Token ─────────────────────────────────
async function exchangeForLongLivedToken(shortLivedToken: string, userId: number) {
  const url = new URL('https://graph.threads.net/access_token')
  url.searchParams.set('grant_type',    'th_exchange_token')
  url.searchParams.set('client_secret', THREADS_APP_SECRET)
  url.searchParams.set('access_token',  shortLivedToken)

  const res  = await fetch(url.toString())
  const data = await res.json() as any
  if (!res.ok || data.error) throw new Error(data.error_message || 'Long-lived token exchange failed')

  // Returns: { access_token: string, token_type: 'bearer', expires_in: number (~5183944 = 60 days) }
  return {
    accessToken: data.access_token as string,
    expiresIn:   data.expires_in   as number,
    userId
  }
}
```

---

### Step 4: Register the Handler in `index.ts`

Wire it up alongside the other handlers in `src/main/index.ts`:

```ts
// src/main/index.ts
import { registerThreadsOAuthHandlers } from './handlers/threads'

app.whenReady().then(async () => {
  // ... existing setup ...
  const secureStorage = new SecureStorage()

  // Keep a reference to the main window for IPC push events
  let mainWindowRef: BrowserWindow | null = null
  const getMainWindow = () => mainWindowRef

  // ... createWindow() call, store reference ...
  mainWindowRef = mainWindow

  registerThreadsOAuthHandlers(secureStorage, getMainWindow)
  // ... rest of existing handlers ...
})
```

> **Note**: On **Windows**, also call `app.requestSingleInstanceLock()` before `app.whenReady()` to ensure only one instance handles the deep link.

---

### Step 5: Token Refresh (Step 4 of OAuth Flow)

Long-lived tokens expire after **60 days** and must be refreshed before expiry. Add a refresh helper (call this on app startup or before making API calls):

```ts
// src/main/handlers/threads.ts  (add to the file)
export async function refreshThreadsTokenIfNeeded(secureStorage: SecureStorage): Promise<void> {
  const token  = secureStorage.getApiKey('threads_access_token')
  const expiry = secureStorage.getApiKey('threads_token_expiry')

  if (!token || !expiry) return

  const expiryMs    = parseInt(expiry, 10)
  const nowMs       = Date.now()
  const oneDayMs    = 24 * 60 * 60 * 1000
  const thirtyDayMs = 30 * 24 * 60 * 60 * 1000

  // Refresh if within 30 days of expiry (and at least 24h old — API requirement)
  const isExpiringSoon = expiryMs - nowMs < thirtyDayMs
  const isOldEnough    = nowMs > (expiryMs - 60 * 24 * 60 * 60 * 1000) + oneDayMs

  if (!isExpiringSoon || !isOldEnough) return

  const url = new URL('https://graph.threads.net/refresh_access_token')
  url.searchParams.set('grant_type',   'th_refresh_token')
  url.searchParams.set('access_token', token)

  const res  = await fetch(url.toString())
  const data = await res.json() as any
  if (!res.ok || data.error) {
    console.warn('[Threads] Token refresh failed:', data.error_message)
    return
  }

  secureStorage.setApiKey('threads_access_token', data.access_token)
  secureStorage.setApiKey('threads_token_expiry', String(Date.now() + data.expires_in * 1000))
  console.log('[Threads] Token refreshed successfully.')
}
```

---

### Step 6: Using Tokens in `ThreadsTools.ts`

The existing `ThreadsTools.ts` already reads from `SecureStorage` via `config.configurable`. After OAuth completes, the stored token is passed through the agent config:

```ts
// src/deepagents/tools/ThreadsTools.ts  (existing pattern — no changes needed)
function getThreadsConfig(config: any) {
  const context = config.configurable as ThreadsToolConfig | undefined
  const userId      = context?.threadsUserId      || process.env.THREADS_USER_ID
  const accessToken = context?.threadsAccessToken || process.env.THREADS_ACCESS_TOKEN
  // ...
}
```

When building the agent in `AgentFactory`, inject the stored credentials from `SecureStorage` into the configurable context:

```ts
// src/main/agents/factory.ts  (example injection)
const threadsConfig = {
  threadsUserId:      secureStorage.getApiKey('threads_user_id'),
  threadsAccessToken: secureStorage.getApiKey('threads_access_token'),
}
// Pass as part of configurable when invoking the agent graph
```

---

### Step 7: Renderer UI (React)

In your React component (e.g., a settings/tools panel), create a dedicated connect button component. This should be placed **inside the Threads Middleware section** in `Settings.tsx`, visible only when the middleware is enabled.

#### A. Create the Connect Button Component

```tsx
// src/renderer/components/Settings/ThreadsConnectButton.tsx
import { useEffect, useState } from 'react'

export function ThreadsConnectButton() {
  const [connected, setConnected] = useState(false)
  const [loading,   setLoading]   = useState(false)

  useEffect(() => {
    // Check initial status
    window.electron.ipcRenderer.invoke('threads:get-status').then((status: any) => {
      setConnected(status.connected)
    })

    // Listen for OAuth result pushed from main process
    const cleanup = window.electron.ipcRenderer.on('threads:oauth-result', (_e: any, result: any) => {
      setLoading(false)
      setConnected(result.success)
      if (!result.success) alert(`Threads connection failed: ${result.error}`)
    })

    return cleanup
  }, [])

  const handleConnect = async () => {
    setLoading(true)
    await window.electron.ipcRenderer.invoke('threads:start-oauth')
    // Result arrives asynchronously via 'threads:oauth-result' push event
  }

  const handleDisconnect = async () => {
    await window.electron.ipcRenderer.invoke('threads:disconnect')
    setConnected(false)
  }

  if (connected) {
    return (
      <div className="mt-4 pt-4 border-t border-surface-100 flex items-center justify-between">
        <span className="text-sm text-green-600 font-medium">✓ Account Connected</span>
        <button 
          onClick={handleDisconnect}
          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
        >
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-surface-100">
      <button 
        onClick={handleConnect} 
        disabled={loading}
        className="w-full px-4 py-2 text-sm font-medium text-white bg-black hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Waiting for browser...' : 'Connect Threads Account'}
      </button>
    </div>
  )
}
```

#### B. Integrate into Settings.tsx

Add the button below the toggle in your main Settings component check:

```tsx
{/* Threads Toggle Section */}
<div className="...">
  {/* ... Header and Toggle Switch ... */}
  
  {/* Show connection controls only if middleware is enabled */}
  {config.middleware.threads?.enabled && (
    <ThreadsConnectButton />
  )}
</div>
```

---

### Token Storage Keys (SecureStorage)

| Key                     | Value                              |
|-------------------------|------------------------------------|
| `threads_access_token`  | Long-lived OAuth token (60 days)   |
| `threads_user_id`       | Threads user ID (numeric string)   |
| `threads_token_expiry`  | Unix timestamp (ms) of expiry      |

All stored via `SecureStorage.setApiKey()` → encrypted with Electron's `safeStorage` (OS keychain-backed on macOS).

---

### Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Deep link doesn't open app | Protocol not registered | Ensure `setAsDefaultProtocolClient` runs before `app.whenReady()` |
| `open-url` never fires (macOS dev) | App not packaged | In dev, test with `open "collaragent://auth/threads/callback?code=TEST&state=TEST"` in Terminal |
| `OAuthException` on token exchange | Code already used or expired | Codes are single-use and expire in 1 hour; restart the flow |
| Mismatched `redirect_uri` | URI in Meta dashboard doesn't match | Ensure `collaragent://auth/threads/callback` is added exactly in Meta app settings |
| Token refresh fails | Token < 24h old | Wait at least 24h after issuance before refreshing |
| `safeStorage` unavailable | Running in a context without OS keychain | Check `secureStorage.isAvailable()` before storing; fall back to env vars in dev |

---

### Security Checklist

- ✅ App Secret lives **only** in the main process (env var or config file), never in renderer
- ✅ CSRF `state` is generated fresh per auth attempt and consumed on callback
- ✅ Tokens are encrypted at rest via `safeStorage` (OS keychain on macOS)
- ✅ Auth URL opened in system browser, not an embedded webview
- ✅ Token exchange done over HTTPS in main process fetch calls
- ✅ Expired/invalid tokens trigger re-authorization, not silent failures