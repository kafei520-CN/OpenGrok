import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatAxTree } from './browserAx';

function node(over: Record<string, unknown>): Record<string, unknown> {
  return {
    nodeId: '1',
    role: { value: 'generic' },
    name: { value: '' },
    childIds: [],
    ...over,
  };
}

describe('accessibility tree', () => {
  it('nests a search box under the search landmark and says to type', () => {
    const refs = new Map<number, string>();
    let seq = 0;
    const tree = formatAxTree(
      {
        nodes: [
          node({ nodeId: 'root', role: { value: 'RootWebArea' }, name: { value: '哔哩哔哩' }, childIds: ['search', 'main'] }),
          node({ nodeId: 'search', role: { value: 'search' }, name: { value: '搜索' }, childIds: ['box', 'go'] }),
          node({
            nodeId: 'box',
            role: { value: 'textbox' },
            name: { value: '搜索' },
            backendDOMNodeId: 10,
            properties: [{ name: 'focused', value: { value: true } }],
          }),
          node({ nodeId: 'go', role: { value: 'button' }, name: { value: '搜索' }, backendDOMNodeId: 11 }),
          node({ nodeId: 'main', role: { value: 'main' }, childIds: ['video'] }),
          node({
            nodeId: 'video',
            role: { value: 'link' },
            name: { value: '某个视频' },
            backendDOMNodeId: 12,
            properties: [{ name: 'url', value: { value: 'https://www.bilibili.com/video/BV1xx' } }],
          }),
        ],
      },
      (backend) => {
        const hit = refs.get(backend);
        if (hit) {
          return hit;
        }
        seq += 1;
        const ref = `e${seq}`;
        refs.set(backend, ref);
        return ref;
      },
    );
    const text = tree.lines.join('\n');
    assert.match(text, /- search "搜索"/);
    assert.match(text, /textbox "搜索" \[ref=e1\] \[focused\] \[hint="输入后按 Enter 提交"\]/);
    assert.match(text, /button "搜索" \[ref=e2\] \[hint="提交搜索"\]/);
    assert.match(text, /link "某个视频" \[ref=e3\] \[hint="\/video\/BV1xx"\]/);
    assert.equal(tree.nodes[0]?.backend, 10);
  });

  it('hides the video wall and keeps the header search', () => {
    const links = Array.from({ length: 12 }, (_item, index) =>
      node({
        nodeId: `v${index}`,
        role: { value: 'link' },
        name: { value: `视频${index}` },
        backendDOMNodeId: 100 + index,
      }),
    );
    const tree = formatAxTree(
      {
        nodes: [
          node({
            nodeId: 'root',
            role: { value: 'RootWebArea' },
            childIds: ['box', ...links.map((link) => String(link['nodeId']))],
          }),
          node({ nodeId: 'box', role: { value: 'searchbox' }, name: { value: '搜索' }, backendDOMNodeId: 4 }),
          ...links,
        ],
      },
      (backend) => `b${backend}`,
    );
    const text = tree.lines.join('\n');
    assert.match(text, /searchbox "搜索"/);
    assert.match(text, /还有 4 个内容链接/);
    assert.equal(tree.nodes.filter((item) => item.role === 'link').length, 8);
  });
});
