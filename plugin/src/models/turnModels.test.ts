import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyStoredTurnModels,
  assistantStamps,
  isCustomModelId,
  isOfficialGrokStamp,
  isOfficialPickerModel,
  isRelayEndpoint,
  overlayApiModels,
} from './turnModels';
import type { ChatMessage } from '../core/types';

describe('turn model stamps', () => {
  it('treats endpoint-* as custom and Grok 4.6 as official', () => {
    assert.equal(isCustomModelId('endpoint-1'), true);
    assert.equal(isCustomModelId('grok-4.6'), false);
    assert.equal(isOfficialGrokStamp({ modelId: 'grok-4.6', modelName: 'Grok 4.6' }), true);
    assert.equal(
      isOfficialGrokStamp({ modelId: 'endpoint-1', modelName: '[La]Grok 4.6' }),
      false,
    );
  });

  it('overlays API manager names onto the catalog', () => {
    const next = overlayApiModels(
      {
        currentId: 'grok-4.6',
        available: [{ id: 'grok-4.6', name: 'Grok 4.6', currentEffort: 'high' }],
      },
      [
        {
          id: 'endpoint-1',
          name: '[La]Grok 4.6',
          model: 'grok-4.6',
          baseUrl: 'https://relay.example/v1',
          backend: 'chat_completions',
          hasKey: true,
          enabled: true,
        },
      ],
    );
    assert.equal(next?.available.some((model) => model.id === 'endpoint-1'), true);
    assert.equal(next?.available.find((model) => model.id === 'endpoint-1')?.name, '[La]Grok 4.6');
  });

  it('does not treat official grok.com models as API-key relays', () => {
    const apis = [
      {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        model: 'grok-4.6',
        baseUrl: 'https://api.x.ai',
        backend: 'chat_completions' as const,
        hasKey: false,
        enabled: true,
        builtin: true,
      },
      {
        id: 'endpoint-1',
        name: '[La]Grok',
        model: 'grok-4',
        baseUrl: 'https://relay.example',
        backend: 'chat_completions' as const,
        hasKey: true,
        enabled: true,
      },
    ];
    assert.equal(isRelayEndpoint('grok-4.6', apis), false);
    assert.equal(isRelayEndpoint('endpoint-1', apis), true);
  });

  it('hides official catalog rows turned off in the API manager', () => {
    assert.equal(isOfficialPickerModel({ id: 'grok-4.6', name: 'Grok 4.6' }), true);
    const next = overlayApiModels(
      {
        currentId: 'grok-4.6',
        available: [
          { id: 'grok-4.6', name: 'Grok 4.6' },
          { id: 'grok-4', name: 'Grok 4' },
        ],
      },
      [
        {
          id: 'grok-4.6',
          name: 'Grok 4.6',
          model: 'grok-4.6',
          baseUrl: 'https://api.x.ai',
          backend: 'chat_completions',
          hasKey: false,
          enabled: false,
          builtin: true,
        },
      ],
    );
    assert.deepEqual(
      next?.available.map((model) => model.id),
      ['grok-4'],
    );
    assert.equal(next?.currentId, 'grok-4');
  });

  it('hides custom catalog rows after the API manager list is empty', () => {
    const next = overlayApiModels(
      {
        currentId: 'endpoint-1',
        available: [
          { id: 'grok-4.6', name: 'Grok 4.6', currentEffort: 'high' },
          { id: 'endpoint-1', name: '[La]Grok 4.6', currentEffort: 'high' },
          { id: 'endpoint-5', name: '疯狂马斯克', currentEffort: 'xhigh' },
          { id: 'la-gpt-5-6-terra', name: '[La]GPT-5.6-Terra', currentEffort: 'high' },
        ],
      },
      [],
    );
    assert.deepEqual(
      next?.available.map((model) => model.id),
      ['grok-4.6'],
    );
    assert.equal(next?.currentId, 'grok-4.6');
  });

  it('replays stored model_name onto restored assistant turns', () => {
    const messages: ChatMessage[] = [
      { id: 'u', role: 'user', text: 'hi', tools: [] },
      { id: 'a', role: 'assistant', text: 'ok', tools: [] },
    ];
    applyStoredTurnModels(messages, [
      { modelId: 'endpoint-1', modelName: '[La]Grok 4.6', effort: 'high' },
    ]);
    assert.equal(messages[1]?.modelId, 'endpoint-1');
    assert.equal(messages[1]?.modelName, '[La]Grok 4.6');
    assert.equal(messages[1]?.effort, 'high');
    assert.deepEqual(assistantStamps(messages), [
      { modelId: 'endpoint-1', modelName: '[La]Grok 4.6', effort: 'high' },
    ]);
  });
});
