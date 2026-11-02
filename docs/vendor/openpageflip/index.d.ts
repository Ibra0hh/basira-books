//#region src/animation.d.ts
/** Time and frame sources, injectable so tests can step animations by hand. */
type Clock = {
  now(): number;
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(handle: number): void;
};
//#endregion
//#region src/geometry/point.d.ts
/**
 * Plane geometry primitives for the fold calculation. Pure functions, no DOM.
 *
 * The maths derives from StPageFlip's `Helper` (MIT, Oleg Litovski). Where the original's
 * behaviour is quirky, the quirk is kept and commented, because the renderer's look depends on
 * it and the parity tests in `test/fold.parity.test.ts` hold this module to the original.
 */
type Point = {
  readonly x: number;
  readonly y: number;
};
/** A line through two points. Used as an infinite line, not a bounded segment. */
type Segment = readonly [Point, Point];
type Rect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};
/** The four corners of a rectangle after rotation, so no longer axis-aligned. */
type RectPoints = {
  readonly topLeft: Point;
  readonly topRight: Point;
  readonly bottomLeft: Point;
  readonly bottomRight: Point;
};
//#endregion
//#region src/options.d.ts
/**
 * Public option vocabularies. Plain `as const` objects instead of enums so they survive
 * `isolatedModules`, `erasableSyntaxOnly`, and consumers who only speak string literals.
 */
/**
 * How many pages are visible at once. `auto` shows a spread when two pages fit across the
 * container (side by side, or one above the other for a top-bound book), else one page.
 */
declare const Layout: {
  readonly auto: "auto";
  readonly single: "single";
  readonly spread: "spread";
};
type Layout = (typeof Layout)[keyof typeof Layout];
/**
 * Which corner a programmatic flip lifts. Named for a left- or right-bound book; with a top or
 * bottom binding the turning corners are along the outer edge, and `top` is the left one,
 * `bottom` the right.
 */
declare const FlipCorner: {
  readonly top: "top";
  readonly bottom: "bottom";
};
type FlipCorner = (typeof FlipCorner)[keyof typeof FlipCorner];
/** `hard` pages rotate as a rigid sheet (covers); `soft` pages bend along the fold. */
declare const PageDensity: {
  readonly soft: "soft";
  readonly hard: "hard";
};
type PageDensity = (typeof PageDensity)[keyof typeof PageDensity];
/** Which way a page is turning: `forward` reads on, `back` returns to the previous spread. */
declare const FlipDirection: {
  readonly forward: "forward";
  readonly back: "back";
};
type FlipDirection = (typeof FlipDirection)[keyof typeof FlipDirection];
/**
 * Where the spine is. `left` is a book read left to right. `right` is the same book read right
 * to left (a manga): the cover sits on the left, pages turn from the left edge, and a swipe to
 * the right reads on. `top` is a notepad or a wall calendar: pages lift from the bottom edge and
 * turn up. `bottom` is a top-bound book upside down: pages lift from the top edge and turn down,
 * like a flip chart. One geometry, seen from four sides.
 */
declare const Binding: {
  readonly left: "left";
  readonly right: "right";
  readonly top: "top";
  readonly bottom: "bottom";
};
type Binding = (typeof Binding)[keyof typeof Binding];
/** What the book is showing: one page (`portrait`) or a two-page spread (`landscape`). */
declare const Orientation: {
  readonly portrait: "portrait";
  readonly landscape: "landscape";
};
type Orientation = (typeof Orientation)[keyof typeof Orientation];
/** What the book is doing right now. */
declare const FlipState: {
  /** Nothing in motion. */
  readonly read: "read";
  /** A hover cue is showing, because the pointer is where a page can be taken hold of: the edge is furled, or the page that turns back has begun to uncurl over the spine. */
  readonly foldCorner: "fold_corner";
  /** The user is dragging a corner. */
  readonly userFold: "user_fold";
  /** A flip animation is running. */
  readonly flipping: "flipping";
};
type FlipState = (typeof FlipState)[keyof typeof FlipState];
/** How the book sizes itself. */
declare const SizeMode: {
  /** Pages are exactly `width` x `height` CSS pixels. */
  readonly fixed: "fixed";
  /** Pages scale to the container, keeping the `width:height` ratio, between `minWidth` and `maxWidth`. */
  readonly stretch: "stretch";
};
type SizeMode = (typeof SizeMode)[keyof typeof SizeMode];
/**
 * Where a page can be taken hold of. Hover, click and drag all use the same zone, so a corner
 * lifts only where a press would act.
 */
