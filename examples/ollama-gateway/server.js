/**
 * Local AI gateway bridging @company/react-native-ai-assistant HttpGatewayProvider
 * to an open-source LLM via Ollama.
 *
 * Contract:
 *   POST /v1/generate  → JSON response
 *   POST /v1/stream    → NDJSON events (token | tool_call | done | error)
 *   GET  /health       → { ok, ollama, model }
 *
 * Usage:
 *   OLLAMA_HOST=http://127.0.0.1:11434 OLLAMA_MODEL=llama3.2 node server.js
 */

const http = require('http');
const { randomUUID } = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(
  /\/$/,
  ''
);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

const SYSTEM_PROMPT =
  'You are a React Native developer diagnostics assistant.\n' +
  'IMPORTANT distinctions:\n' +
  '- Tools like getRecentNetworkLogs / getNetworkLogStats / getNetworkInfo are LOCAL helpers, NOT app HTTP APIs.\n' +
  '- App API names are the URL paths inside getRecentNetworkLogs results (e.g. /homescreen-service/pub/v3/rail/...).\n' +
  '- When asked for slowest APIs or API names, quote those URL paths and durationMs from tool results.\n' +
  '- Never say a tool name is an API endpoint.\n' +
  'Be concise and actionable. Prefer calling getRecentNetworkLogs when listing specific APIs.';

function mapMessages(messages = [], context) {
  const mapped = [];

  mapped.push({
    role: 'system',
    content:
      SYSTEM_PROMPT +
      (context && Object.keys(context).length > 0
        ? `\n\nApplication context (already redacted):\n${JSON.stringify(context)}`
        : ''),
  });

  for (const message of messages) {
    if (message.role === 'tool' && message.toolResult) {
      const toolContent =
        typeof message.toolResult.content === 'string'
          ? message.toolResult.content
          : JSON.stringify(message.toolResult.content ?? {});
      mapped.push({
        role: 'tool',
        tool_name: message.toolResult.name,
        content: toolContent,
      });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      mapped.push({
        role: 'assistant',
        // Ollama is happier with non-empty content alongside tool_calls.
        content: message.content || ' ',
        tool_calls: message.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            // Ollama expects an OBJECT here (OpenAI uses a JSON string).
            arguments: normalizeArgsObject(tc.arguments),
          },
        })),
      });
      continue;
    }

    if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
      mapped.push({
        role: message.role,
        content: message.content || '',
      });
    }
  }

  return mapped;
}

/**
 * Ollama chat tool_calls.function.arguments must be a plain object.
 * Also coerce schema-shaped junk and unwrap nested { parameters } wrappers
 * that small models often emit.
 */
function normalizeArgsObject(args) {
  let value = args;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value || '{}');
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  // Small models wrap real args: { type:'function', function:'name', parameters:{...} }
  if (
    value.parameters &&
    typeof value.parameters === 'object' &&
    !Array.isArray(value.parameters) &&
    (value.type === 'function' || typeof value.function === 'string')
  ) {
    value = value.parameters;
  }

  // Models sometimes echo the JSON schema as "arguments".
  if (
    value.type === 'object' &&
    Object.prototype.hasOwnProperty.call(value, 'properties')
  ) {
    const keys = Object.keys(value);
    const schemaKeys = new Set([
      'type',
      'properties',
      'required',
      'additionalProperties',
      'description',
    ]);
    if (keys.every(k => schemaKeys.has(k))) {
      return {};
    }
  }
  return value;
}

function mapTools(tools = []) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

function normalizeToolCalls(toolCalls = []) {
  return toolCalls.map(tc => {
    let args = {};
    const raw = tc?.function?.arguments ?? tc?.arguments ?? {};
    if (typeof raw === 'string') {
      try {
        args = JSON.parse(raw || '{}');
      } catch {
        args = {};
      }
    } else if (raw && typeof raw === 'object') {
      args = raw;
    }
    return {
      id: tc.id || `tool_${randomUUID()}`,
      name: tc.function?.name || tc.name,
      arguments: args,
    };
  });
}

/**
 * Smaller models often emit tool intents as JSON text instead of native tool_calls.
 * Recover them so the SDK tool loop still works.
 */
function extractToolCallsFromContent(content = '', availableTools = []) {
  const names = new Set(
    (availableTools || []).map(t => t.function?.name || t.name).filter(Boolean)
  );
  if (!names.size || !content) {
    return [];
  }

  const found = [];
  const seen = new Set();

  const pushIfTool = obj => {
    if (!obj || typeof obj !== 'object') return;
    const name = obj.name || obj.tool || obj.function?.name;
    if (!name || !names.has(name) || seen.has(name)) return;
    const args =
      obj.arguments ||
      obj.parameters ||
      obj.input ||
      obj.function?.arguments ||
      {};
    seen.add(name);
    found.push({
      id: `tool_${randomUUID()}`,
      name,
      arguments: typeof args === 'string' ? safeJson(args) : args,
    });
  };

  // fenced ```json ... ``` blocks
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenceRegex.exec(content))) {
    const parsed = safeJson(match[1]);
    if (Array.isArray(parsed)) {
      parsed.forEach(pushIfTool);
    } else {
      pushIfTool(parsed);
    }
  }

  // bare JSON objects mentioning a known tool name
  if (!found.length) {
    const objectRegex = /\{[\s\S]*?\}/g;
    while ((match = objectRegex.exec(content))) {
      const parsed = safeJson(match[0]);
      pushIfTool(parsed);
    }
  }

  return found;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function resolveToolCalls(nativeCalls, content, tools) {
  const normalized = normalizeToolCalls(nativeCalls || []);
  if (normalized.length) {
    return normalized;
  }
  return extractToolCallsFromContent(content || '', tools);
}

