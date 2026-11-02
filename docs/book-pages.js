/**
 * Turn the manuscript data into reading-order sections, independent of the DOM.
 * A section is not a physical page: the reader may paginate its blocks to fit
 * the selected type size and viewport without changing these stable IDs.
 */
export function buildBookSections(data, book) {
  const books = data.books || [];
  const bookNumber = Math.max(1, books.findIndex(item => item.id === book.id) + 1);
  const ordinal = ['الأول', 'الثاني', 'الثالث', 'الرابع'][bookNumber - 1] || String(bookNumber);
  const seriesTitle = data.series?.title || 'البصيرة';
  const author = data.series?.author || '';
  const parts = book.parts || [];
  const chapters = book.chapters || [];
  const writingLabel = book.status === 'planned' ? 'قيد التخطيط' : 'مسودة قيد الكتابة';
  const shared = {
    bookId: book.id,
    bookTitle: book.title,
    seriesTitle,
    author,
    bookNumber,
    bookNumberLabel: `الكتاب ${ordinal}`
  };
  const section = (id, kind, title, properties = {}) => ({
    ...shared,
    id,
    chapterId: null,
    kind,
    title,
    blocks: [],
    ...properties
  });
  const paragraphs = items => (items || []).map(text => ({type: 'paragraph', text}));
  const sections = [
    section('cover', 'cover', book.title, {
      subtitle: book.subtitle || '',
      description: book.description || '',
      statusLabel: writingLabel
    }),
    section('title-page', 'title-page', book.title, {
      subtitle: book.subtitle || '',
      description: book.description || '',
      statusLabel: writingLabel
    })
  ];

  // The supplied introduction belongs to the first manuscript. Do not repeat
  // its author-book-specific claims in a planned volume.
  if (bookNumber === 1 && data.introduction) {
    sections.push(section('intro', 'introduction', data.introduction.title, {
      blocks: paragraphs(data.introduction.paragraphs)
    }));
  } else {
    sections.push(section('intro', 'introduction', 'عن الكتاب', {
      blocks: paragraphs([
        book.description || '',
        ...(book.status === 'planned' ? ['هذا الكتاب قيد التخطيط. سيُضاف المحتوى حين تبدأ كتابته.'] : [])
      ].filter(Boolean))
    }));
  }

  for (const part of parts) {
    const entries = chapters.filter(chapter => chapter.partId === part.id);
    if (!entries.length) continue;
    sections.push(section(`toc-${part.id}`, 'toc', 'فهرس الكتاب', {
      partId: part.id,
      partTitle: part.title,
      blocks: [
        {type: 'heading', text: part.title},
        ...entries.map(chapter => ({
          type: 'toc-entry',
          text: chapter.title,
          chapterId: chapter.id,
          chapterNumber: chapter.number
        }))
      ]
    }));
  }

  for (const chapter of chapters) {
    const part = parts.find(item => item.id === chapter.partId);
    const hasManuscript = Array.isArray(chapter.paragraphs) && chapter.paragraphs.length > 0;
    const statusLabel = !hasManuscript
      ? 'مخطط فصل · النص قيد الكتابة'
      : ({published: 'نص منشور', review: 'مسودة للمراجعة', draft: 'مسودة قيد الكتابة'}[chapter.status] || 'مسودة قيد الكتابة');
    const chapterMetadata = {
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      chapterTitle: chapter.title,
      partId: chapter.partId,
      partTitle: part?.title || '',
      status: chapter.status,
      statusLabel,
      hasManuscript
    };
    sections.push(section(`${chapter.id}-title`, 'chapter-title', chapter.title, {
      ...chapterMetadata,
      summary: chapter.summary || ''
    }));
    sections.push(section(`${chapter.id}-content`, 'content', hasManuscript ? chapter.title : 'خطة الفصل', {
      ...chapterMetadata,
      blocks: [
        ...paragraphs(hasManuscript ? chapter.paragraphs : chapter.outline),
        ...(!hasManuscript ? [{
          type: 'paragraph',
          text: 'هذه محاور أولية للفصل. سيُضاف النص بعد جمع مادة الكاتب ومراجعة صياغتها.',
          isNote: true
        }] : [])
      ]
    }));
  }

  sections.push(section('back-cover', 'back-cover', seriesTitle, {
    subtitle: book.title,
    statusLabel: writingLabel,
    seriesTitles: books.map(item => item.title),
    blocks: paragraphs([
      data.series?.description || '',
      book.status === 'planned' ? 'هذا الكتاب قيد التخطيط.' : 'تُحدَّث هذه المسودة مع تقدّم الكتابة.'
    ].filter(Boolean))
  }));
  return sections;
}
