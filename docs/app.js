import { createBook } from './vendor/openpageflip/index.js';
import { buildBookSections } from './book-pages.js';
import { paginateSections } from './paginate.js';

const $ = selector => document.querySelector(selector);
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const arabic = value => new Intl.NumberFormat('ar-u-nu-arab').format(value);
const normalize = value => String(value).normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').trim().toLowerCase();
const storage = {
  read(key, fallback) { try { return JSON.parse(localStorage.getItem('basira:' + key)) ?? fallback; } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem('basira:' + key, JSON.stringify(value)); } catch { /* Reading works without storage. */ } }
};
const icons = {
  moon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 14.3A8.7 8.7 0 0 1 9.7 3.6 8.8 8.8 0 1 0 20.4 14.3Z"/></svg>',
  sun:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>'
};
let data, currentBook, book;
let pages = [];
let busy = false;
let rebuilding = false;
let resizeTimer, toastTimer;
let lastDimensions = '';
let fontSize = Math.max(18,Math.min(29,Number(storage.read('fontSize',23)) || 23));
const bookmarks = readMap('flipbook:bookmarks');
const lastRead = readMap('flipbook:lastRead');

function readMap(key) {
  const result = storage.read(key,{});
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}
function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'),2400);
}
function applyTheme(value) {
  const dark = value === 'dark';
  document.body.classList.toggle('dark',dark);
  $('#theme-button').innerHTML = dark ? icons.sun : icons.moon;
  $('#theme-button').setAttribute('aria-label',dark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي');
  document.querySelector('meta[name="theme-color"]').content = dark ? '#172229' : '#e8e4dc';
}
function applyFont() {
  document.documentElement.style.setProperty('--body-size',fontSize + 'px');
  $('#font-increase').disabled = fontSize >= 29 || !book;
  $('#font-decrease').disabled = fontSize <= 18 || !book;
}
function dimensions() {
  const viewportWidth = document.documentElement.clientWidth;
  const single = viewportWidth <= 900;
  const width = single
    ? Math.min(450,viewportWidth - 44)
    : Math.floor(Math.min(640,(Math.min(1560,viewportWidth) - 150) / 2,Math.max(500,window.innerHeight - 265) * .82));
  return {single,width,height:Math.round(width * (single ? 1.48 : 1 / .82))};
}
function currentPosition() {
  const page = pages[book?.page || 0];
  return page ? {sectionId:page.sectionId,offset:page.offset} : {sectionId:'cover',offset:0};
}
function pageForPosition(position) {
  if (!position || typeof position !== 'object') return 0;
  const matches = pages.map((page,index) => ({page,index})).filter(item => item.page.sectionId === position.sectionId);
  if (!matches.length) return 0;
  return (matches.find(item => item.page.offset === position.offset) || matches.at(-1)).index;
}
function chapterPage(chapterId) {
  return pages.findIndex(page => page.chapterId === chapterId && page.kind === 'chapter-title');
}
function routePage(segment) {
  if (!segment || segment === 'intro' || segment === 'cover') return 0;
  if (/^page-\d+$/.test(segment)) return Math.min(pages.length - 1,Math.max(0,Number(segment.slice(5)) - 1));
  if (segment === 'about') return Math.max(0,pages.findIndex(page => page.sectionId === 'intro'));
  return Math.max(0,chapterPage(segment));
}
function renderNav() {
  $('#books-nav').innerHTML = data.books.map(item => '<a class="book-tab' + (item.id === currentBook.id ? ' active' : '') + '" href="#' + item.id + '/intro"' + (item.id === currentBook.id ? ' aria-current="page"' : '') + '>' + escapeHTML(item.title) + '</a>').join('');
  const ordinal = ['الأول','الثاني','الثالث','الرابع'][data.books.findIndex(item => item.id === currentBook.id)];
  $('#current-book-label').textContent = 'الكتاب ' + ordinal + ': ' + currentBook.title;
}
function renderToc() {
  const query = normalize($('#chapter-search').value);
  let matches = 0;
  let html = query ? '' : '<a class="chapter-link" href="#' + currentBook.id + '/intro"><span>الغلاف</span><small>١</small></a><a class="chapter-link" href="#' + currentBook.id + '/about"><span>عن هذه المسودة</span><small>' + arabic(routePage('about') + 1) + '</small></a>';
  for (const part of currentBook.parts) {
    const chapters = currentBook.chapters.filter(chapter => chapter.partId === part.id && (!query || normalize([chapter.title,chapter.summary,part.title,...chapter.outline].join(' ')).includes(query)));
    if (!chapters.length) continue;
    matches += chapters.length;
    html += '<section class="toc-group"><h3>' + escapeHTML(part.title) + '</h3>' + chapters.map(chapter => '<a class="chapter-link" href="#' + currentBook.id + '/' + chapter.id + '"><span>' + escapeHTML(chapter.title) + '</span><small>' + arabic(chapterPage(chapter.id) + 1) + '</small></a>').join('') + '</section>';
  }
  $('#chapter-nav').innerHTML = matches || !query ? html : '<p class="empty-search">لا توجد فصول تطابق بحثك.</p>';
  $('#search-status').textContent = query ? arabic(matches) + ' فصلًا يطابق البحث' : '';
  $('#saved-reading').innerHTML = (bookmarks[currentBook.id] ? '<button data-saved="bookmark">العودة إلى إشارتي</button>' : '') + (lastRead[currentBook.id] ? '<button data-saved="last">متابعة القراءة</button>' : '');
}
function visibleIndexes() {
  const start = book?.page || 0;
  if (!book || book.orientation === 'portrait' || start === 0 || start === pages.length - 1) return [start];
  return [start,Math.min(pages.length - 1,start + 1)];
}
function updateUI(save = true) {
  if (!book) return;
  const index = book.page;
  const visible = visibleIndexes();
  const startNumber = index + 1;
  const endNumber = visible.at(-1) + 1;
  const range = startNumber === endNumber ? arabic(startNumber) : arabic(startNumber) + '–' + arabic(endNumber);
  $('#page-count').textContent = range + ' / ' + arabic(pages.length);
  $('#page-input').value = String(startNumber);
  $('#page-input').max = String(pages.length);
  $('#page-progress').max = String(pages.length);
  $('#page-progress').value = String(startNumber);
  $('#page-progress').setAttribute('aria-valuetext','الصفحة ' + range + ' من ' + arabic(pages.length));
  $('#previous-page').disabled = busy || index === 0;
  $('#next-page').disabled = busy || visible.at(-1) === pages.length - 1;
  $('#open-book').disabled = busy;
  $('#book-stage').classList.toggle('closed',index === 0 && !busy);
  $('#book-stage').classList.toggle('back-closed',index === pages.length - 1 && !busy);
  $('#cover-actions').hidden = index !== 0;
  $('#resume-reading').hidden = !lastRead[currentBook.id];
  const position = currentPosition();
  const saved = bookmarks[currentBook.id];
  const isSaved = saved && visible.some(i => pages[i].sectionId === saved.sectionId && pages[i].offset === saved.offset);
  $('#bookmark-button').setAttribute('aria-pressed',String(Boolean(isSaved)));
  $('#bookmark-button').setAttribute('aria-label',isSaved ? 'إزالة إشارة القراءة' : 'حفظ موضع القراءة');
  pages.forEach((page,i) => {
    const hidden = !visible.includes(i);
    page.element.inert = hidden;
    if (hidden) page.element.setAttribute('aria-hidden','true');
    else page.element.removeAttribute('aria-hidden');
  });
  const pageTitle = pages[index]?.title || currentBook.title;
  $('#reading-status').textContent = 'الصفحة ' + range + ' من ' + arabic(pages.length) + '، ' + pageTitle;
  document.title = (index && pageTitle !== currentBook.title ? pageTitle + ' — ' : '') + currentBook.title + ' — البصيرة';
  if (save) {
    history.replaceState(null,'','#' + currentBook.id + '/' + (index ? 'page-' + startNumber : 'intro'));
    if (index > 0) { lastRead[currentBook.id] = position; storage.write('flipbook:lastRead',lastRead); }
  }
}
function buildReader(position = null, segment = null) {
  rebuilding = true;
  const preserved = position || currentPosition();
  if (book) { book.destroy(); book = null; }
  const sizing = dimensions();
  lastDimensions = JSON.stringify(sizing);
  document.documentElement.style.setProperty('--page-width',sizing.width + 'px');
  document.documentElement.style.setProperty('--page-height',sizing.height + 'px');
  document.documentElement.style.setProperty('--body-size',fontSize + 'px');
  $('#book-stage').classList.toggle('single',sizing.single);
  $('#book-stage').classList.remove('closed','back-closed');
  $('#book-stage').style.height = '';
  $('#book-shift').innerHTML = '<div id="flipbook"></div>';
  pages = paginateSections(buildBookSections(data,currentBook));
  const fragment = document.createDocumentFragment();
  for (const page of pages) fragment.append(page.element);
  $('#flipbook').append(fragment);
  $('#flipbook').querySelectorAll('[data-chapter-page]').forEach(element => {
    element.textContent = arabic(chapterPage(element.dataset.chapterPage) + 1);
  });
  const startPage = segment !== null ? routePage(segment) : pageForPosition(preserved);
  book = createBook($('#flipbook'),{
    width:sizing.width,height:sizing.height,size:'fixed',autoSize:false,
    layout:sizing.single ? 'single' : 'spread',binding:'right',cover:true,
    startPage,flipDuration:750,shadows:true,shadowOpacity:.28,
    click:'edges',drag:true,swipe:true,hover:true
  });
  book.on('flip',() => updateUI());
  book.on('changeState',({state}) => {
    busy = state === 'flipping' || state === 'user_fold';
    if (busy) $('#book-stage').classList.remove('closed','back-closed');
    if (state === 'read') updateUI();
  });
  busy = false;
  rebuilding = false;
  applyFont();
  renderToc();
  updateUI();
}
async function goToPage(index, animate = true) {
  if (!book || busy || !Number.isFinite(index)) return;
  const target = Math.min(pages.length - 1,Math.max(0,Math.floor(index)));
  if (animate) await book.flipTo(target);
  else book.turnTo(target);
  updateUI();
}
async function turn(direction) {
  if (!book || busy) return;
  const changed = await (direction === 'next' ? book.flipNext() : book.flipPrev());
  if (changed) updateUI();
}
function plannedBook() {
  if (book) { book.destroy(); book = null; }
  pages = [];
  $('#bookmark-button').setAttribute('aria-pressed','false');
  $('#bookmark-button').setAttribute('aria-label','حفظ موضع القراءة');
  $('#reading-status').textContent = '';
  $('#book-stage').className = 'book-stage single';
  $('#book-stage').style.height = 'auto';
  $('#book-shift').innerHTML = '<section class="planned-view"><p class="status-label">قيد التخطيط</p><h1>' + escapeHTML(currentBook.title) + '</h1><p>' + escapeHTML(currentBook.description) + '</p><p class="status-label">سنضيف صفحات هذا الكتاب عندما نبدأ كتابته.</p><a class="primary-button" href="#alkatib/intro">العودة إلى الكاتب</a></section>';
  document.title = currentBook.title + ' — البصيرة';
}
function navigate() {
  let parts;
  try { parts = decodeURIComponent(location.hash.slice(1)).split('/'); } catch { parts = []; }
  const selected = data.books.find(item => item.id === parts[0]) || data.books[0];
  const changed = selected.id !== currentBook?.id;
  currentBook = selected;
  renderNav();
  const planned = selected.status === 'planned';
  for (const id of ['page-controls','next-page','previous-page']) $('#' + id).hidden = planned;
  for (const id of ['download-button','open-toc','bookmark-button']) $('#' + id).disabled = planned;
  $('#linear-reader').hidden = planned;
  $('#cover-actions').hidden = planned;
  if (planned) { plannedBook(); applyFont(); return; }
  if (changed || !book) { $('#chapter-search').value = ''; buildReader(null,parts[1] || 'intro'); }
  else goToPage(routePage(parts[1]),false);
}
function toggleBookmark() {
  if (!book) return;
  if ($('#bookmark-button').getAttribute('aria-pressed') === 'true') {
    delete bookmarks[currentBook.id]; notify('أُزيلت إشارة القراءة');
  } else {
    bookmarks[currentBook.id] = currentPosition(); notify('حُفظت الصفحة على هذا الجهاز');
  }
  storage.write('flipbook:bookmarks',bookmarks);
  updateUI(false);
}
function changeFont(delta) {
  if (!book || busy) return;
  const position = currentPosition();
  fontSize = Math.min(29,Math.max(18,fontSize + delta));
  storage.write('fontSize',fontSize);
  buildReader(position);
  notify('تم ضبط الخط وتوزيع النص على الصفحات');
}
function wireEvents() {
  $('#next-page').addEventListener('click',() => turn('next'));
  $('#previous-page').addEventListener('click',() => turn('previous'));
  $('#open-book').addEventListener('click',() => turn('next'));
  $('#book-stage').addEventListener('click',event => {
    if (book?.page === 0 && !busy && !event.target.closest('a,button,input')) turn('next');
  });
  $('#resume-reading').addEventListener('click',() => goToPage(pageForPosition(lastRead[currentBook.id])));
  $('#bookmark-button').addEventListener('click',toggleBookmark);
  $('#font-increase').addEventListener('click',() => changeFont(1));
  $('#font-decrease').addEventListener('click',() => changeFont(-1));
  $('#theme-button').addEventListener('click',() => {
    const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(theme); storage.write('theme',theme);
  });
  $('#open-toc').addEventListener('click',() => {
    renderToc(); $('#toc-dialog').showModal(); $('#chapter-search').focus();
  });
  $('#download-button').addEventListener('click',() => $('#download-dialog').showModal());
  $('#about-button').addEventListener('click',() => $('#about-dialog').showModal());
  $('#chapter-search').addEventListener('input',renderToc);
  $('#saved-reading').addEventListener('click',event => {
    const target = event.target.closest('[data-saved]');
    if (!target) return;
    $('#toc-dialog').close();
    goToPage(pageForPosition(target.dataset.saved === 'bookmark' ? bookmarks[currentBook.id] : lastRead[currentBook.id]));
  });
  $('#page-form').addEventListener('submit',event => {
    event.preventDefault();
    if ($('#page-input').checkValidity()) goToPage(Number($('#page-input').value) - 1);
  });
  $('#page-progress').addEventListener('input',event => goToPage(Number(event.target.value) - 1,false));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click',() => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click',event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  }));
  document.addEventListener('click',event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    if (link.classList.contains('skip-link')) {
      event.preventDefault(); $('#book-stage').focus(); return;
    }
    event.preventDefault();
    link.closest('dialog')?.close();
    const nextHash = link.getAttribute('href');
    if (location.hash === nextHash) navigate();
    else location.hash = nextHash;
  });
  document.addEventListener('keydown',event => {
    if (!book || document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); turn('next'); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); turn('previous'); }
    else if (event.key === 'Home') { event.preventDefault(); goToPage(0); }
    else if (event.key === 'End') { event.preventDefault(); goToPage(pages.length - 1); }
  });
  window.addEventListener('hashchange',navigate);
  window.addEventListener('resize',() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!book || rebuilding || JSON.stringify(dimensions()) === lastDimensions) return;
      buildReader(currentPosition());
    },180);
  });
}
async function initialize() {
  applyTheme(storage.read('theme','light'));
  document.documentElement.style.setProperty('--body-size',fontSize + 'px');
  const response = await fetch('data/books.json');
  if (!response.ok) throw new Error('Book content unavailable');
  data = await response.json();
  await document.fonts.ready;
  $('#about-content').innerHTML = '<p>' + escapeHTML(data.series.description) + '</p><p>بقلم ' + escapeHTML(data.series.author) + '</p>' + data.books.map(item => '<section class="series-book"><a href="#' + item.id + '/intro">' + escapeHTML(item.title) + '</a><p>' + escapeHTML(item.description) + '</p></section>').join('');
  wireEvents();
  navigate();
}
initialize().catch(error => {
  console.error(error);
  $('#book-stage').innerHTML = '<div class="error-state"><h1>تعذّر فتح الكتاب</h1><p><a href="downloads/alkatib.html">افتح نسخة القراءة الكاملة</a> أو أعد تحميل الصفحة.</p></div>';
});
