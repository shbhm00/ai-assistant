# Ollama Gateway (open-source LLM verify)

Bridges `@company/react-native-ai-assistant` `HttpGatewayProvider` to a local **Ollama** model.

```
vrnative (HttpGatewayProvider)
        ↓
  http://localhost:8787   (this gateway)
        ↓
  Ollama http://127.0.0.1:11434
        ↓
  llama3.2:1b (default) / llama3.2 / mistral / etc.
```

## 1. Install Ollama

```bash
brew install ollama
brew services start ollama
ollama pull llama3.2:1b
```

## 2. Start this gateway

```bash
cd ~/Documents/react-native-ai-assistant/examples/ollama-gateway
npm start
# default model: llama3.2:1b
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

## 3. Point vrnative at the gateway

In `vrnative/src/aiAssistant/devAssistant.js`:

- `AI_ASSISTANT_PROVIDER_DEFAULT = 'ollama'` (already set)
- Falls back to mock if gateway/Ollama is down

| Runtime | Gateway base URL |
|---------|------------------|
| iOS Simulator | `http://localhost:8787` |
| Android Emulator | `http://10.0.2.2:8787` |
| Physical device | `http://<your-mac-lan-ip>:8787` |

Reload the app and watch Metro for:

```text
[AIAssistant][Provider] { "mode": "ollama", ... }
[AIAssistant][NetworkLogs] { "provider": "ollama", "content": "..." }
```

## Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Ollama reachability + model list |
| POST | `/v1/generate` | Non-streaming JSON (SDK contract) |
| POST | `/v1/stream` | NDJSON: `token` / `tool_call` / `done` / `error` |

No LLM API keys are stored in the mobile app.