declare const ClickMode: {
  /** The strip along each page's outer edge, a fifth of the page diagonal wide. */
  readonly edges: "edges";
  /** The whole page. */
  readonly anywhere: "anywhere";
  /** Clicks never turn the page; hover and drag still work from the edges. */
  readonly off: "off";
};
type ClickMode = (typeof ClickMode)[keyof typeof ClickMode];
type BookOptions = {
  /** Base page width in CSS pixels. With `size: "stretch"` only the `width:height` ratio matters. */
  readonly width: number;
  /** Base page height in CSS pixels. */
  readonly height: number;
  /** @default "fixed" */
  readonly size?: SizeMode;
  /** Narrowest single page in `stretch` mode. A container narrower than two of these across the spine goes portrait. @default 100 */
  readonly minWidth?: number;
  /** Widest single page in `stretch` mode. @default 2000 */
  readonly maxWidth?: number;
  /** @default "auto" */
  readonly layout?: Layout;
  /** @default "left" */
  readonly binding?: Binding;
  /** Show the first and last pages alone, as hard covers. @default false */
  readonly cover?: boolean;
  /** Zero-based page to open on. @default 0 */
  readonly startPage?: number;
  /** Duration of a full flip in milliseconds. Shorter flips take proportionally less. @default 1000 */
  readonly flipDuration?: number;
  /** Easing for the corner's path, `t` in 0..1. @default linear */
  readonly easing?: (t: number) => number;
  /** @default true */
  readonly shadows?: boolean;
  /** 0 hides shadows, 1 is full strength (the original's look). @default 0.35 */
  readonly shadowOpacity?: number;
  /** Size the container to the book (aspect ratio and max width). @default true */
  readonly autoSize?: boolean;
  /** @default "edges" */
  readonly click?: ClickMode;
  /** Let the pointer drag a page's edge. The fold follows the pointer's travel: pulled straight in it furls the whole edge, pulled from a corner it folds across. @default true */
  readonly drag?: boolean;
  /** Turn the page on a quick touch or pen swipe across the pages (horizontal for a left- or right-bound book, vertical otherwise), from anywhere on it. @default true */
  readonly swipe?: boolean;
  /** Minimum swipe travel in CSS pixels. @default 30 */
  readonly swipeDistance?: number;
  /** Show where a page can be taken hold of when the mouse hovers there: the edge furls, leaning toward the pointer, and in a single-page book the page that turns back uncurls a strip over the spine. @default true */
  readonly hover?: boolean;
  /**
   * Pointer events starting on an element matching this selector never start a flip.
   * `false` turns this off.
   * @default "a, button, input, textarea, select, [data-opf-no-flip]"
   */
  readonly ignoreDragOn?: string | false;
  /** Page elements. @default the container's children */
  readonly pages?: Iterable<HTMLElement>;
};
type ResolvedOptions = Required<Omit<BookOptions, "pages">>;
//#endregion
//#region src/axes.d.ts
type Size = {
  readonly width: number;
  readonly height: number;
};
//#endregion
//#region src/geometry/fold.d.ts
type FoldInput = {
  readonly direction: FlipDirection;
  readonly corner: FlipCorner;
  readonly pageWidth: number;
  readonly pageHeight: number;
  /** Drag point in active-page coordinates: origin at the page's top-left, x grows toward the outer edge. */
  readonly point: Point;
};
/** Where the fold line meets the page edges. A `null` edge is not crossed. */
type FoldIntersections = {
  readonly top: Point | null;
  readonly side: Point | null;
  readonly bottom: Point | null;
};
type Fold = {
  /** Rotation of the flipping page in radians, signed by direction. */
  readonly angle: number;
  /** Where the dragged corner ended up after clamping to what paper can do. */
  readonly position: Point;
  /** 0 at rest, 100 fully turned. */
  readonly progress: number;
  /** Corners of the flipping page after rotation. */
  readonly rect: RectPoints;
  readonly intersections: FoldIntersections;
  /** Visible part of the flipping page, as a polygon in page coordinates. */
  readonly flippingClip: readonly Point[];
  /** Part of the page underneath that the fold reveals. */
  readonly bottomClip: readonly Point[];
  /** Where the flipping page's own origin corner sits. */
  readonly activeCorner: Point;
  readonly bottomPagePosition: Point;
  /** Drop-shadow origin and rotation, or `null` when the fold crosses no usable edges. */
  readonly shadow: {
    readonly start: Point;
    readonly angle: number;
  } | null;
};
/**
 * Returns `null` when the point is degenerate (the corner is at rest, or the fold line would
 * coincide with a page edge). Callers keep the previous fold for that frame, as the original did.
 */
