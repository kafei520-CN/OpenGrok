import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  escapeHtml,
  fileName,
  renderMarkdown,
  safeUrl,
  splitStreamingMarkdown,
  STREAM_FORCE_COMMIT,
  STREAM_LIVE_KEEP,
  streamingMarkdownPatch,
} from './markdown';

describe('markdown', () => {
  it('escapes HTML then applies inline marks', () => {
    assert.equal(escapeHtml('<b>'), '&lt;b&gt;');
    assert.equal(
      renderMarkdown('**hi** and `x`'),
      '<p><strong>hi</strong> and <code>x</code></p>',
    );
  });

  it('keeps fenced code blocks', () => {
    const html = renderMarkdown('before\n```js\n<a>\n```\nafter');
    assert.match(html, /<pre class="code" data-lang="js"><code>&lt;a&gt;<\/code><\/pre>/);
    assert.match(html, /<p>before<\/p>/);
    assert.match(html, /<p>after<\/p>/);
  });

  it('opens GitHub start:end:path fences and does not swallow later headings', () => {
    const html = renderMarkdown(
      [
        '```java',
        'int x = 1;',
        '```54:68:src/main/java/Foo.java',
        'if (ok) {',
        '  return;',
        '}',
        '```',
        '',
        '### 2. 表没有 `dimension_id`',
      ].join('\n'),
    );
    assert.match(html, /data-lang="java"/);
    assert.match(html, /data-lang="Foo.java"/);
    assert.match(html, /<h3>2. 表没有 <code>dimension_id<\/code><\/h3>/);
    assert.doesNotMatch(html, /### 2\./);
  });

  it('renders headings, lists, quotes, and breaks', () => {
    const html = renderMarkdown(
      ['# Title', '', '- one', '- two', '', '> quoted **x**', '', 'hello', 'world'].join('\n'),
    );
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<blockquote><p>quoted <strong>x<\/strong><\/p><\/blockquote>/);
    assert.match(html, /<p>hello<br \/>world<\/p>/);
  });

  it('renders nested lists and tables', () => {
    const html = renderMarkdown(
      [
        '- a',
        '  - b',
        '- c',
        '',
        '| A | B |',
        '| --- | ---: |',
        '| **1** | 2 |',
      ].join('\n'),
    );
    assert.match(html, /<ul><li>a<ul><li>b<\/li><\/ul><\/li><li>c<\/li><\/ul>/);
    assert.match(html, /<th style="text-align:right">B<\/th>/);
    assert.match(html, /<td style="text-align:left"><strong>1<\/strong><\/td>/);
  });

  it('renders math and chemistry formulas', () => {
    const inline = renderMarkdown('Energy $E=mc^2$ and water $\\ce{H2O}$.');
    assert.match(inline, /katex/);
    assert.doesNotMatch(inline, /\$E=mc\^2\$/);
    const water = renderMarkdown('水：$\\ce{H2O}$');
    assert.match(water, /katex/);
    assert.match(water, />H</);
    assert.doesNotMatch(water, /\$\\ce/);
    const block = renderMarkdown('$$\\ce{2H2 + O2 -> 2H2O}$$');
    assert.match(block, /katex-display|katex/);
    const fence = renderMarkdown('```math\n\\frac{1}{2}\n```');
    assert.match(fence, /katex/);
    assert.doesNotMatch(fence, /<pre class="code"/);
  });

  it('renders links and rejects javascript urls', () => {
    const html = renderMarkdown('see [docs](https://x.ai) and [x](javascript:alert(1))');
    assert.match(html, /<a href="https:\/\/x.ai" rel="noreferrer noopener">docs<\/a>/);
    assert.doesNotMatch(html, /javascript:/);
    assert.match(html, /and x/);
    assert.equal(safeUrl('javascript:alert(1)'), undefined);
    assert.ok(safeUrl('https://x.ai'));
  });

  it('takes the basename of mixed path styles', () => {
    assert.equal(fileName('src\\foo\\bar.ts'), 'bar.ts');
    assert.equal(fileName('/tmp/a.txt'), 'a.txt');
  });

  it('renders a long GFM table and heading instead of leaving pipes', () => {
    const html = renderMarkdown(
      [
        '约定保持：**所有 API 只允许服务端主线程调用**，网络包统一 `enqueueWork`。',
        '',
        '---',
        '',
        '## 建议改动顺序（不改寻路语义）',
        '',
        '| 优先级 | 改什么 | 原理 |',
        '|--------|--------|------|',
        '| 高 | 所有摘 `pending` 的路径都 cancel | 取消的 Future 必须真正停下工人 |',
        '| 中 | 限制 in-flight ≤ 工人数x2 | 无界队列会堆内存 |',
      ].join('\n'),
    );
    assert.match(html, /<hr \/>/);
    assert.match(html, /<h2>建议改动顺序（不改寻路语义）<\/h2>/);
    assert.match(html, /<table>/);
    assert.match(html, /<th style="text-align:left">优先级<\/th>/);
    assert.match(html, /<code>pending<\/code>/);
    assert.match(html, /<code>enqueueWork<\/code>/);
    assert.doesNotMatch(html, /\|--------\|/);
  });

  it('keeps finished blocks committed while a streaming paragraph is still open', () => {
    const split = splitStreamingMarkdown('# Title\n\nhello world');
    assert.equal(split.committed, '# Title\n');
    assert.equal(split.rest, 'hello world');
    const fenced = splitStreamingMarkdown('done\n\n```js\nconst x = 1;');
    assert.equal(fenced.committed, 'done\n');
    assert.match(fenced.rest, /^```js/);
  });

  it('appends new committed markdown instead of replacing the prefix', () => {
    const first = streamingMarkdownPatch('', '# Title\n');
    assert.equal(first.append, '# Title\n');
    const next = streamingMarkdownPatch('# Title\n', '# Title\n\nhello\n');
    assert.equal(next.append, '\nhello\n');
    assert.equal(next.replace, undefined);
    const reset = streamingMarkdownPatch('# Title\n', 'other\n');
    assert.equal(reset.replace, 'other\n');
  });

  it('only resplits the uncommitted suffix when a prefix is already committed', () => {
    const prev = '# Title\n';
    const split = splitStreamingMarkdown(`${prev}\nhello world`, prev);
    assert.equal(split.committed, prev);
    assert.equal(split.rest, 'hello world');
  });

  it('force-commits a giant unfenced paragraph so the live tail stays bounded', () => {
    const body = `${'word '.repeat(STREAM_FORCE_COMMIT / 5)}end`;
    const split = splitStreamingMarkdown(body);
    assert.ok(split.rest.length <= STREAM_LIVE_KEEP + 32);
    assert.ok(split.committed.length > STREAM_FORCE_COMMIT / 2);
    assert.equal(`${split.committed}${split.rest}`, body.replace(/\r\n/g, '\n'));
  });
});