async function callOllamaChat({ messages, tools, stream }) {
  const body = {
    model: OLLAMA_MODEL,
    messages,
    stream: Boolean(stream),
  };
  if (tools?.length) {
    body.tools = tools;
  }

  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      `Ollama error ${response.status}: ${text || response.statusText}`
    );
    error.status = response.status;
    error.retryable = response.status >= 500;
    throw error;
  }

  return response;
}

async function handleGenerate(req, res) {
  try {
    const payload = await readBody(req);
    const messages = mapMessages(payload.messages, payload.context);
    const tools = mapTools(payload.tools);

    const response = await callOllamaChat({
      messages,
      tools,
      stream: false,
    });
    const data = await response.json();
    const content = data.message?.content || '';
    const toolCalls = resolveToolCalls(
      data.message?.tool_calls,
      content,
      tools
    );

    sendJson(res, 200, {
      message: {
        role: 'assistant',
        content: toolCalls.length ? '' : content,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      },
      model: data.model || OLLAMA_MODEL,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        totalTokens:
          (data.prompt_eval_count || 0) + (data.eval_count || 0) || undefined,
      },
    });
  } catch (error) {
    sendJson(res, error.status && error.status < 500 ? error.status : 502, {
      error: {
        message: error.message || 'Gateway generate failed',
        retryable: Boolean(error.retryable),
      },
    });
  }
}

async function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const writeEvent = event => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const payload = await readBody(req);
    const messages = mapMessages(payload.messages, payload.context);
    const tools = mapTools(payload.tools);

    const response = await callOllamaChat({
      messages,
      tools,
      stream: true,
    });

    if (!response.body) {
      writeEvent({
        type: 'error',
        message: 'Ollama returned empty stream body',
        retryable: true,
      });
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk;
        try {
          chunk = JSON.parse(trimmed);
        } catch {
          continue;
        }

        const token = chunk.message?.content || '';
        if (token) {
          content += token;
          writeEvent({ type: 'token', token });
        }

        const calls = normalizeToolCalls(chunk.message?.tool_calls || []);
        for (const call of calls) {
          // Ollama may stream partial tool calls; keep last by id/name.
          const existing = toolCalls.findIndex(
            item => item.id === call.id || item.name === call.name
          );
          if (existing >= 0) {
            toolCalls[existing] = call;
          } else {
            toolCalls.push(call);
            writeEvent({ type: 'tool_call', toolCall: call });
          }
        }

        if (chunk.done) {
          const resolved = resolveToolCalls(toolCalls, content, tools);
          for (const call of resolved) {
            const existing = toolCalls.find(
              item => item.id === call.id || item.name === call.name
            );
            if (!existing) {
              toolCalls.push(call);
              writeEvent({ type: 'tool_call', toolCall: call });
            }
          }

          writeEvent({
            type: 'usage',
            usage: {
              promptTokens: chunk.prompt_eval_count,
              completionTokens: chunk.eval_count,
              totalTokens:
                (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0) ||
                undefined,
            },
          });
          writeEvent({
            type: 'done',
            message: { content: toolCalls.length ? '' : content },
            model: chunk.model || OLLAMA_MODEL,
            finishReason: toolCalls.length ? 'tool_calls' : 'stop',
          });
        }
      }
    }

    res.end();
  } catch (error) {
    writeEvent({
      type: 'error',
      message: error.message || 'Gateway stream failed',
      retryable: Boolean(error.retryable),
    });
    res.end();
  }
}

async function handleHealth(_req, res) {
  try {
    const tags = await fetch(`${OLLAMA_HOST}/api/tags`);
    const ok = tags.ok;
    let models = [];
    if (ok) {
      const data = await tags.json();
      models = (data.models || []).map(m => m.name);
    }
    sendJson(res, ok ? 200 : 503, {
      ok,
      ollama: OLLAMA_HOST,
      model: OLLAMA_MODEL,
      models,
    });
  } catch (error) {
    sendJson(res, 503, {
      ok: false,
      ollama: OLLAMA_HOST,
      model: OLLAMA_MODEL,
      error: error.message,
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    await handleHealth(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/generate') {
    await handleGenerate(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/stream') {
    await handleStream(req, res);
    return;
  }

  sendJson(res, 404, { error: { message: 'Not found', retryable: false } });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ollama-gateway] listening on http://0.0.0.0:${PORT}`);
  console.log(`[ollama-gateway] OLLAMA_HOST=${OLLAMA_HOST}`);
  console.log(`[ollama-gateway] OLLAMA_MODEL=${OLLAMA_MODEL}`);
  console.log(`[ollama-gateway] health: http://127.0.0.1:${PORT}/health`);
});
