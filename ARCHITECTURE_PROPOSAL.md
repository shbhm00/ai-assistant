# Architecture Proposal: `@company/react-native-ai-assistant`

**Status:** Awaiting approval before implementation  
**Location:** `~/Documents/react-native-ai-assistant`  
**Package type:** Standalone TypeScript package (independent repository)

---

## Decision: Repository Shape

| Option | Verdict |
|--------|---------|
| Monorepo package | No existing monorepo to attach to |
| Embed in an app | Couples SDK to product domain — rejected |
| **Standalone package** | **Selected** — publishable library with own tests, docs, examples |

No existing RN/TS project was found as a host. This will be a greenfield standalone package with:
- TypeScript
- Vitest (fast, ESM-friendly, excellent TS DX)
- tsup/tsc for dual CJS/ESM build
- Optional React peer dependency (core works without React)

---

## A. Architecture Proposal

### Layered design

```
┌─────────────────────────────────────────────────────────────┐
│                 Consuming React Native App                  │
│  (tools, context providers, UI, analytics adapter)          │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│              React Adapter (OPTIONAL)                       │
│  useAIAssistant · useAISession · useAIStreaming · <AIChat/> │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                    AI Assistant Core                        │
│  createAIAssistant · config · lifecycle · orchestration     │
└───┬──────────────┬──────────────┬──────────────┬────────────┘
    │              │              │              │
    ▼              ▼              ▼              ▼
 Session       Context        Tool          Security
 Manager       Registry       Registry      Filter
    │              │              │              │
    └──────────────┴──────────────┴──────────────┘
                             │
                             ▼
                    Resilience Layer
              (timeout · retry · cancel · fallback)
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│              AIProvider (interface only)                    │
│     Mock · OpenAI* · Anthropic* · Gemini* · Custom          │
│     (* shipped as thin adapters OR app-owned)               │
└────────────────────────────┬───────────────────────────────┘
                             │
                             ▼
                 Backend AI Gateway (app-owned)
                             │
                             ▼
                        LLM Provider
```

### Core principles

1. **Provider-agnostic** — core depends only on `AIProvider`
2. **React-optional** — core is plain TypeScript; React is a peer + optional entry
3. **Domain-agnostic** — no business tools, no OTT/playback/subscription concepts
4. **Security-by-default** — sensitive-field filtering before provider/observer/logs
5. **Observability-pluggable** — observer interface, no vendor SDK coupling
6. **Session outside React** — history/tools/cancel live in core, not component state

---

## B. Module Boundaries

| Module | Responsibility | Must NOT |
|--------|----------------|----------|
| `core/` | Orchestration, config merge, public facade | Know LLM vendors, React, analytics vendors |
| `session/` | History, stream/send, cancel, max size | Execute tools directly (delegates) |
| `tools/` | Registry, schema validation, execution loop | Contain business tools |
| `context/` | Provider registry, priority, size limits, merge | Know app domains |
| `providers/` | `AIProvider` interface + `MockAIProvider` | Hardcode OpenAI/Anthropic/Gemini keys |
| `security/` | Field redaction, depth limits | Log secrets |
| `observability/` | Observer types + no-op default | Import Sentry/Firebase/etc. |
| `errors/` | Typed error hierarchy | Leak sensitive payloads |
| `utils/` | retry, timeout, AbortController helpers | Business logic |
| `react/` | Hooks + optional chat UI | Be required by core |
| `examples/` | Sample tools/integrations | Be imported by package runtime |

### Dependency direction (acyclic)

```
react → core → session → tools / context / security / observability / errors / utils
core → providers (interface + mock only)
examples → package public API only
```

---

## C. Public API

### Entry points

```ts
// Main (core, no React required)
export { createAIAssistant } from './core/AIAssistant';
export type { AIAssistant, AIAssistantConfig } from './core/types';

export type { AIProvider, AIRequest, AIResponse, StreamCallbacks } from './providers/AIProvider';
export { MockAIProvider } from './providers/MockAIProvider';

export type { ToolDefinition, ToolRegistry } from './tools/types';
export type { ContextProviderDefinition } from './context/types';
export type { AIAssistantObserver } from './observability/Observer';
export type { AISession, SessionOptions, StreamHandle } from './session/types';

export {
  AIAssistantError,
  ProviderError,
  ToolExecutionError,
  ToolValidationError,
  ContextProviderError,
  TimeoutError,
  CancellationError,
  SecurityError,
  ConfigurationError,
} from './errors/errors';

// Optional React entry: @company/react-native-ai-assistant/react
export { useAIAssistant, useAISession, useAIStreaming, AIChat } from './react';
```

### Factory & lifecycle

