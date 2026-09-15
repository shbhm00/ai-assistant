# Dev integration (minimal setup)

> **Full Metro & app setup:** see **[RNAppIntegration.md](./RNAppIntegration.md)** — required reading for `file:` local dependencies and troubleshooting.

Drop-in **__DEV__** AI assistant with network diagnostics, tools, and a floating overlay.

## 1. Install

```bash
npm install @company/react-native-ai-assistant
npm install @react-native-community/netinfo
```

Configure Metro per [RNAppIntegration.md §4](./RNAppIntegration.md#4-metro-configuration).

## 2. App root — one component

```tsx
import { DevAIAssistant } from '@company/react-native-ai-assistant/dev';

{__DEV__ ? (
  <DevAIAssistant
    appName="my-app"
    provider="auto"
    gatewayHost="10.1.211.51"
    autoStartMonitoring
  />
) : null}
```

## 3. Axios — one line

```js
import { attachAxiosNetworkLogger } from '@company/react-native-ai-assistant/dev';

if (__DEV__) attachAxiosNetworkLogger(axiosInstance);
```

## 4. Local LLM gateway (optional)

```bash
cd node_modules/@company/react-native-ai-assistant/examples/ollama-gateway
OLLAMA_MODEL=llama3.2:1b npm start
```

## Provider modes

| `provider` | Description |
|------------|-------------|
| `local` | Ollama gateway on Mac/LAN |
| `cloud` | `cloudGatewayUrl` + `getAuthHeaders()` |
| `auto` | Local → cloud → mock (recommended) |
| `mock` | Offline tests |

## See also

- [RNAppIntegration.md](./docs/RNAppIntegration.md) — Metro, babel, iOS, troubleshooting
- [DiagnosticsArchitecture.md](./docs/DiagnosticsArchitecture.md) — player logs, cloud MCP
