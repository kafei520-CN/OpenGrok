import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toolRowLabel } from './toolLabel';

describe('tool row labels', () => {
  it('keeps a tool name when the title is only a search pattern', () => {
    assert.equal(
      toolRowLabel({ kind: 'search', title: '0\\.2\\.98' }, 'zh-CN'),
      '搜索 · 0\\.2\\.98',
    );
    assert.equal(
      toolRowLabel(
        { kind: 'search', title: 'grok-build-idea|archiveFileName|buildPlugin' },
        'zh-CN',
      ),
      '搜索 · grok-build-idea|archiveFileName|buildPlugin',
    );
  });

  it('labels a read by the file name', () => {
    assert.equal(
      toolRowLabel({ kind: 'read', title: 'Read `plugin.xml`', detail: 'idea/src/plugin.xml' }, 'zh-CN'),
      '阅读 · plugin.xml',
    );
  });

  it('still names a tool when the kind is missing or capitalized', () => {
    assert.equal(toolRowLabel({ kind: 'Search', title: 'version' }, 'en'), 'Search · version');
    assert.equal(toolRowLabel({ title: 'Skill: wrap-up' }, 'zh-CN'), '技能 · wrap-up');
    assert.equal(toolRowLabel({ kind: 'other', title: 'imagine: banner' }, 'zh-CN'), '图像 · banner');
  });

  it('keeps terminal and compact rows to the tool name', () => {
    assert.equal(toolRowLabel({ kind: 'execute', title: 'npm test' }, 'zh-CN'), '终端');
    assert.equal(toolRowLabel({ kind: 'compact', title: 'Compacting' }, 'en'), 'Compact');
  });
});
