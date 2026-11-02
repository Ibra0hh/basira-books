const arabicNumber = value => new Intl.NumberFormat('ar-EG', {useGrouping: false}).format(value);

function textElement(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function bodyFits(body) {
  if (body.clientHeight < 1 || body.scrollHeight > body.clientHeight + 1) return false;
  const bounds = body.getBoundingClientRect();
  return [...body.children].every(child => {
    const box = child.getBoundingClientRect();
    return box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
  });
}

function fitStaticBody(body) {
  const textNodes = [...body.children].filter(node => node.textContent.trim());
  const initialSizes = textNodes.map(node => Number.parseFloat(getComputedStyle(node).fontSize));
  for (let step = 0; !bodyFits(body) && step < 24; step += 1) {
    const factor = Math.max(.4, 1 - (step + 1) * .025);
    textNodes.forEach((node, index) => { node.style.fontSize = `${Math.max(12, initialSizes[index] * factor)}px`; });
    if (step > 12) textNodes.forEach(node => { node.style.marginBlock = '5px'; });
  }
  if (!bodyFits(body)) throw new Error('The book page is too short to fit its title. Increase the page height.');
}

function fitRepeatedHeading(body, heading) {
  let size = Number.parseFloat(getComputedStyle(heading).fontSize);
  while ((heading.getBoundingClientRect().height > body.clientHeight * .35 || !bodyFits(body)) && size > 16) {
    size -= 1;
    heading.style.fontSize = `${size}px`;
  }
}

function renderBlock(block, section) {
  if (block.type === 'toc-entry') {
    const link = document.createElement('a');
    link.className = 'toc-entry';
    link.href = `#${encodeURIComponent(section.bookId)}/${encodeURIComponent(block.chapterId)}`;
    link.append(textElement('span', block.text, 'toc-text'));
    const number = textElement('span', '—', 'toc-page');
    number.dataset.chapterPage = block.chapterId;
    link.append(number);
    return link;
  }
  return textElement(block.type === 'heading' ? 'h3' : 'p', block.text, block.isNote ? 'editorial-note' : '');
}

/** Return the longest prefix that fits, leaving that prefix in the DOM. */
function fittingPrefix(node, tokens, body) {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    node.textContent = tokens.slice(0, middle).join('');
    if (bodyFits(body)) low = middle;
    else high = middle - 1;
  }
  node.textContent = tokens.slice(0, low).join('');
  return low;
}

function graphemes(text) {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ar', {granularity: 'grapheme'}).segment(text)].map(item => item.segment);
  }
  return Array.from(text);
}

/**
 * Measure manuscript sections at the reader's current CSS dimensions.
 * Returned elements are detached and in logical reading order. Call after
 * document.fonts.ready and after setting --page-width, --page-height and
 * --body-size. offset is a zero-based physical-page offset within its section.
 */
