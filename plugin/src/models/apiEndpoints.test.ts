import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyStoreToToml,
  deleteModelEndpoint,
  looksLikeClaude,
  messagesBaseUrlMissingVersion,
  normalizeBaseUrl,
  mergeOfficialModels,
  parseApiFile,
  parseApiStore,
  parseModelEndpoints,
  previewRequestUrl,
  repairCustomModelDefaults,
  repairModelEndpointUrls,
  safeModelId,
  serializeApiStore,
  setModelEndpointEnabled,
  toggleModelEndpoint,
  upsertModelEndpoint,
  upsertStoredEndpoint,
  usesClaudeEffort,
  validateBaseUrl,
} from './apiEndpoints';

describe('api endpoints toml', () => {
  it('parses model tables and leaves other config alone', () => {
    const toml = `
[models]
default = "grok-4.5"

[model.gpt-4o]
name = "GPT-4o"
model = "gpt-4o"
base_url = "https://api.openai.com/v1"
api_backend = "chat_completions"
api_key = "sk-test"
`;
    const rows = parseModelEndpoints(toml);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'gpt-4o');
    assert.equal(rows[0]?.baseUrl, 'https://api.openai.com/v1');
    assert.equal(rows[0]?.hasKey, true);
    assert.equal(rows[0]?.enabled, true);
  });

  it('inserts a model table without dropping existing sections', () => {
    const next = upsertModelEndpoint('[models]\ndefault = "grok-4.5"\n', {
      name: 'Local',
      model: 'llama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      backend: 'chat_completions',
      apiKey: 'ollama',
    });
    assert.match(next, /\[models\]/);
    assert.match(next, /\[model\."endpoint-1"\]/);
    assert.match(next, /base_url = "http:\/\/127.0.0.1:11434\/v1"/);
  });

  it('updates and deletes a model table', () => {
    const first = upsertModelEndpoint('', {
      name: 'GPT',
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com/v1',
      backend: 'chat_completions',
      apiKey: 'sk-1',
    });
    const id = parseModelEndpoints(first)[0]?.id;
    const updated = upsertModelEndpoint(first, {
      id,
      name: 'GPT',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
      backend: 'responses',
    });
    assert.match(updated, /gpt-4o-mini/);
    assert.match(updated, /api_key = "sk-1"/);
    const gone = deleteModelEndpoint(updated, id ?? '');
    assert.equal(parseModelEndpoints(gone).length, 0);
  });

  it('keeps a second endpoint instead of overwriting the first', () => {
    const first = upsertModelEndpoint('', {
      name: '通义',
      model: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      backend: 'chat_completions',
    });
    const second = upsertModelEndpoint(first, {
      name: 'DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      backend: 'chat_completions',
    });
    const rows = parseModelEndpoints(second);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.name, '通义');
    assert.equal(rows[1]?.name, 'DeepSeek');
    assert.equal(rows[0]?.id, 'endpoint-1');
    assert.equal(rows[1]?.id, 'endpoint-2');
  });

  it('does not overwrite when two new endpoints share a display name', () => {
    const first = upsertModelEndpoint('', {
      name: '自定义',
      model: 'a',
      baseUrl: 'https://a.example/v1',
      backend: 'chat_completions',
    });
    const second = upsertModelEndpoint(first, {
      name: '自定义',
      model: 'b',
      baseUrl: 'https://b.example/v1',
      backend: 'chat_completions',
    });
    const rows = parseModelEndpoints(second);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.id, 'endpoint-1');
    assert.equal(rows[1]?.id, 'endpoint-2');
    assert.equal(rows[0]?.model, 'a');
    assert.equal(rows[1]?.model, 'b');
  });

  it('ignores a stale id and still appends a new endpoint', () => {
    const first = upsertModelEndpoint('', {
      name: 'One',
      model: 'a',
      baseUrl: 'https://a.example/v1',
      backend: 'chat_completions',
    });
    const second = upsertModelEndpoint(first, {
      id: 'missing-id',
      name: 'Two',
      model: 'b',
      baseUrl: 'https://b.example/v1',
      backend: 'chat_completions',
    });
    const rows = parseModelEndpoints(second);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.name, 'One');
    assert.equal(rows[1]?.name, 'Two');
  });

  it('disables an endpoint so Grok no longer loads the [model] table', () => {
    const saved = upsertModelEndpoint('', {
      name: 'Local',
      model: 'llama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      backend: 'chat_completions',
      apiKey: 'ollama',
    });
    const id = parseModelEndpoints(saved)[0]?.id ?? 'endpoint-1';
    const off = toggleModelEndpoint(saved, id);
    const rows = parseModelEndpoints(off);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.enabled, false);
    assert.match(off, /\[model-disabled\."endpoint-1"\]/);
    assert.doesNotMatch(off, /\[model\."endpoint-1"\]/);
    assert.match(off, /api_key = "ollama"/);
    const on = setModelEndpointEnabled(off, id, true);
    assert.equal(parseModelEndpoints(on)[0]?.enabled, true);
    assert.match(on, /\[model\."endpoint-1"\]/);
    const withPeer = upsertModelEndpoint(off, {
      name: 'Other',
      model: 'other',
      baseUrl: 'https://other.example/v1',
      backend: 'chat_completions',
    });
    const peers = parseModelEndpoints(withPeer);
    assert.equal(peers.length, 2);
    assert.equal(peers.find((row) => row.id === id)?.enabled, false);
    assert.equal(peers.find((row) => row.id === 'endpoint-2')?.enabled, true);
  });

  it('sanitizes model ids', () => {
    assert.equal(safeModelId('GPT 4o'), 'gpt-4o');
  });

  it('does not inject /v1; the user supplies it', () => {
    assert.equal(normalizeBaseUrl('https://huskyapi.com'), 'https://huskyapi.com');
    assert.equal(
      normalizeBaseUrl('https://huskyapi.com/chat/completions'),
      'https://huskyapi.com',
    );
    assert.equal(
      normalizeBaseUrl('https://huskyapi.com/v1/chat/completions'),
      'https://huskyapi.com/v1',
    );
    assert.equal(normalizeBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1');
    assert.equal(
      normalizeBaseUrl('https://openrouter.ai/api/v1'),
      'https://openrouter.ai/api/v1',
    );
    assert.equal(
      normalizeBaseUrl('https://api.anthropic.com/v1/messages'),
      'https://api.anthropic.com/v1',
    );
    assert.equal(
      normalizeBaseUrl('https://api.openai.com/v1/responses'),
      'https://api.openai.com/v1',
    );
  });

  it('rejects non-http base URLs', () => {
    assert.equal(validateBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
    assert.throws(() => validateBaseUrl('not a url'));
    assert.throws(() => validateBaseUrl('file:///tmp/x'));
  });

  it('strips protocol suffixes in existing toml without adding /v1', () => {
    const next = repairModelEndpointUrls(`
[model.huskyapi-gpt]
name = "HuskyAPI-GPT"
model = "gpt-5.6-terra"
base_url = "https://huskyapi.com"
api_backend = "chat_completions"
api_key = "sk-test"
`);
    assert.match(next, /base_url = "https:\/\/huskyapi.com"/);
    assert.match(next, /api_key = "sk-test"/);
    const stripped = repairModelEndpointUrls(`
[model.full]
name = "Full"
model = "gpt"
base_url = "https://huskyapi.com/v1/chat/completions"
api_backend = "chat_completions"
`);
    assert.match(stripped, /base_url = "https:\/\/huskyapi.com\/v1"/);
  });

  it('writes identity and default reasoning effort for custom models', () => {
    const next = upsertModelEndpoint('', {
      name: 'HuskyAPI-GPT',
      model: 'gpt-5.6-terra',
      baseUrl: 'https://huskyapi.com/v1',
      backend: 'chat_completions',
      apiKey: 'sk-test',
    });
    assert.match(next, /system_prompt_label = "HuskyAPI-GPT"/);
    assert.match(next, /supports_reasoning_effort = true/);
    assert.match(next, /reasoning_effort = "high"/);
    assert.match(next, /reasoning_efforts = \["low", "medium", "high", "xhigh"\]/);
    assert.doesNotMatch(next, /extra_headers/);
  });

  it('writes Anthropic version header and Claude effort levels for messages', () => {
    const next = upsertModelEndpoint('', {
      name: '[Hu]Claude-Opus-5',
      model: 'claude-opus-5',
      baseUrl: 'https://huskyapi.com/v1',
      backend: 'messages',
      apiKey: 'sk-test',
    });
    assert.match(next, /api_backend = "messages"/);
    assert.match(next, /extra_headers = \{ "anthropic-version" = "2023-06-01" \}/);
    assert.match(next, /reasoning_efforts = \["low", "medium", "high", "xhigh", "max"\]/);
    assert.match(next, /reasoning_effort = "high"/);
  });

  it('uses Claude effort levels when the model id contains claude', () => {
    const next = upsertModelEndpoint('', {
      name: '[Hu]Claude-Opus-5',
      model: 'claude-opus-5',
      baseUrl: 'https://huskyapi.com/v1',
      backend: 'chat_completions',
      apiKey: 'sk-test',
    });
    assert.match(next, /reasoning_efforts = \["low", "medium", "high", "xhigh", "max"\]/);
    assert.doesNotMatch(next, /extra_headers/);
    assert.equal(looksLikeClaude({ model: 'claude-opus-5' }), true);
    assert.equal(looksLikeClaude({ name: '[Hu]Claude-Opus-5' }), true);
    assert.equal(looksLikeClaude({ model: 'gpt-5.6-terra' }), false);
    assert.equal(
      usesClaudeEffort({
        name: 'Local',
        model: 'llama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        backend: 'messages',
      }),
      true,
    );
  });

  it('previews the path Grok actually posts', () => {
    assert.equal(
      previewRequestUrl('https://huskyapi.com/v1', 'chat_completions'),
      'https://huskyapi.com/v1/chat/completions',
    );
    assert.equal(
      previewRequestUrl('https://huskyapi.com', 'messages'),
      'https://huskyapi.com/messages',
    );
    assert.equal(
      previewRequestUrl('https://huskyapi.com/v1', 'messages'),
      'https://huskyapi.com/v1/messages',
    );
    assert.equal(messagesBaseUrlMissingVersion('https://huskyapi.com'), true);
    assert.equal(messagesBaseUrlMissingVersion('https://huskyapi.com/v1'), false);
  });

  it('fills missing identity and effort on existing endpoints', () => {
    const next = repairCustomModelDefaults(`
[model.huskyapi-gpt]
name = "HuskyAPI-GPT"
model = "gpt-5.6-terra"
base_url = "https://huskyapi.com/v1"
api_backend = "chat_completions"
api_key = "sk-test"
`);
    assert.match(next, /system_prompt_label = "HuskyAPI-GPT"/);
    assert.match(next, /supports_reasoning_effort = true/);
    assert.match(next, /reasoning_effort = "high"/);
    assert.match(next, /api_key = "sk-test"/);
  });
});

