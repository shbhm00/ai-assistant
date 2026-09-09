# Local + Cloud (MCP) diagnostics architecture

Analyze **network logs**, **player logs**, and any other on-device telemetry through one SDK — with **local LLM** (Ollama) or a **cloud MCP gateway**.

## Mental model

```
┌─────────────────────────────────────────────────────────────┐
│  React Native app (__DEV__)                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ DevAIAssistant overlay                               │   │
│  │  Tools (run ON DEVICE):                              │   │
│  │   • getRecentNetworkLogs / getNetworkLogStats        │   │
│  │   • getRecentPlayerLogs / getPlayerLogStats (yours)  │   │
│  │   • getNetworkInfo + custom tools                    │   │
│  └───────────────────────┬─────────────────────────────┘   │
│                          │ HttpGatewayProvider              │
└──────────────────────────┼──────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           ▼                               ▼
   Local gateway (:8787)          Cloud gateway (HTTPS)
   examples/ollama-gateway        Your BFF + MCP client
   Ollama on Mac                  API key / MCP key HERE
```

**Important:** Tools always run on the device (network buffer, player events). The gateway only runs the **LLM reasoning loop** (and optional server-side MCP tools later). MCP keys never ship in the app.

## Provider modes

| `provider` | Behavior |
|------------|----------|
| `local` | Ollama gateway on Mac/LAN (`gatewayHost`) |
| `cloud` | `cloudGatewayUrl` + `getAuthHeaders()` (session JWT) |
| `auto` | Try local → cloud → mock fallback |
| `mock` | Offline scripted responses (tests) |

## App integration (vrnative example)

### 1. Network logs (already wired)

```js
import { attachAxiosNetworkLogger } from '@company/react-native-ai-assistant/dev';
attachAxiosNetworkLogger(axiosInstance);
```

### 2. Player / playback logs

```js
// playerLogStore.js
import {
  createDiagnosticLogStore,
  registerDiagnosticLogTools,
} from '@company/react-native-ai-assistant/dev';

export const playerLogStore = createDiagnosticLogStore({
  maxEntries: 300,
  defaultCategory: 'player',
});

export function logPlayerEvent(event, data = {}, level = 'info') {
  playerLogStore.push({ event, data, level, category: 'player' });
}

// Hook into your player (react-native-video, Conviva callbacks, etc.):
// logPlayerEvent('buffering_start', { contentId, positionMs });
// logPlayerEvent('playback_error', { code, message }, 'error');
```

Pass tools into `DevAIAssistant`:

```tsx
import { DevAIAssistant } from '@company/react-native-ai-assistant/dev';
import { playerLogStore } from './playerLogStore';
import { createAIAssistant, registerDiagnosticLogTools } from '@company/react-native-ai-assistant/dev';

// Option A: use configureDevAIAssistant + register tools via config.tools
// Option B: registerDiagnosticLogTools on assistant after configure (see below)

{__DEV__ && (
  <DevAIAssistant
    appName="vrnative"
    provider="auto"
    gatewayHost="10.1.211.51"
    cloudGatewayUrl="https://ai-gateway.yourcompany.com"
    getAuthHeaders={async () => ({
      Authorization: `Bearer ${await getAppSessionToken()}`,
    })}
    tools={[
      // registerDiagnosticLogTools registers two tools — inline equivalent:
    ]}
  />
)}
```

Cleaner pattern — register player tools once at startup:

```js
import {
  configureDevAIAssistant,
  getDevAIAssistant,
  registerDiagnosticLogTools,
} from '@company/react-native-ai-assistant/dev';
import { playerLogStore } from './playerLogStore';

configureDevAIAssistant({
  appName: 'vrnative',
  provider: 'auto',
  gatewayHost: '10.1.211.51',
  cloudGatewayUrl: 'https://ai-gateway.yourcompany.com',
  getAuthHeaders: () => ({ Authorization: 'Bearer …' }),
});

const assistant = getDevAIAssistant();
registerDiagnosticLogTools(assistant, playerLogStore, {
  prefix: 'Player',
  description: 'Video player and playback events.',
});
```

Exposes: `getRecentPlayerLogs`, `getPlayerLogStats`.

### 3. Cloud MCP gateway (your server)

The app speaks the **same HTTP contract** as Ollama gateway:

- `GET /health` → `{ ok: true }`
- `POST /v1/generate` / `POST /v1/stream` → SDK JSON format (see `HttpGatewayProvider`)

Your cloud service:

1. Authenticates the app (`getAuthHeaders`)
2. Receives messages + **tool definitions** from the SDK
3. Calls your MCP server (with **your** API key) and/or Claude/GPT
4. Returns tool calls → app executes tools on device → results sent back in the loop

Copy `examples/ollama-gateway/server.js` as a starting point and swap the Ollama client for your MCP client.

## Security checklist

- ✅ Network/player tools: sanitized on device (no tokens, no full bodies)
- ✅ MCP / LLM keys: only on cloud gateway
- ✅ App sends short-lived session JWT via `getAuthHeaders`
- ❌ Never put MCP API keys in `DevAIAssistant` props or `.env` in the app

## Suggested rollout

1. **Phase 1** — Local only (`provider="local"`) + network tools ✅ done  
2. **Phase 2** — Add `playerLogStore` + player hooks in vrnative  
3. **Phase 3** — Deploy cloud gateway with MCP; set `provider="auto"`  
4. **Phase 4** — Optional server-side MCP tools (Conviva API, Datadog) on gateway only  

## Example prompts (overlay)

- "Correlate last playback error with network failures in the last 2 minutes"
- "Which API was slowest during the last buffering event?"
- "Summarize player errors and network 4xx/5xx from this session"
