'use strict';

const $ = (selector) => document.querySelector(selector);
const icons = {
  moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 14.3A8.7 8.7 0 0 1 9.7 3.6 8.8 8.8 0 1 0 20.4 14.3Z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h12M4 12h12M4 19h12M20 5h.01M20 12h.01M20 19h.01"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m6-6-6 6 6 6"/></svg>'
};
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const normalize = (text) => String(text).normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').toLowerCase().trim();
const arabicNumber = (number) => new Intl.NumberFormat('ar').format(number);
const storage = {
  read(key, fallback) { try { const value = JSON.parse(localStorage.getItem(`basira:${key}`)); return value ?? fallback; } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem(`basira:${key}`, JSON.stringify(value)); } catch { /* Reading remains usable when storage is unavailable. */ } }
};
let data;
let currentBook;
let currentChapter = null;
let route = '';
let toastTimeout;
let fontSize = Math.max(18, Math.min(30, Number(storage.read('fontSize', 23)) || 23));
let bookmarks = storage.read('bookmarks', {});
if (typeof bookmarks !== 'object' || bookmarks === null || Array.isArray(bookmarks)) bookmarks = {};
let lastRead = storage.read('lastRead', {});
if (typeof lastRead !== 'object' || lastRead === null || Array.isArray(lastRead)) lastRead = {};

function notify(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('#toast').classList.remove('show'), 2600);
}

