import assert from 'node:assert/strict';
import {
  buildPptOutlineDraft,
  formatPptOutlineDraftForPrompt,
  inferPptOutlineDraftSlideType,
  sanitizePptOutlineDraft,
} from '../src/lib/ppt/outline-draft';

const built = buildPptOutlineDraft([
  {
    id: 'source-1',
    title: '资料一',
    shortName: '资料一',
    authors: [],
    year: 2026,
    keywords: [],
    abstract: '这是一段用于生成结构化简报大纲的资料摘要，应该被压缩进页面重点。',
    content: '',
    fileName: 'source.txt',
    fileType: 'txt',
    fileSize: 128,
    uploadTime: '2026-06-18T00:00:00.000Z',
  },
], 12);

assert.equal(built[0].title, '封面与汇报目标');
assert.equal(built.at(-1)?.title, '综合判断与行动建议');
assert.ok(built.some(item => item.sourceLabel === '资料一'), 'draft should include selected source label');

const sanitized = sanitizePptOutlineDraft([
  {
    id: '  first  ',
    title: '  资料背景  ',
    focus: '  使用   用户确认的重点  ',
    sourceLabel: '  来源 A  ',
  },
  null,
  {
    title: '',
    focus: '',
  },
  {
    title: 'x'.repeat(200),
    focus: 'y'.repeat(400),
    sourceLabel: 'z'.repeat(200),
  },
]);

assert.equal(sanitized.length, 2);
assert.deepEqual(sanitized[0], {
  id: 'first',
  title: '资料背景',
  focus: '使用 用户确认的重点',
  sourceLabel: '来源 A',
});
assert.equal(sanitized[1].title.length, 80, 'title should be length-limited');
assert.equal(sanitized[1].focus.length, 220, 'focus should be length-limited');
assert.equal(sanitized[1].sourceLabel.length, 80, 'source label should be length-limited');

const prompt = formatPptOutlineDraftForPrompt(sanitized);
assert.match(prompt, /1\. 资料背景 \| 来源: 来源 A/);
assert.match(prompt, /重点: 使用 用户确认的重点/);
assert.match(prompt, /2\. /);
assert.equal(inferPptOutlineDraftSlideType(sanitized[0], 1, 3), 'background');

console.log(JSON.stringify({
  ok: true,
  checked: 'ppt-v2 outline draft contract sanitizes user-edited page plans and formats a stable backend prompt section',
  sanitizedCount: sanitized.length,
}, null, 2));
