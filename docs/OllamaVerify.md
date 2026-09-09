# Local open-source LLM verify (Ollama)

Use any open-source model through a local gateway. The mobile app never holds LLM credentials.

## Architecture

```
vrnative (__DEV__)
  HttpGatewayProvider
        ↓
  examples/ollama-gateway :8787
        ↓
  Ollama :11434  (llama3.2, mistral, ...)
```

## Quick start

```bash
# 1) Ollama
brew install ollama
brew services start ollama
ollama pull llama3.2

# 2) Gateway
cd ~/Documents/react-native-ai-assistant/examples/ollama-gateway
npm start

# 3) App
# In vrnative/src/aiAssistant/devAssistant.js
#   AI_ASSISTANT_PROVIDER = 'ollama'   # or 'mock'
# Reload the app; watch Metro for:
#   [AIAssistant][Provider] { "mode": "ollama", ... }
#   [AIAssistant][NetworkLogs] { "provider": "ollama", "content": "..." }
```

## URLs

| Client | baseUrl |
|--------|---------|
| iOS Simulator | `http://localhost:8787` |
| Android Emulator | `http://10.0.2.2:8787` |
| Physical device | `http://<Mac LAN IP>:8787` |

## Fallback

If the gateway/Ollama is down, vrnative automatically falls back to `MockAIProvider` so DevTools keep working.
