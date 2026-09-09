# React Native app integration guide

Complete setup for `@company/react-native-ai-assistant` in a React Native app — including **when Metro changes are required** and how to avoid common errors.

---

## Quick answer: do you need Metro changes?

| Install method | Metro changes required? |
|----------------|-------------------------|
| **`file:` path outside project root** (e.g. `file:../../../react-native-ai-assistant`) | **Yes** — `watchFolders` + React dedup (see [§4](#4-metro-configuration)) |
| **npm registry / `node_modules` inside project** | **Usually minimal** — enable package exports + transpile SDK (see [§4b](#4b-metro-when-installed-from-npm)) |
| **Monorepo** (SDK in same workspace, e.g. `packages/ai-assistant`) | **Yes** — `watchFolders` + React dedup |

If you skip required Metro setup you may see:

- `None of these files exist: …/dist/index.js/dev`
- `Cannot read property 'useEffect' of null`
- Red screen: unable to resolve module

---

## 1. Install the package

### Option A — Published npm (simplest)

```bash
npm install @company/react-native-ai-assistant
npm install @react-native-community/netinfo
```

### Option B — Local development (`file:`)

```json
{
  "dependencies": {
    "@company/react-native-ai-assistant": "file:/absolute/path/to/react-native-ai-assistant"
  }
}
```

```bash
cd /path/to/react-native-ai-assistant && npm run build
cd /path/to/your-app && npm install
```

> The SDK ships **TypeScript source** for React Native (`package.json` → `exports["./dev"].react-native` → `src/dev/index.ts`). Metro compiles it — you do **not** point imports at `dist/` in the app.

---

## 2. App entry — debug overlay

In `App.tsx` (or root layout), **only in `__DEV__`**:

```tsx
import { DevAIAssistant } from '@company/react-native-ai-assistant/dev';

export default function App() {
  return (
    <>
      {/* your app */}
      {__DEV__ ? (
        <DevAIAssistant
          appName="my-app"
          provider="auto"
          gatewayHost="10.1.211.51"
          cloudGatewayUrl="https://ai-gateway.yourcompany.com"
          getAuthHeaders={async () => ({
            Authorization: `Bearer ${sessionToken}`,
          })}
        />
      ) : null}
    </>
  );
}
```

| Prop | Purpose |
|------|---------|
| `appName` | Context sent to the model |
| `provider` | `local` \| `cloud` \| `auto` \| `mock` |
| `gatewayHost` | Mac LAN IP for physical device → local Ollama gateway |
| `cloudGatewayUrl` | HTTPS gateway (MCP/LLM on server) |
| `getAuthHeaders` | Short-lived app JWT — **not** MCP/LLM keys |

---

## 3. Network logs — axios hook

In your axios/interceptor setup:

```js
import { attachAxiosNetworkLogger } from '@company/react-native-ai-assistant/dev';

// After creating axios instance:
if (__DEV__) {
  attachAxiosNetworkLogger(axiosInstance);
}
```

---

## 4. Metro configuration

### 4a. Local `file:` dependency (required)

Use this when the SDK lives **outside** your app folder (e.g. `~/Documents/react-native-ai-assistant` linked into vrnative).

**`metro.config.js`** — merge into your existing config:

```js
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
// If you use Reanimated, keep your wrapper:
const { wrapWithReanimatedMetroConfig } = require('react-native-reanimated/metro-config');

const projectRoot = __dirname;
const appNodeModules = path.resolve(projectRoot, 'node_modules');

// Path to the SDK repo (adjust relative path for your layout)
const aiAssistantPath = path.resolve(
  projectRoot,
  '../../../react-native-ai-assistant' // e.g. vrnative → sibling folder
);

const defaultConfig = getDefaultConfig(projectRoot);
const { assetExts, sourceExts } = defaultConfig.resolver;

const config = {
  // ① Metro must watch the SDK folder (outside project root)
  watchFolders: [aiAssistantPath],

  resolver: {
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
    nodeModulesPaths: [appNodeModules],

    // ② Resolve @company/.../dev via package.json "exports" (src/dev/index.ts)
    unstable_enablePackageExports: true,

    // ③ Force ONE React instance (avoids "useEffect of null")
    disableHierarchicalLookup: true,
    extraNodeModules: {
      react: path.join(appNodeModules, 'react'),
      'react-native': path.join(appNodeModules, 'react-native'),
    },
  },
};

module.exports = mergeConfig(
  defaultConfig,
  wrapWithReanimatedMetroConfig(config) // or: module.exports = mergeConfig(defaultConfig, config);
);
```

#### Why each setting matters

| Setting | Why |
|---------|-----|
| `watchFolders` | SDK is outside the app tree; Metro won't see file changes otherwise |
| `unstable_enablePackageExports` | Resolves `@company/react-native-ai-assistant/dev` → `src/dev/index.ts` |
| `disableHierarchicalLookup` + `extraNodeModules.react` | SDK repo has its own `react` in devDependencies; without this, hooks break |
| **Do NOT** add `extraNodeModules['@company/react-native-ai-assistant']` | Breaks `/dev` → resolves as `dist/index.js/dev` |

#### What you do **not** need

- Custom `resolveRequest` (if `unstable_enablePackageExports` is on)
- Babel aliases for `@company/react-native-ai-assistant/dev`
- Pointing imports at `dist/dev/index.js`

---

### 4b. Metro when installed from npm

When the package is fully inside `node_modules/` (no external `file:` path):

```js
const config = {
  resolver: {
    unstable_enablePackageExports: true,
    // Still recommended if you see duplicate React / hook errors:
    disableHierarchicalLookup: true,
    extraNodeModules: {
      react: path.join(appNodeModules, 'react'),
      'react-native': path.join(appNodeModules, 'react-native'),
    },
  },
};
```

Ensure Metro **transpiles** the SDK (TypeScript + JSX in `node_modules/@company/react-native-ai-assistant/src`).

Add to `metro.config.js` if the SDK is not compiled:

```js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const defaultConfig = getDefaultConfig(projectRoot);

const config = {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};

// Extend transformIgnorePatterns — allow transpiling the SDK package
module.exports = mergeConfig(defaultConfig, {
  ...config,
  transformer: {
    ...defaultConfig.transformer,
    // RN 0.73+ default already handles many packages; add SDK if needed:
  },
});
```

If you get untranspiled syntax errors from the SDK, add to **`babel.config.js`** (not metro):

```js
// Usually NOT needed — SDK is TS compiled by Metro via react-native field.
// Only if your setup ignores node_modules entirely.
```

For most RN 0.73+ apps, `unstable_enablePackageExports: true` is enough when the package is in `node_modules`.

---

## 5. Babel — do not alias the SDK

**Avoid** in `babel.config.js`:

```js
// BAD — breaks @company/react-native-ai-assistant/dev subpath
'@company/react-native-ai-assistant': '/path/to/dist/index.js',
```

If you must alias, only alias the **full** subpath to **source**:

```js
// OK only if Metro exports fail (rare)
'@company/react-native-ai-assistant/dev':
  '/path/to/react-native-ai-assistant/src/dev/index.ts',
```

Prefer Metro `unstable_enablePackageExports` instead of Babel aliases.

---

## 6. iOS — local networking (physical device)

For local Ollama gateway on a real device, allow HTTP to your Mac in `Info.plist`:

```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

Use `gatewayHost` = your Mac's LAN IP (e.g. `10.1.211.51`), not `localhost`.

---

## 7. Run local LLM gateway (optional)

```bash
cd node_modules/@company/react-native-ai-assistant/examples/ollama-gateway
OLLAMA_MODEL=llama3.2:1b npm start
```

Verify: `curl http://127.0.0.1:8787/health` → `{"ok":true,...}`

---

## 8. Restart Metro (always after config changes)

```bash
npx react-native start --reset-cache
```

Then rebuild the app (`run-ios` / `run-android`).

---

## 9. Troubleshooting

### `…/dist/index.js/dev` does not exist

**Cause:** Metro resolved `/dev` as a subpath of `main` instead of `exports["./dev"]`.

**Fix:**
1. Enable `unstable_enablePackageExports: true`
2. Remove `extraNodeModules['@company/react-native-ai-assistant']`
3. Remove Babel alias for `@company/react-native-ai-assistant` (base package only)
4. `npx react-native start --reset-cache`

---

### `Cannot read property 'useEffect' of null`

**Cause:** Two copies of React (app vs SDK `node_modules/react`).

**Fix:**
```js
disableHierarchicalLookup: true,
extraNodeModules: {
  react: path.join(appNodeModules, 'react'),
  'react-native': path.join(appNodeModules, 'react-native'),
},
```

Ensure Metro compiles **`src/dev/index.ts`**, not `dist/dev/index.js`.

---

### Gateway unreachable on device

- Gateway running on Mac? `curl http://127.0.0.1:8787/health`
- Physical device: set `gatewayHost` to Mac LAN IP
- Same Wi‑Fi network
- Firewall allows port `8787`

---

### Overlay works but model answers are wrong

- Small models (`llama3.2:1b`) confuse tool names vs API URLs — use `llama3.2` or cloud gateway
- Clear chat session in overlay after tool/prompt changes

---

## 10. Checklist

- [ ] `npm install @company/react-native-ai-assistant` + `@react-native-community/netinfo`
- [ ] Metro: `watchFolders` (if `file:` outside root)
- [ ] Metro: `unstable_enablePackageExports: true`
- [ ] Metro: `extraNodeModules` for `react` + `react-native`
- [ ] No Babel alias for base `@company/react-native-ai-assistant` package
- [ ] `<DevAIAssistant />` in `App.tsx` (`__DEV__` only)
- [ ] `attachAxiosNetworkLogger(axios)` in interceptor (`__DEV__` only)
- [ ] `npx react-native start --reset-cache`
- [ ] (Optional) Ollama gateway or `cloudGatewayUrl` for `provider="auto"`

---

## 11. Related docs

- [DevIntegration.md](./DevIntegration.md) — overlay & tools API
- [DiagnosticsArchitecture.md](./DiagnosticsArchitecture.md) — local + cloud MCP, player logs
- [examples/ollama-gateway](../examples/ollama-gateway/) — local gateway
- [examples/cloud-gateway](../examples/cloud-gateway/) — cloud MCP gateway sketch