declare function computeFold(input: FoldInput): Fold | null;
//#endregion
//#region src/layout.d.ts
/**
 * Where the book sits inside its container, in book space (see `axes.ts`): container CSS pixels
 * for a left-bound book, mirrored for a right-bound one, x and y swapped for a top-bound one.
 */
type BookRect = {
  readonly left: number;
  readonly top: number;
  /** Always two pages wide, even in portrait, where only the right half is visible. */
  readonly width: number;
  readonly height: number;
  readonly pageWidth: number;
};
type LayoutResult = {
  readonly orientation: Orientation;
  readonly rect: BookRect;
  /** The container as measured on screen, which the renderer needs to place the rect. */
  readonly container: Size;
};
type LayoutOptions = Pick<ResolvedOptions, "size" | "width" | "height" | "minWidth" | "maxWidth" | "layout" | "binding">;
/**
 * Page size and orientation for a container measured on screen. Same arithmetic as the original,
 * so the book lands on the same pixels; `layout` only overrides the "is the container too narrow"
 * decision. Everything is worked out in book space, so for a top- or bottom-bound book "too
 * narrow" means too short for two pages one above the other. With `autoSize` such a container is
 * always one page wide and two tall, so a vertically bound book that sizes itself is a spread
 * unless `layout` says `single`; a host-sized container can be too short, and then it shows one
 * page. A mirror changes nothing here: the book is centred either way.
 */