describe('api endpoint store', () => {
  it('writes context_window as an integer for auto-compact', () => {
    const next = upsertStoredEndpoint([], {
      name: 'Local',
      model: 'llama',
      baseUrl: 'http://127.0.0.1:11434/v1',
      backend: 'chat_completions',
      contextWindow: 128_000,
    });
    assert.equal(next.saved.contextWindow, 128_000);
    const toml = applyStoreToToml('', next.rows);
    assert.match(toml, /context_window = 128000/);
  });

  it('keeps every saved endpoint in the plugin list', () => {
    const first = upsertStoredEndpoint([], {
      name: '[La]GPT-5.6-Terra',
      model: 'gpt-5.6-terra',
      baseUrl: 'https://lapidaryapi.com/v1',
      backend: 'chat_completions',
      apiKey: 'sk-1',
    });
    const second = upsertStoredEndpoint(first.rows, {
      name: 'DeepSeek',
      model: 'deepseek-chat',
      baseUrl: 'https://api.deepseek.com/v1',
      backend: 'chat_completions',
      apiKey: 'sk-2',
    });
    assert.equal(second.rows.length, 2);
    assert.equal(second.rows[0]?.name, '[La]GPT-5.6-Terra');
    assert.equal(second.rows[1]?.name, 'DeepSeek');
    assert.equal(second.saved.id, 'endpoint-2');
  });

  it('keeps official models in the store and remembers the off switch', () => {
    const official = mergeOfficialModels(
      [{ id: 'grok-4', name: 'Grok 4', enabled: false }],
      [
        { id: 'grok-4', name: 'Grok 4' },
        { id: 'grok-4.6', name: 'Grok 4.6' },
        { id: 'endpoint-1', name: '[La]Grok' },
      ],
    );
    assert.deepEqual(
      official.map((row) => `${row.id}:${row.enabled}`),
      ['grok-4:false', 'grok-4.6:true'],
    );
    const raw = JSON.stringify({
      version: 2,
      endpoints: [],
      official: [{ id: 'grok-4', name: 'Grok 4', enabled: false }],
    });
    const file = parseApiFile(raw);
    assert.equal(file.official[0]?.enabled, false);
    assert.equal(file.official[0]?.id, 'grok-4');
  });

  it('round-trips the store JSON without dropping rows', () => {
    const saved = upsertStoredEndpoint([], {
      name: 'One',
      model: 'a',
      baseUrl: 'https://a.example/v1',
      backend: 'chat_completions',
    });
    const two = upsertStoredEndpoint(saved.rows, {
      name: 'Two',
      model: 'b',
      baseUrl: 'https://b.example/v1',
      backend: 'chat_completions',
    });
    const raw = serializeApiStore(two.rows);
    const parsed = parseApiStore(raw);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.id, 'endpoint-1');
    assert.equal(parsed[1]?.id, 'endpoint-2');
  });

  it('writes only enabled endpoints into grok config.toml', () => {
    const first = upsertStoredEndpoint([], {
      name: 'On',
      model: 'a',
      baseUrl: 'https://a.example/v1',
      backend: 'chat_completions',
      apiKey: 'sk-a',
    });
    const second = upsertStoredEndpoint(first.rows, {
      name: 'Off',
      model: 'b',
      baseUrl: 'https://b.example/v1',
      backend: 'chat_completions',
      enabled: false,
    });
    const toml = applyStoreToToml('[models]\ndefault = "grok-4.5"\n', second.rows);
    const rows = parseModelEndpoints(toml);
    assert.match(toml, /\[models\]/);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'endpoint-1');
    assert.equal(rows[0]?.name, 'On');
    assert.doesNotMatch(toml, /endpoint-2/);
  });

  it('restores both endpoints if grok config only kept one table', () => {
    const store = upsertStoredEndpoint(
      upsertStoredEndpoint([], {
        name: 'One',
        model: 'a',
        baseUrl: 'https://a.example/v1',
        backend: 'chat_completions',
      }).rows,
      {
        name: 'Two',
        model: 'b',
        baseUrl: 'https://b.example/v1',
        backend: 'chat_completions',
      },
    ).rows;
    const collapsed = `
[models]
default = "grok-4.5"

[model.endpoint-1]
name = "One"
model = "a"
base_url = "https://a.example/v1"
api_backend = "chat_completions"
`;
    const restored = applyStoreToToml(collapsed, store);
    const rows = parseModelEndpoints(restored);
    assert.equal(rows.length, 2);
    assert.equal(rows.map((row) => row.name).sort().join(','), 'One,Two');
  });

  it('drops endpoint tables that are no longer in the plugin store', () => {
    const leftover = `
[models]
default = "grok-4.6"

[model.endpoint-1]
name = "[La]Grok 4.6"
model = "grok-4.6"
base_url = "https://relay.example/v1"
api_backend = "chat_completions"

[model.endpoint-5]
name = "疯狂马斯克"
model = "grok-4.6"
base_url = "https://other.example/v1"
api_backend = "chat_completions"

[model.gpt-4o]
name = "GPT-4o"
model = "gpt-4o"
base_url = "https://api.openai.com/v1"
api_backend = "chat_completions"
`;
    const cleaned = applyStoreToToml(leftover, []);
    const rows = parseModelEndpoints(cleaned);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'gpt-4o');
    assert.doesNotMatch(cleaned, /endpoint-1/);
    assert.doesNotMatch(cleaned, /endpoint-5/);
    assert.match(cleaned, /\[models\]/);
    assert.match(cleaned, /default = "grok-4.6"/);
  });

  it('drops older plugin slug tables that used system_prompt_label', () => {
    const leftover = `
[models]
default = "grok-4.6"

[model.la-gpt-5-6-terra]
name = "[La]GPT-5.6-Terra"
model = "gpt-5.6-terra"
base_url = "https://relay.example/v1"
api_backend = "chat_completions"
system_prompt_label = "[La]GPT-5.6-Terra"

[model.gpt-4o]
name = "GPT-4o"
model = "gpt-4o"
base_url = "https://api.openai.com/v1"
api_backend = "chat_completions"
`;
    const cleaned = applyStoreToToml(leftover, []);
    const rows = parseModelEndpoints(cleaned);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, 'gpt-4o');
    assert.doesNotMatch(cleaned, /la-gpt-5-6-terra/);
    assert.doesNotMatch(cleaned, /\[La\]GPT-5\.6-Terra/);
  });
});