function applyTheme(theme) {
  const dark = theme === 'dark';
  document.body.classList.toggle('dark', dark);
  $('#theme-button').innerHTML = dark ? icons.sun : icons.moon;
  $('#theme-button').setAttribute('aria-label', dark ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي');
  $('#theme-button').title = dark ? 'الوضع النهاري' : 'الوضع الليلي';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#15242b' : '#f7f4ec';
}

function applyFontSize() {
  document.documentElement.style.setProperty('--body-size', `${fontSize}px`);
  $('#font-increase').disabled = fontSize >= 30;
  $('#font-decrease').disabled = fontSize <= 18;
}

function openToc() {
  $('#sidebar').inert = false;
  $('#sidebar').removeAttribute('aria-hidden');
  $('#sidebar').setAttribute('role', 'dialog');
  $('#sidebar').setAttribute('aria-modal', 'true');
  $('#sidebar').classList.add('open');
  $('#drawer-backdrop').hidden = false;
  document.body.classList.add('drawer-open');
  $('#open-toc').setAttribute('aria-expanded', 'true');
  $('#chapter-search').focus();
  if ($('#chapter-search').disabled) $('#close-toc').focus();
  document.querySelectorAll('.site-header, #books-nav, #reader, .skip-link').forEach(element => { element.inert = true; });
}

function closeToc(restoreFocus = false) {
  const wasOpen = $('#sidebar').classList.contains('open');
  $('#sidebar').classList.remove('open');
  $('#drawer-backdrop').hidden = true;
  document.body.classList.remove('drawer-open');
  $('#open-toc').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.site-header, #books-nav, #reader, .skip-link').forEach(element => { element.inert = false; });
  if (restoreFocus && wasOpen) $('#open-toc').focus();
  const mobile = window.matchMedia('(max-width:900px)').matches;
  $('#sidebar').inert = mobile;
  if (mobile) $('#sidebar').setAttribute('aria-hidden', 'true');
  else $('#sidebar').removeAttribute('aria-hidden');
  $('#sidebar').removeAttribute('role');
  $('#sidebar').removeAttribute('aria-modal');
}

function renderBookNav() {
  $('#books-nav').innerHTML = data.books.map(book => `<a class="book-tab${book.id === currentBook.id ? ' active' : ''}" href="#${book.id}/intro" ${book.id === currentBook.id ? 'aria-current="page"' : ''}>${escapeHTML(book.title)}</a>`).join('');
}

function renderSidebar() {
  const query = normalize($('#chapter-search').value);
  const book = currentBook;
  $('#chapter-search').disabled = !book.chapters.length;
  if (!book.chapters.length) {
    $('#chapter-nav').innerHTML = `<a class="toc-intro active" href="#${book.id}/intro" aria-current="page">عن الكتاب</a><p class="planned-sidebar">هذا الكتاب في مرحلة التخطيط. سنضيف فهرسه ونصوصه مع تقدّم المشروع.</p>`;
    $('#search-status').textContent = '';
    $('#saved-reading').innerHTML = '';
    return;
  }
  let matches = 0;
  let html = !query ? `<a class="toc-intro${!currentChapter ? ' active' : ''}" href="#${book.id}/intro" ${!currentChapter ? 'aria-current="page"' : ''}>عن هذه المسودة</a>` : '';
  for (const part of book.parts) {
    const chapters = book.chapters.filter(chapter => chapter.partId === part.id && (!query || normalize([chapter.title, chapter.summary, part.title, ...chapter.outline].join(' ')).includes(query)));
    if (!chapters.length) continue;
    matches += chapters.length;
    html += `<section class="toc-group"><h3 class="toc-part">${escapeHTML(part.title)}</h3>${chapters.map(chapter => `<a class="toc-link${currentChapter?.id === chapter.id ? ' active' : ''}" href="#${book.id}/${chapter.id}" ${currentChapter?.id === chapter.id ? 'aria-current="page"' : ''}>${escapeHTML(chapter.title)}</a>`).join('')}</section>`;
  }
  if (!matches) html = '<p class="empty-search">لا توجد فصول تطابق بحثك. جرّب كلمة أخرى.</p>';
  $('#chapter-nav').innerHTML = html;
  $('#search-status').textContent = query ? `${arabicNumber(matches)} فصلًا يطابق البحث` : '';
  renderSavedReading();
}

function renderSavedReading() {
  const savedId = bookmarks[currentBook.id];
  const savedChapter = savedId === 'intro' ? {id:'intro', title:'عن هذه المسودة'} : currentBook.chapters.find(chapter => chapter.id === savedId);
  const lastId = lastRead[currentBook.id];
  const previous = currentBook.chapters.find(chapter => chapter.id === lastId);
  const links = [];
  if (savedChapter && savedId !== (currentChapter?.id || 'intro')) links.push(`<a href="#${currentBook.id}/${savedId}">إشارتي: ${escapeHTML(savedChapter.title)}</a>`);
  if (!currentChapter && previous && previous.id !== savedId) links.push(`<a href="#${currentBook.id}/${previous.id}">متابعة القراءة: ${escapeHTML(previous.title)}</a>`);
  $('#saved-reading').innerHTML = links.join('');
  const saved = savedId === (currentChapter?.id || 'intro');
  $('#bookmark-button').setAttribute('aria-pressed', String(saved));
  $('#bookmark-button').setAttribute('aria-label', saved ? 'إزالة إشارة القراءة' : 'حفظ موضع القراءة');
  $('#bookmark-button').title = saved ? 'إزالة إشارة القراءة' : 'حفظ موضع القراءة';
  $('#bookmark-button').disabled = currentBook.status === 'planned';
}

function renderOverview() {
  const book = currentBook;
  $('#reading-content').innerHTML = `<div class="book-overview"><div class="book-heading"><h1>${escapeHTML(book.title)}</h1><p class="book-subtitle">من حياتي تبدأ الحكاية</p><p class="book-meta">الكتاب الأول · مسودة قيد الكتابة</p>${data.series.author ? `<p class="author">بقلم ${escapeHTML(data.series.author)}</p>` : ''}</div><img class="book-cover" src="assets/alkatib-cover.png" alt="غلاف الكاتب، الكتاب الأول من سلسلة البصيرة" width="1088" height="1456"><div class="overview-copy"><p class="book-summary">تبدأ هذه الرحلة من التجربة الشخصية، ثم تتّسع إلى الإنسان والعلوم والحياة العملية.</p><div class="hero-actions"><a class="primary-button" href="#${book.id}/${book.chapters[0].id}">تصفّح الفصول</a><button class="secondary-button" id="download-button">تنزيل الكتاب</button></div></div></div><section class="introduction prose"><h2>${escapeHTML(data.introduction.title)}</h2>${data.introduction.paragraphs.map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join('')}</section>`;
  $('#download-button').addEventListener('click', () => $('#download-dialog').showModal());
}

function renderChapter() {
  const chapter = currentChapter;
  const part = currentBook.parts.find(item => item.id === chapter.partId);
  const hasManuscript = chapter.paragraphs.length > 0;
  const status = hasManuscript ? 'مسودة نص للمراجعة' : 'مخطط فصل · النص قيد الكتابة';
  $('#reading-content').innerHTML = `<header class="chapter-header"><p class="chapter-kicker">${escapeHTML(part.title)} · الفصل ${arabicNumber(chapter.number)}</p><h1>${escapeHTML(chapter.title)}</h1><p class="chapter-summary">${escapeHTML(chapter.summary)}</p><p class="draft-note">${status}</p></header>${hasManuscript ? `<section class="prose manuscript">${chapter.paragraphs.map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join('')}</section>` : `<section class="prose outline-content"><h2>خطة الفصل</h2>${chapter.outline.map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join('')}</section><p class="manuscript-status">هذه محاور أولية للفصل. سيُضاف النص بعد جمع مادة الكاتب ومراجعة صياغتها.</p>`}`;
}

function renderPlannedBook() {
  const index = data.books.findIndex(book => book.id === currentBook.id);
  const ordinals = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
  $('#reading-content').innerHTML = `<section class="planned-book"><p class="planned-number">الكتاب ${ordinals[index]} من البصيرة</p><h1>${escapeHTML(currentBook.title)}</h1><p>${escapeHTML(currentBook.description)}</p><p class="draft-note">قيد التخطيط. سيُضاف المحتوى حين نبدأ كتابة هذا الكتاب.</p><a class="secondary-button" href="#alkatib/intro">العودة إلى الكاتب ${icons.left}</a></section>`;
  $('#bookmark-button').disabled = true;
  $('#bookmark-button').setAttribute('aria-pressed', 'false');
  $('#bookmark-button').setAttribute('aria-label', 'حفظ موضع القراءة');
}

function renderPagination() {
  if (!currentBook.chapters.length) { $('#chapter-pagination').innerHTML = ''; return; }
  const index = currentChapter ? currentBook.chapters.findIndex(item => item.id === currentChapter.id) : -1;
  const previous = index > 0 ? currentBook.chapters[index - 1] : index === 0 ? {id:'intro', title:'عن هذه المسودة'} : null;
  const next = currentBook.chapters[index + 1];
  $('#chapter-pagination').innerHTML = `${previous ? `<a class="page-link previous" href="#${currentBook.id}/${previous.id}">${icons.right}<span><small>السابق</small>${escapeHTML(previous.title)}</span></a>` : ''}${next ? `<a class="page-link next" href="#${currentBook.id}/${next.id}"><span><small>التالي</small>${escapeHTML(next.title)}</span>${icons.left}</a>` : `<a class="page-link next" href="#alrasul/intro"><span><small>الكتاب التالي في السلسلة</small>الرسول</span>${icons.left}</a>`}`;
}

function navigate(initial = false) {
  let parts;
  try { parts = decodeURIComponent(location.hash.slice(1)).split('/'); } catch { parts = []; }
  const nextBook = data.books.find(book => book.id === parts[0]) || data.books[0];
  const nextChapter = nextBook.chapters.find(chapter => chapter.id === parts[1]) || null;
  const changedBook = currentBook?.id !== nextBook.id;
  currentBook = nextBook;
  currentChapter = nextChapter;
  route = `${currentBook.id}/${currentChapter?.id || 'intro'}`;
  if (location.hash !== `#${route}`) history.replaceState(null, '', `#${route}`);
  if (changedBook) $('#chapter-search').value = '';
  if (currentChapter) { lastRead[currentBook.id] = currentChapter.id; storage.write('lastRead', lastRead); }
  document.title = `${currentChapter ? `${currentChapter.title} — ` : ''}${currentBook.title} — البصيرة`;
  $('#current-book-label').textContent = currentBook.title;
  renderBookNav();
  renderSidebar();
  if (currentBook.status === 'planned') renderPlannedBook();
  else if (currentChapter) renderChapter();
  else renderOverview();
  renderPagination();
  closeToc();
  if (!initial) {
    $('#reading-content').focus({preventScroll:true});
    window.scrollTo({top:0, behavior:'instant'});
  }
}

function initialize() {
  applyTheme(storage.read('theme', 'light'));
  applyFontSize();
  $('#bookmark-button').innerHTML = icons.bookmark;
  $('#open-toc').innerHTML = icons.list;
  $('.skip-link').addEventListener('click', event => {
    event.preventDefault();
    $('#reading-content').focus({preventScroll:true});
    $('#reading-content').scrollIntoView({block:'start'});
  });
  $('#theme-button').addEventListener('click', () => {
    const theme = document.body.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(theme); storage.write('theme', theme);
  });
  $('#font-increase').addEventListener('click', () => { fontSize = Math.min(30, fontSize + 1); applyFontSize(); storage.write('fontSize', fontSize); notify('تم تكبير النص'); });
  $('#font-decrease').addEventListener('click', () => { fontSize = Math.max(18, fontSize - 1); applyFontSize(); storage.write('fontSize', fontSize); notify('تم تصغير النص'); });
  $('#bookmark-button').addEventListener('click', () => {
    const chapterId = currentChapter?.id || 'intro';
    if (bookmarks[currentBook.id] === chapterId) { delete bookmarks[currentBook.id]; notify('أُزيلت إشارة القراءة'); }
    else { bookmarks[currentBook.id] = chapterId; notify('حُفظ موضع القراءة على هذا الجهاز'); }
    storage.write('bookmarks', bookmarks); renderSavedReading();
  });
  $('#chapter-search').addEventListener('input', renderSidebar);
  $('#open-toc').addEventListener('click', openToc);
  $('#close-toc').addEventListener('click', () => closeToc(true));
  $('#drawer-backdrop').addEventListener('click', () => closeToc(true));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeToc(true);
    if (event.key === 'Tab' && $('#sidebar').classList.contains('open')) {
      const items = [...$('#sidebar').querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')];
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
    }
  });
  window.matchMedia('(min-width:901px)').addEventListener('change', () => closeToc());
  $('#about-button').addEventListener('click', () => $('#about-dialog').showModal());
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if(event.target === dialog) { const rect = dialog.getBoundingClientRect(); if(event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
  $('#about-content').innerHTML = `<p class="series-description">${escapeHTML(data.series.description)}</p>${data.series.author ? `<p>بقلم ${escapeHTML(data.series.author)}</p>` : ''}${data.books.map(book => `<section class="series-book"><a href="#${book.id}/intro">${escapeHTML(book.title)}</a><p>${escapeHTML(book.description)}</p></section>`).join('')}`;
  $('#about-content').addEventListener('click', event => { if(event.target.closest('a')) $('#about-dialog').close(); });
  window.addEventListener('hashchange', () => navigate());
  navigate(true);
}

fetch('data/books.json').then(response => {
  if (!response.ok) throw new Error('Book content could not be loaded');
  return response.json();
}).then(result => { data = result; initialize(); }).catch(error => {
  console.error(error);
  $('#reading-content').innerHTML = '<div class="error-state"><h1>تعذّر فتح الكتاب</h1><p>أعد تحميل الصفحة، أو افتح النسخة الكاملة مباشرة.</p><a class="secondary-button" href="downloads/alkatib.html">فتح نسخة القراءة</a></div>';
});