declare function computeLayout(containerWidth: number, containerHeight: number, options: LayoutOptions): LayoutResult;
//#endregion
//#region src/controller.d.ts
type ShadowData = {
  readonly pos: Point;
  readonly angle: number;
  readonly width: number;
  readonly opacity: number;
  readonly direction: FlipDirection;
  /** 0..200: how far round a hard page has swung, doubled as the original's hard-page shadow curve expects. */
  readonly progress: number;
};
type FlipFrame = {
  /**
   * The direction the fold runs. In portrait a turn back runs forward, as the previous page
   * turning off itself in reverse, with that page as `flipping` and on show as `Frame.right`.
   */
  readonly direction: FlipDirection;
  readonly corner: FlipCorner;
  readonly flipping: number;
  /** The page revealed underneath, or `null` when the turn reveals nothing. */
  readonly bottom: number | null;
  readonly fold: Fold;
  /** How far the fold has come, 0..100, running in `direction`. A turn's own progress is `FlipProgress`. */
  readonly progress: number;
  /** Rotation about the spine for hard pages, in degrees. */
  readonly hardAngle: number;
  readonly shadow: ShadowData | null;
  /**
   * When a jump turns a clump of pages at once, the blank sheets under the turning one, nearest
   * first. Empty for a turn of one page.
   */
  readonly sheets: readonly Sheet[];
};
/** A blank sheet of a clump turning together, under the page turning on top of it. */
type Sheet = {
  /**
   * For a soft page: its flap, in page space. It is pulled a little further over than the one
   * above it, so what shows of it is the edge peeking out from under that one's curl.
   */
  readonly flap: readonly Point[];
  /** For a hard page: how far round it has swung, as `FlipFrame.hardAngle`. */
  readonly hardAngle: number;
};
/** Where a turn is, between the spread it started from and the spread it leads to. */
type FlipProgress = {
  /** First page of the spread on show when the turn began. */
  readonly from: number;
  /** First page of the spread the turn leads to. */
  readonly to: number;
  readonly direction: FlipDirection;
  /**
   * 0 with the page at rest on `from`, 1 with it landed on `to`; in between, how far across the
   * book the page's corner has come, which for a hard page is how far round it has swung. A turn
   * always ends on exactly 0 (dropped back, or cut short) or 1.
   */
  readonly progress: number;
};
/** Everything a renderer needs to draw one moment of the book. */
type Frame = {
  readonly rect: BookRect;
  /** The container the rect sits in, as measured on screen. */
  readonly container: Size;
  readonly orientation: Orientation;
  readonly left: number | null;
  readonly right: number | null;
  readonly flip: FlipFrame | null;
};
//#endregion
//#region src/events.d.ts
type Listener<T> = (event: T) => void;
type Emitter<Events extends Record<string, unknown>> = {
  on<K extends keyof Events>(name: K, listener: Listener<Events[K]>, options?: {
    signal?: AbortSignal;
  }): () => void;
  off<K extends keyof Events>(name: K, listener: Listener<Events[K]>): void;
  emit<K extends keyof Events>(name: K, event: Events[K]): void;
  clear(): void;
};
//#endregion
//#region src/book.d.ts
type BookEvents = {
  /** The book is laid out and showing `startPage`. Fires once, after `createBook` returns. */
  init: {
    readonly page: number;
    readonly orientation: Orientation;
  };
  /** Pages were replaced with `setPages`. */
  update: {
    readonly page: number;
    readonly orientation: Orientation;
  };
  /** A different spread is showing. `page` is the first page of it. */
  flip: {
    readonly page: number;
  };
  /**
   * A page moved: fires as each frame of a turn is drawn, whether the turn is animated, dragged
   * or a hovered edge furling, and once more with `progress` 0 when a turn ends without landing.
   * For anything that should move in step with the page, like a shadow under the book; write it
   * to a style rather than to state.
   */
  flipProgress: FlipProgress;
  changeState: {
    readonly state: FlipState;
  };
  changeOrientation: {
    readonly orientation: Orientation;
  };
};
type Book = {
  /** First page of the open spread, zero-based. */
  readonly page: number;
  readonly pageCount: number;
  readonly orientation: Orientation;
  readonly state: FlipState;
  /** In book space: container pixels for a left-bound book, mirrored or transposed for the others. */
  readonly rect: BookRect;
  on: Emitter<BookEvents>["on"];
  off: Emitter<BookEvents>["off"];
  /** Animated turns. Resolve with `false` when there is nothing to turn to. */
  flipNext(corner?: FlipCorner): Promise<boolean>;
  flipPrev(corner?: FlipCorner): Promise<boolean>;
  /**
   * Turns the page on show straight onto the spread holding `page`. Further than the next spread,
   * it turns as a clump: a few blank sheets, one per spread passed up to five, fan out from under
   * it and close up again before it lands. Only the pages on show and the target are drawn.
   */
  flipTo(page: number, corner?: FlipCorner): Promise<boolean>;
  /** Instant turns. */
  turnTo(page: number): void;
  turnNext(): void;
  turnPrev(): void;
  /** Replace the page elements. Keeps the current page where possible. */
  setPages(pages: Iterable<HTMLElement>): void;
  /** Re-measure the container and redraw. Resizes are handled automatically; call this after other layout changes. */
  update(): void;
  /** Redraw the current frame without measuring, after something else rewrote page attributes. Cheap. */
  redraw(): void;
  /** Stop everything, drop listeners and observers, and restore the DOM. */
  destroy(): void;
};
type CreateBookOptions = BookOptions & {
  /** Time and frame source, replaceable in tests. */
  readonly clock?: Clock;
};
declare function createBook(container: HTMLElement, userOptions: CreateBookOptions): Book;
//#endregion
export { Binding, type Book, type BookEvents, type BookOptions, type BookRect, ClickMode, type Clock, type CreateBookOptions, type Emitter, FlipCorner, FlipDirection, type FlipFrame, type FlipProgress, FlipState, type Fold, type FoldInput, type FoldIntersections, type Frame, Layout, type LayoutOptions, type LayoutResult, type Listener, Orientation, PageDensity, type Point, type Rect, type RectPoints, type ResolvedOptions, type Segment, type ShadowData, type Sheet, type Size, SizeMode, computeFold, computeLayout, createBook };
//# sourceMappingURL=index.d.ts.map