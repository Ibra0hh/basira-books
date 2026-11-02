# OpenPageFlip vendor copy

- Package: `@openpageflip/core@0.7.0`, pinned.
- Upstream: https://github.com/benhonda/openpageflip/tree/main/packages/core
- Download: https://registry.npmjs.org/@openpageflip/core/-/core-0.7.0.tgz
- License: MIT; the unmodified package `LICENSE` is included and retains both upstream copyright notices.
- Tarball integrity, verified before extraction: `sha512-b7HxPFIEABKc6G1rSgWjLQ46hAbVfLNye21WWpcawZGItUy+xyPA7v76uxuHegSTuyltEkOSH6gnncaqWceIRA==`.
- Tarball SHA-1: `e78defbfaa3c299e3fc5cc4942532c2575cff720`.
- `integrity.json` records SHA-256 and byte length for every copied upstream file.

The JavaScript, CSS, declarations, source maps, license, package metadata and upstream README are copied byte-for-byte from the official npm package. Distribution files are flattened from `dist/` into this directory. `upstream-package.json` and `UPSTREAM-README.md` preserve the package metadata and documentation. This README and `integrity.json` are local provenance records.

No npm install, lifecycle scripts or package build was run. The package has no runtime dependencies. A focused review of the unminified distribution found no dynamic evaluation, network requests, cookie access or browser-storage access. This is a limited integration review, not a general security audit.

## Browser integration

Load `styles.css` once and either import `createBook` from `index.js` or load the smaller `index.iife.js`, which exposes `OpenPageFlip.createBook`. The two distributions implement the same API; a site needs only one of them at runtime. Source maps are retained for debugging.

```js
import { createBook } from './vendor/openpageflip/index.js';

const book = createBook(container, {
  width: 400,
  height: 560,
  size: 'stretch',
  minWidth: 280,
  maxWidth: 500,
  layout: 'auto',
  binding: 'right',
  cover: true,
  flipDuration: 700
});

book.on('flip', ({ page }) => showPageNumber(page));
```

Children are pages in logical reading order. `binding: 'right'` handles Arabic binding and gesture geometry; do not reverse the array or mirror the content. `data-density="hard"` gives individual pages rigid movement. With `cover: true`, the first and an unpaired final page stand alone.

`size: 'stretch'` preserves the base width/height ratio. `layout: 'auto'` switches to one page when the container is narrower than twice `minWidth`; `single` and `spread` force the layout. `autoSize: true` sets container width, minimum/maximum width and aspect ratio. If the host supplies its own width and height, use `autoSize: false`. Note that an auto-sized container cannot shrink below `minWidth`.

A built-in `ResizeObserver` handles container resizes. `book.update()` remeasures after other layout changes. `changeOrientation` reports `{ orientation }`; there is no separate resize event. `init` is queued after construction and reports `{ page, orientation }`. `update` reports `{ page, orientation }` only when `setPages()` is used. `flip` reports `{ page }`, the zero-based first index in the visible logical spread. In portrait, every page is shown individually. With covers in landscape, spreads are `[0]`, `[1,2]`, `[3,4]`, etc. Read `book.orientation` and `book.pageCount` to form a visible-page range.

Animated `flipNext()`, `flipPrev()` and `flipTo(index)` return a promise resolving to whether a turn occurred. `turnTo(index)`, `turnNext()` and `turnPrev()` are immediate. `book.on()` returns an unsubscribe function. `changeState` carries `{ state }`; `read` means idle. Reduced-motion preference automatically makes animation instantaneous. Add accessible labels, keyboard controls and page announcements in the application.

To disable pointer page turning, pass `click: 'off', drag: false, swipe: false, hover: false`. The default ignored interactive targets are links, buttons, inputs, textareas, selects and `[data-opf-no-flip]`.

Call `destroy()` before rebuilding the book: it disconnects its observer, cancels pending layout/animation, removes pointer listeners, removes generated shadow/clone nodes, restores page class/style state, clears listeners and removes engine container sizing styles. It keeps the container and original page elements.

This is a pre-1.0 library. Keep the version pinned and verify RTL turns, cover states, narrow layouts, direct navigation and all prose visibility before upgrading.
