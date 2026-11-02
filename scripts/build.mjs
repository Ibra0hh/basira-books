import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'content', 'books.json');
const allowedBookStatuses = new Set(['planned', 'writing', 'published']);
const allowedChapterStatuses = new Set(['outline', 'draft', 'review', 'published']);
const expectedBooks = ['alkatib', 'alrasul', 'alalim', 'almuhandis'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, path, optional = false) {
  assert(typeof value === 'string', `${path} must be a string.`);
  assert(optional || value.trim().length > 0, `${path} must not be empty.`);
  assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), `${path} contains a control character.`);
}

function identifier(value, path) {
  text(value, path);
  assert(/^[a-z][a-z0-9-]*$/u.test(value), `${path} must be a lowercase stable identifier.`);
}

function textArray(value, path, nonEmpty = false) {
  assert(Array.isArray(value), `${path} must be an array.`);
  assert(!nonEmpty || value.length > 0, `${path} must contain at least one item.`);
  value.forEach((item, index) => text(item, `${path}[${index}]`));
}

function validate(data) {
  assert(data && typeof data === 'object', 'The content file must contain an object.');
  assert(data.series && typeof data.series === 'object', 'series is required.');
  text(data.series.title, 'series.title');
  text(data.series.description, 'series.description');
  if (data.series.author !== null && data.series.author !== undefined) text(data.series.author, 'series.author');
  if (data.series.updatedAt !== undefined) {
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(data.series.updatedAt), 'series.updatedAt must be UTC YYYY-MM-DDTHH:mm:ssZ.');
    assert(Number.isFinite(Date.parse(data.series.updatedAt)), 'series.updatedAt is not a valid date.');
  }
  assert(data.introduction && typeof data.introduction === 'object', 'introduction is required.');
  text(data.introduction.title, 'introduction.title');
  textArray(data.introduction.paragraphs, 'introduction.paragraphs', true);
  assert(Array.isArray(data.books) && data.books.length === 4, 'The series must contain its four books.');
  assert(data.books.map(book => book.id).join(',') === expectedBooks.join(','), 'Book order must be alkatib, alrasul, alalim, almuhandis.');
  const globalChapterIds = new Set();

  data.books.forEach((book, bookIndex) => {
    const base = `books[${bookIndex}]`;
    identifier(book.id, `${base}.id`);
    for (const field of ['title', 'subtitle', 'description']) text(book[field], `${base}.${field}`);
    assert(allowedBookStatuses.has(book.status), `${base}.status is unsupported.`);
    assert(Array.isArray(book.parts), `${base}.parts must be an array.`);
    assert(Array.isArray(book.chapters), `${base}.chapters must be an array.`);
    const partIds = new Set();
    book.parts.forEach((part, index) => {
      identifier(part.id, `${base}.parts[${index}].id`);
      text(part.title, `${base}.parts[${index}].title`);
      assert(!partIds.has(part.id), `${base} has a duplicate part id: ${part.id}.`);
      partIds.add(part.id);
    });
    const partIndexById = new Map(book.parts.map((part, index) => [part.id, index]));
    let previousPartIndex = -1;
    book.chapters.forEach((chapter, index) => {
      const chapterPath = `${base}.chapters[${index}]`;
      identifier(chapter.id, `${chapterPath}.id`);
      const uniqueKey = `${book.id}/${chapter.id}`;
      assert(!globalChapterIds.has(uniqueKey), `Duplicate chapter id: ${uniqueKey}.`);
      globalChapterIds.add(uniqueKey);
      assert(chapter.number === index + 1, `${chapterPath}.number must follow the chapter order.`);
      assert(partIds.has(chapter.partId), `${chapterPath}.partId does not match a part.`);
      const partIndex = partIndexById.get(chapter.partId);
      assert(partIndex >= previousPartIndex, `${chapterPath} is out of part order.`);
      previousPartIndex = partIndex;
      text(chapter.title, `${chapterPath}.title`);
      text(chapter.summary, `${chapterPath}.summary`);
      assert(allowedChapterStatuses.has(chapter.status), `${chapterPath}.status is unsupported.`);
      textArray(chapter.outline, `${chapterPath}.outline`);
      textArray(chapter.prompts, `${chapterPath}.prompts`);
      textArray(chapter.paragraphs, `${chapterPath}.paragraphs`);
      if (chapter.status === 'outline') {
        assert(chapter.paragraphs.length === 0, `${chapterPath}: set status to draft before adding manuscript prose.`);
        assert(chapter.outline.length > 0, `${chapterPath}: an outline needs visible planning content.`);
      } else {
        assert(chapter.paragraphs.length > 0, `${chapterPath}: a written chapter needs manuscript paragraphs.`);
      }
    });
    for (const partId of partIds) {
      assert(book.chapters.some(chapter => chapter.partId === partId), `${base} has an empty part: ${partId}.`);
    }
  });
  const book = data.books[0];
  assert(book.parts.length === 5, 'The initial Alkatib structure must have five parts.');
  assert(book.chapters.length === 20, 'The initial Alkatib structure must have twenty chapters.');
  return data;
}

function checkJavaScript(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory() && !['assets', 'downloads', 'data'].includes(entry.name)) checkJavaScript(fullPath);
    if (entry.isFile() && /\.(?:m?js)$/u.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', fullPath], { encoding: 'utf8' });
      assert(result.status === 0, `JavaScript syntax check failed for ${fullPath}:\n${result.stderr || result.error || ''}`);
    }
  }
}

function runExport() {
  const candidates = process.env.PYTHON
    ? [[process.env.PYTHON, []]]
    : process.platform === 'win32'
      ? [['python', []], ['py', ['-3']], ['python3', []]]
      : [['python3', []], ['python', []]];
  for (const [command, initialArgs] of candidates) {
    const probe = spawnSync(command, [...initialArgs, '--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0 || !/^Python 3\./u.test(`${probe.stdout}${probe.stderr}`.trim())) continue;
    const result = spawnSync(command, [
      ...initialArgs,
      join(root, 'scripts', 'export_book.py'),
      '--source', sourcePath,
      '--output', join(root, 'docs', 'downloads'),
      '--assets', join(root, 'docs', 'assets'),
    ], { encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
    if (result.stdout) process.stdout.write(result.stdout);
    assert(result.status === 0, result.stderr || result.error?.message || 'The book export failed.');
    return;
  }
  throw new Error('Python 3 is required for book exports. Install it or set PYTHON to its executable path.');
}

try {
  const data = validate(JSON.parse(readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/u, '')));
  checkJavaScript(join(root, 'scripts'));
  checkJavaScript(join(root, 'docs'));
  console.log('Content validation passed: 4 books, 5 Alkatib parts, 20 chapters. JavaScript syntax passed.');
  if (!process.argv.includes('--check')) {
    const dataDirectory = join(root, 'docs', 'data');
    mkdirSync(dataDirectory, { recursive: true });
    writeFileSync(join(dataDirectory, 'books.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    runExport();
    console.log('Build complete. Only docs/data/books.json and docs/downloads/alkatib.* were generated.');
  }
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