export function paginateSections(sections) {
  const measure = document.querySelector('#page-measure');
  if (!measure) throw new Error('The page measurement container is missing.');
  const pages = [];

  function newPage(section, offset = 0, heading = false) {
    const index = pages.length;
    const page = document.createElement('div');
    page.className = `book-page ${section.kind}`;
    page.dataset.pageIndex = String(index);
    page.dataset.sectionId = section.id;
    page.dataset.offset = String(offset);
    if (section.chapterId) page.dataset.chapterId = section.chapterId;
    page.setAttribute('aria-label', `الصفحة ${arabicNumber(index + 1)}، ${section.title}`);
    const inner = document.createElement('div');
    inner.className = 'page-inner';
    const runningTitle = textElement('div', section.kind === 'content' ? section.title : `${section.bookNumberLabel}: ${section.bookTitle}`, 'running-title');
    const body = document.createElement('div');
    body.className = 'page-body';
    const footer = textElement('div', arabicNumber(index + 1), 'page-number');
    inner.append(runningTitle, body, footer);
    page.append(inner);
    const descriptor = {
      element: page,
      sectionId: section.id,
      offset,
      chapterId: section.chapterId || null,
      kind: section.kind,
      title: section.title
    };
    pages.push(descriptor);
    measure.replaceChildren(page);
    if (body.clientHeight < 1) throw new Error('The page measurement container must have a measurable height.');
    if (heading) {
      const title = textElement('h2', section.title);
      body.append(title);
      fitRepeatedHeading(body, title);
    }
    return {page, inner, body, runningTitle, footer, blockCount: 0};
  }

  function blankBefore(section) {
    const blank = {...section, id: `blank-before-${section.id}`, kind: 'blank-page', title: section.bookTitle, chapterId: null};
    const {body} = newPage(blank);
    body.append(textElement('p', section.seriesTitle), textElement('p', section.bookTitle));
    fitStaticBody(body);
  }

  function cover(section) {
    const {page, body, runningTitle, footer} = newPage(section);
    page.classList.add('cover-page');
    page.dataset.density = 'hard';
    // Covers still count in the page sequence; their physical folio and
    // running title are omitted just as they are on a printed cover.
    runningTitle.hidden = true;
    footer.hidden = true;
    body.classList.add('cover-face');
    if (section.kind === 'back-cover') {
      body.append(textElement('h2', section.title, 'cover-title'));
      body.append(textElement('p', (section.seriesTitles || []).join(' · '), 'series-titles'));
      for (const block of section.blocks || []) body.append(textElement('p', block.text));
      if (section.author) body.append(textElement('p', section.author, 'cover-author'));
    } else {
      body.append(textElement('p', section.seriesTitle, 'cover-series'));
      body.append(textElement('h1', section.title, 'cover-title'));
      if (section.subtitle) body.append(textElement('p', section.subtitle, 'cover-subtitle'));
      const arch = document.createElement('div');
      arch.className = 'cover-arch';
      arch.setAttribute('aria-hidden', 'true');
      body.append(arch);
      if (section.author) body.append(textElement('p', section.author, 'cover-author'));
      body.append(textElement('p', `${section.bookNumberLabel} · ${section.statusLabel}`, 'cover-edition'));
    }
    fitStaticBody(body);
  }

  function staticPage(section) {
    const {body} = newPage(section);
    if (section.kind === 'title-page') {
      body.append(textElement('p', section.seriesTitle, 'title-series'));
      body.append(textElement('p', section.bookNumberLabel, 'chapter-number'));
      body.append(textElement('h1', section.title, 'book-name'));
      if (section.subtitle) body.append(textElement('p', section.subtitle, 'chapter-summary'));
      if (section.author) body.append(textElement('p', section.author, 'title-author'));
      body.append(textElement('p', section.statusLabel, 'status-label'));
    } else {
      if (section.partTitle) body.append(textElement('p', section.partTitle, 'part-name'));
      body.append(textElement('p', `الفصل ${arabicNumber(section.chapterNumber)}`, 'chapter-number'));
      body.append(textElement('h2', section.title));
      if (section.summary) body.append(textElement('p', section.summary, 'chapter-summary'));
      body.append(textElement('p', section.statusLabel, 'status-label'));
    }
    fitStaticBody(body);
  }

  function flowingPages(section) {
    let offset = 0;
    let current = newPage(section, offset, section.kind !== 'content');
    const nextPage = () => { current = newPage(section, ++offset, false); };
    for (const block of section.blocks || []) {
      if (!String(block.text || '').length) continue;
      let remaining = String(block.text);
      while (remaining.length) {
        const node = renderBlock({...block, text: remaining}, section);
        current.body.append(node);
        if (bodyFits(current.body)) {
          current.blockCount += 1;
          break;
        }

        if (block.type !== 'paragraph') {
          node.remove();
          if (current.blockCount) { nextPage(); continue; }
          // TOC links and part headings stay intact. Very long labels can
          // reduce type on an otherwise empty page rather than disappear.
          current.body.append(node);
          let size = Number.parseFloat(getComputedStyle(node).fontSize);
          while (!bodyFits(current.body) && size > 12) node.style.fontSize = `${--size}px`;
          if (!bodyFits(current.body)) throw new Error('A table of contents entry cannot fit the current page size.');
          current.blockCount += 1;
          break;
        }

        // Tokens retain their following whitespace, preserving original prose
        // when a paragraph is divided across two or more physical pages.
        let tokens = remaining.match(/\s*\S+\s*/gu) || [remaining];
        let count = fittingPrefix(node, tokens, current.body);
        if (!count && current.blockCount) {
          node.remove();
          nextPage();
          continue;
        }
        if (!count) {
          // A single URL/unbroken word may itself be longer than a page.
          // Segment by grapheme so Arabic combining marks stay attached.
          tokens = graphemes(remaining);
          count = fittingPrefix(node, tokens, current.body);
        }
        if (!count) throw new Error('The current page dimensions leave no space for a line of text.');
        remaining = tokens.slice(count).join('');
        current.blockCount += 1;
        if (remaining.length) nextPage();
      }
    }
  }

  try {
    for (const section of sections) {
      if (section.kind === 'chapter-title' && pages.length % 2 === 0) blankBefore(section);
      if (section.kind === 'back-cover' && pages.length % 2 === 0) blankBefore(section);
      if (section.kind === 'cover' || section.kind === 'back-cover') cover(section);
      else if (section.kind === 'title-page' || section.kind === 'chapter-title') staticPage(section);
      else flowingPages(section);
    }
    return pages;
  } finally {
    measure.replaceChildren();
  }
}
