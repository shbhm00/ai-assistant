# Cloud gateway (MCP-backed)

Same HTTP contract as `examples/ollama-gateway` — point `DevAIAssistant` at this service with `provider="cloud"`.

## App config

```tsx
<DevAIAssistant
  appName="my-app"
  provider="auto"
  gatewayHost="10.1.211.51"
  cloudGatewayUrl="https://ai-gateway.yourcompany.com"
  getAuthHeaders={async () => ({
    Authorization: `Bearer ${sessionToken}`,
  })}
/>
```

## Server responsibilities

1. `GET /health` — liveness for `auto` / `cloud` provider probe  
2. `POST /v1/generate` + `POST /v1/stream` — SDK gateway contract  
3. Validate app JWT (not MCP key from client)  
4. Call MCP / LLM with **server-stored** credentials  
5. Forward tool calls to the app; app runs device tools and returns results in the next turn  

## Implementation sketch

Start from `../ollama-gateway/server.js`:

- Replace `callOllama()` with your MCP + model client  
- Keep `mapMessages()`, tool loop, and NDJSON streaming  
- Add auth middleware on `/v1/*`  

Env vars (server only):

```bash
MCP_SERVER_URL=https://your-mcp-host
MCP_API_KEY=sk-...
PORT=443
```

## Why not MCP directly from the app?

- MCP keys would be extractable from the APK/IPA  
- MCP protocol is designed for trusted clients (IDE, backend)  
- The SDK already has a stable `HttpGatewayProvider` — one BFF adapter covers all models/MCP hosts  