```ts
const assistant = createAIAssistant({
  provider: myProvider,           // required
  fallbackProvider?: AIProvider,  // optional
  environment?: 'development' | 'staging' | 'production',
  timeoutMs?: number,             // default 30_000
  retry?: {
    maxRetries?: number;          // default 2
    backoff?: 'exponential' | 'linear' | 'none';
    initialDelayMs?: number;
    maxDelayMs?: number;
  },
  security?: {
    blockedFields?: string[];
    customRedactor?: (value: unknown, path: string) => unknown;
  },
  session?: {
    maxHistoryMessages?: number;  // default 50
  },
  context?: {
    maxTotalBytes?: number;       // default ~32KB serialized
  },
  observer?: AIAssistantObserver,
  logger?: AILogger,              // debug logs; never logs secrets
});

assistant.registerTool(tool);
assistant.unregisterTool(name);
assistant.registerContextProvider(provider);
assistant.setContextProviderEnabled(name, enabled);
assistant.createSession(options?): AISession;
assistant.getConfig(): Readonly<ResolvedConfig>;
assistant.dispose(): void;
```

### Session API

```ts
const session = assistant.createSession({ id?: string });

await session.sendMessage(content: string, options?): Promise<AIResponse>;

const handle = session.streamMessage(content: string, {
  onToken: (token: string) => void,
  onToolCall?: (call: ToolCall) => void,
  onToolResult?: (result: ToolResult) => void,
  onComplete: (response: AIResponse) => void,
  onError: (error: AIAssistantError) => void,
}): StreamHandle;

handle.cancel();
handle.promise; // settles on complete/error/cancel

session.getHistory(): Message[];
session.clear(): void;
session.getId(): string;
```

### Provider interface

```ts
interface AIProvider {
  readonly name: string;
  generateResponse(request: AIRequest, signal?: AbortSignal): Promise<AIResponse>;
  streamResponse(
    request: AIRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<void>;
}
```

### Tool definition

```ts
interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema?: JSONSchema;
  execute: (input: TInput, ctx: ToolExecutionContext) => Promise<TOutput> | TOutput;
  timeoutMs?: number;
}
```

### Context provider

```ts
interface ContextProviderDefinition {
  name: string;
  priority?: number;          // higher = earlier merge
  enabled?: boolean;
  maxBytes?: number;
  getContext: () => Record<string, unknown> | Promise<Record<string, unknown>>;
}
```

---

## D. Data Flow

### Non-streaming `sendMessage`

```
User/App
  → session.sendMessage(text)
  → collect enabled context providers (priority order)
  → SensitiveDataFilter.redact(context + history)
  → build AIRequest { messages, tools, context, meta }
  → observer.onRequestStart
  → withTimeout(withRetry(provider.generateResponse))
  → if tool_calls:
       validate → execute → append tool results → loop (bounded)
  → append assistant message to history
  → observer.onRequestComplete
  → return AIResponse
```

### Streaming `streamMessage`

```
Same as above, but:
  → provider.streamResponse(..., AbortSignal)
  → onToken → callback (and optional partial buffer)
  → tool calls may pause stream, execute tools, resume with follow-up request
  → cancel() → AbortSignal.abort → CancellationError
```

---

## E. Tool Execution Flow

```
1. Provider returns tool_calls[] (or MockAIProvider scripted calls)
2. For each call (sequential by default; optional parallel later):
   a. Lookup tool in ToolRegistry → ToolNotFoundError if missing
   b. Validate input against inputSchema → ToolValidationError
   c. observer.onToolStart
   d. Execute with per-tool timeout + AbortSignal
   e. Redact tool result via SensitiveDataFilter
   f. observer.onToolComplete / onToolError
3. Append tool result messages
4. Re-invoke provider with updated messages (maxToolRounds, default 5)
5. Emit final text / stream completion
```

**Invariant:** SDK never ships business tools. Apps register tools at runtime.

---

## F. Security Model

| Layer | Behavior |
|-------|----------|
| Field blocklist | Case-insensitive key match: `password`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `creditCard`, `secret`, `apiKey`, plus app overrides |
| Nested objects/arrays | Recursive redaction; replaced with `[REDACTED]` |
| Logging | Logger receives only redacted payloads |
| Observer | Default: redact prompts/context; opt-in `includeSensitiveTelemetry: false` by default |
| Credentials | Documented: **no LLM API keys in RN client**; use backend gateway |
| Tool outputs | Redacted before re-send to provider |
| Errors | Do not embed raw request bodies containing secrets |

`SecurityError` thrown only for policy violations (e.g. attempting to disable filter when environment forbids it) — not for normal redaction.

---

## G. Testing Strategy

**Runner:** Vitest + `@testing-library/react-native` (hooks only)

| Area | Approach |
|------|----------|
| Unit | ToolRegistry, SensitiveDataFilter, retry/timeout, errors, ContextRegistry |
| Integration | Session + MockAIProvider tool loops, cancel, timeout, retry |
| Provider contract | Shared test suite against `AIProvider` interface via Mock |
| React | Hook tests with mock assistant instance |
| Coverage target | **>80%** on `src/` (exclude `examples/`, docs) |

