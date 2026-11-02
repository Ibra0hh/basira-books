import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildBookSections} from '../docs/book-pages.js';

const data = JSON.parse(await readFile(new URL('../content/books.json', import.meta.url), 'utf8'));

test('all chapters appear once in the TOC and retain reading order and stable IDs', () => {
  const input = JSON.stringify(data);
  const sections = buildBookSections(data, data.books[0]);
  const chapters = data.books[0].chapters;
  assert.equal(sections[0].kind, 'cover');
  assert.equal(sections.at(-1).kind, 'back-cover');
  assert.equal(new Set(sections.map(item => item.id)).size, sections.length);
  assert.deepEqual(sections.filter(item => item.kind === 'chapter-title').map(item => item.chapterId), chapters.map(item => item.id));
  assert.deepEqual(sections.flatMap(item => item.blocks).filter(item => item.type === 'toc-entry').map(item => item.chapterId), chapters.map(item => item.id));
  assert.equal(sections.filter(item => item.kind === 'toc').length, 5);
  assert.equal(JSON.stringify(data), input, 'builder must not mutate the manuscript');
  assert.deepEqual(buildBookSections(data, data.books[0]), sections, 'stable output for repagination');
});

test('public reading sections exclude preparatory questions and identify outlines honestly', () => {
  const sections = buildBookSections(data, data.books[0]);
  const output = JSON.stringify(sections);
  for (const chapter of data.books[0].chapters) {
    for (const prompt of chapter.prompts) assert.ok(!output.includes(prompt));
    const body = sections.find(item => item.id === `${chapter.id}-content`);
    assert.equal(body.hasManuscript, false);
    assert.equal(body.title, 'خطة الفصل');
    assert.equal(body.statusLabel, 'مخطط فصل · النص قيد الكتابة');
    assert.deepEqual(body.blocks.filter(item => !item.isNote).map(item => item.text), chapter.outline);
  }
});

test('a reviewed manuscript replaces outline instructions without altering source prose', () => {
  const fixture = structuredClone(data);
  const chapter = fixture.books[0].chapters[0];
  chapter.status = 'review';
  chapter.paragraphs = ['فقرة أولى محفوظة كما كُتبت.', 'فقرة ثانية <بأحرف> خاصة.'];
  const sections = buildBookSections(fixture, fixture.books[0]);
  const body = sections.find(item => item.id === `${chapter.id}-content`);
  assert.equal(body.hasManuscript, true);
  assert.equal(body.statusLabel, 'مسودة للمراجعة');
  assert.deepEqual(body.blocks.map(item => item.text), chapter.paragraphs);
  assert.equal(body.blocks.some(item => item.isNote), false);
});

test('planned volumes never inherit the first book introduction or invented chapters', () => {
  for (const book of data.books.slice(1)) {
    const sections = buildBookSections(data, book);
    assert.equal(sections.some(item => item.kind === 'chapter-title' || item.kind === 'toc'), false);
    assert.ok(!JSON.stringify(sections).includes(data.introduction.paragraphs[1]));
    assert.equal(sections[0].statusLabel, 'قيد التخطيط');
  }
});