Meaningful tests only — assert behavior (retry skips non-retryable; cancel aborts mid-stream; redaction deep paths).

---

## H. Example Integration (sketch)

```ts
import { createAIAssistant, MockAIProvider } from '@company/react-native-ai-assistant';

const assistant = createAIAssistant({
  provider: new MockAIProvider({
    responses: ['Network looks healthy; latency is within range.'],
  }),
  environment: 'development',
  observer: {
    onRequestComplete: (e) => console.log('latency', e.latencyMs),
  },
});

assistant.registerContextProvider({
  name: 'application',
  priority: 10,
  getContext: () => ({ appVersion: '1.0.0', platform: 'ios' }),
});

assistant.registerTool({
  name: 'getNetworkInfo',
  description: 'Returns network connectivity and latency',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ networkType: 'wifi', connected: true, latency: 120 }),
});

const session = assistant.createSession({ id: 'debug-1' });
const handle = session.streamMessage('Why am I seeing network errors?', {
  onToken: (t) => process.stdout.write(t),
  onComplete: (r) => console.log('\nDone', r),
  onError: (e) => console.error(e.code, e.message),
});

// handle.cancel();
```

**Examples folder (non-runtime):**
1. Network debugging tool
2. Application state tool
3. API diagnostics tool
4. Feature flags tool
5. Recent logs tool

---

## I. Recommended Folder Structure

```
react-native-ai-assistant/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── tsup.config.ts
├── README.md
├── docs/
│   ├── Architecture.md
│   ├── GettingStarted.md
│   ├── ToolDevelopment.md
│   ├── ContextProviders.md
│   ├── ProviderDevelopment.md
│   ├── Security.md
│   ├── Observability.md
│   ├── Testing.md
│   └── Migration.md
├── examples/
│   ├── network-debugging/
│   ├── application-state/
│   ├── api-diagnostics/
│   ├── feature-flags/
│   └── log-analysis/
├── src/
│   ├── index.ts
│   ├── core/
│   │   ├── AIAssistant.ts
│   │   └── types.ts
│   ├── session/
│   │   ├── AISession.ts
│   │   └── types.ts
│   ├── providers/
│   │   ├── AIProvider.ts
│   │   └── MockAIProvider.ts
│   ├── tools/
│   │   ├── ToolRegistry.ts
│   │   ├── ToolExecutor.ts
│   │   └── types.ts
│   ├── context/
│   │   ├── ContextRegistry.ts
│   │   └── types.ts
│   ├── security/
│   │   └── SensitiveDataFilter.ts
│   ├── observability/
│   │   └── Observer.ts
│   ├── errors/
│   │   └── errors.ts
│   ├── react/
│   │   ├── useAIAssistant.ts
│   │   ├── useAISession.ts
│   │   ├── useAIStreaming.ts
│   │   ├── AIChat.tsx
│   │   └── index.ts
│   └── utils/
│       ├── retry.ts
│       ├── timeout.ts
│       └── cancellation.ts
└── __tests__/  (or co-located *.test.ts)
```

---

## J. Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Tool-call protocol differs per LLM | Normalize in provider adapters to a common `ToolCall` shape; core stays stable |
| Unbounded tool loops | `maxToolRounds` (default 5); hard stop + typed error |
| Context payload too large | Priority + per-provider `maxBytes` + global budget; truncate with notice |
| Streaming + tools complexity | Phase 1: stream text; on tool_call pause → execute → follow-up stream. Document limitation |
| React Native AbortController gaps | Polyfill/document; wrap cancel in `StreamHandle` regardless |
| Shipping real provider SDKs bloats package | Ship **Mock only** in core; document adapter patterns; optional separate packages later |
| Over-redaction breaks useful context | Allow allowlist paths / custom redactor; document tuning |
| Optional UI becomes maintenance burden | Minimal `<AIChat />` for demos; clearly marked optional/unstable |
| Dual package (CJS/ESM) friction | tsup dual build + `exports` map; test both consumers |

### Phased implementation (after approval)

1. **Foundation** — types, errors, security filter, utils (retry/timeout/cancel)
2. **Registries** — tools + context
3. **Provider + Mock** — interface + deterministic mock (incl. tool scenarios)
4. **Session + Assistant** — orchestration, streaming, resilience
5. **Observability** — observer wiring
6. **React layer** — hooks + minimal AIChat
7. **Tests** — drive to >80%
8. **Docs + examples**

---

## Open questions for approval

1. Package name: keep `@company/react-native-ai-assistant` as placeholder, or a real scope?
2. Ship only `MockAIProvider` in v1, or also thin HTTP-gateway provider stub?
3. Vitest confirmed over Jest?
4. Should `<AIChat />` be included in v1 or deferred as “examples-only”?
5. Max tool rounds / history defaults OK (5 / 50)?

**Awaiting your approval to begin Phase 1 implementation.**
`)