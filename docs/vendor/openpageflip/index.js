//#region src/animation.ts
const browserClock = {
	now: () => performance.now(),
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (handle) => cancelAnimationFrame(handle)
};
/** A single time-based animation. Frames are requested only while it runs. */
function startTween(clock, spec) {
	const startedAt = clock.now();
	let handle = null;
	let done = false;
	const end = () => {
		if (done) return;
		done = true;
		if (handle !== null) clock.cancelFrame(handle);
		handle = null;
		spec.onFrame(1);
		spec.onEnd();
	};
	const tick = (time) => {
		handle = null;
		if (done) return;
		const t = spec.duration <= 0 ? 1 : Math.min(1, Math.max(0, (time - startedAt) / spec.duration));
		if (t >= 1) {
			end();
			return;
		}
		spec.onFrame(spec.easing(t));
		handle = clock.requestFrame(tick);
	};
	if (spec.duration <= 0) end();
	else handle = clock.requestFrame(tick);
	return {
		finish: end,
		cancel: () => {
			done = true;
			if (handle !== null) clock.cancelFrame(handle);
			handle = null;
		}
	};
}
//#endregion
//#region src/options.ts
/**
* Public option vocabularies. Plain `as const` objects instead of enums so they survive
* `isolatedModules`, `erasableSyntaxOnly`, and consumers who only speak string literals.
*/
/**
* How many pages are visible at once. `auto` shows a spread when two pages fit across the
* container (side by side, or one above the other for a top-bound book), else one page.
*/
const Layout = {
	auto: "auto",
	single: "single",
	spread: "spread"
};
/**
* Which corner a programmatic flip lifts. Named for a left- or right-bound book; with a top or
* bottom binding the turning corners are along the outer edge, and `top` is the left one,
* `bottom` the right.
*/
const FlipCorner = {
	top: "top",
	bottom: "bottom"
};
/** `hard` pages rotate as a rigid sheet (covers); `soft` pages bend along the fold. */
const PageDensity = {
	soft: "soft",
	hard: "hard"
};
/** Which way a page is turning: `forward` reads on, `back` returns to the previous spread. */
const FlipDirection = {
	forward: "forward",
	back: "back"
};
/**
* Where the spine is. `left` is a book read left to right. `right` is the same book read right
* to left (a manga): the cover sits on the left, pages turn from the left edge, and a swipe to
* the right reads on. `top` is a notepad or a wall calendar: pages lift from the bottom edge and
* turn up. `bottom` is a top-bound book upside down: pages lift from the top edge and turn down,
* like a flip chart. One geometry, seen from four sides.
*/
const Binding = {
	left: "left",
	right: "right",
	top: "top",
	bottom: "bottom"
};
/** What the book is showing: one page (`portrait`) or a two-page spread (`landscape`). */
const Orientation = {
	portrait: "portrait",
	landscape: "landscape"
};
/** What the book is doing right now. */
const FlipState = {
	/** Nothing in motion. */
	read: "read",
	/** A hover cue is showing, because the pointer is where a page can be taken hold of: the edge is furled, or the page that turns back has begun to uncurl over the spine. */
	foldCorner: "fold_corner",
	/** The user is dragging a corner. */
	userFold: "user_fold",
	/** A flip animation is running. */
	flipping: "flipping"
};
/** How the book sizes itself. */
const SizeMode = {
	/** Pages are exactly `width` x `height` CSS pixels. */
	fixed: "fixed",
	/** Pages scale to the container, keeping the `width:height` ratio, between `minWidth` and `maxWidth`. */
	stretch: "stretch"
};
/**
* Where a page can be taken hold of. Hover, click and drag all use the same zone, so a corner
* lifts only where a press would act.
*/
const ClickMode = {
	/** The strip along each page's outer edge, a fifth of the page diagonal wide. */
	edges: "edges",
	/** The whole page. */
	anywhere: "anywhere",
	/** Clicks never turn the page; hover and drag still work from the edges. */
	off: "off"
};
const DEFAULTS = {
	size: SizeMode.fixed,
	minWidth: 100,
	maxWidth: 2e3,
	layout: Layout.auto,
	binding: Binding.left,
	cover: false,
	startPage: 0,
	flipDuration: 1e3,
	easing: (t) => t,
	shadows: true,
	shadowOpacity: .35,
	autoSize: true,
	click: ClickMode.edges,
	drag: true,
	swipe: true,
	swipeDistance: 30,
	hover: true,
	ignoreDragOn: "a, button, input, textarea, select, [data-opf-no-flip]"
};
function isOneOf(vocabulary, value) {
	return Object.values(vocabulary).some((allowed) => allowed === value);
}
/** Fill in defaults and reject options that could only produce a broken book. */
function resolveOptions(user) {
	const { pages: _pages, ...rest } = user;
	const options = {
		...DEFAULTS,
		...rest
	};
	const positive = (name) => {
		const value = options[name];
		if (!(Number.isFinite(value) && value > 0)) throw new TypeError(`@openpageflip/core: "${name}" must be a positive number, got ${String(value)}`);
	};
	positive("width");
	positive("height");
	positive("flipDuration");
	positive("minWidth");
	positive("maxWidth");
	if (options.maxWidth < options.minWidth) throw new TypeError(`@openpageflip/core: "maxWidth" (${options.maxWidth}) is below "minWidth" (${options.minWidth})`);
	if (!isOneOf(SizeMode, options.size)) throw new TypeError(`@openpageflip/core: unknown "size" ${String(options.size)}`);
	if (!isOneOf(Layout, options.layout)) throw new TypeError(`@openpageflip/core: unknown "layout" ${String(options.layout)}`);
	if (!isOneOf(Binding, options.binding)) throw new TypeError(`@openpageflip/core: unknown "binding" ${String(options.binding)}`);
	if (!isOneOf(ClickMode, options.click)) throw new TypeError(`@openpageflip/core: unknown "click" ${String(options.click)}`);
	if (!(options.shadowOpacity >= 0 && options.shadowOpacity <= 1)) throw new TypeError(`@openpageflip/core: "shadowOpacity" must be within 0..1, got ${options.shadowOpacity}`);
	if (!Number.isInteger(options.startPage) || options.startPage < 0) throw new TypeError(`@openpageflip/core: "startPage" must be a non-negative integer, got ${options.startPage}`);
	if (options.ignoreDragOn !== false) try {
		document.createElement("div").matches(options.ignoreDragOn);
	} catch {
		throw new TypeError(`@openpageflip/core: "ignoreDragOn" is not a valid selector: ${options.ignoreDragOn}`);
	}
	return options;
}
//#endregion
//#region src/coords.ts
/**
* Three coordinate spaces meet here: the container (where pointer events land), the book rect,
* and the active page. Page space has its origin at the page's outer top corner with x growing
* toward the spine, so a backward flip mirrors x.
*/
function containerToBook(pos, rect) {
	return {
		x: pos.x - rect.left,
		y: pos.y - rect.top
	};
}
function containerToPage(pos, rect, direction) {
	return {
		x: direction === FlipDirection.forward ? pos.x - rect.left - rect.width / 2 : rect.width / 2 - pos.x + rect.left,
		y: pos.y - rect.top
	};
}
function pageToContainer(pos, rect, direction) {
	return {
		x: direction === FlipDirection.forward ? pos.x + rect.left + rect.width / 2 : rect.width / 2 - pos.x + rect.left,
		y: pos.y + rect.top
	};
}
//#endregion
//#region src/geometry/point.ts
function distance(a, b) {
	return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}
/** A point mirrored across the line through a segment. */
function reflect(point, [a, b]) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy);
	return {
		x: 2 * (a.x + t * dx) - point.x,
		y: 2 * (a.y + t * dy) - point.y
	};
}
/** Angle between two lines in radians, via the dot product of their normals. */
function angleBetweenLines(one, two) {
	const a1 = one[0].y - one[1].y;
	const a2 = two[0].y - two[1].y;
	const b1 = one[1].x - one[0].x;
	const b2 = two[1].x - two[0].x;
	return Math.acos((a1 * a2 + b1 * b2) / (Math.sqrt(a1 * a1 + b1 * b1) * Math.sqrt(a2 * a2 + b2 * b2)));
}
/** Inclusive containment test. */
function isPointInRect(rect, point) {
	return point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;
}
/** Rotate `point` by `angle` radians (clockwise in screen space) and translate by `origin`. */
function rotatePoint(point, origin, angle) {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return {
		x: point.x * cos + point.y * sin + origin.x,
		y: point.y * cos - point.x * sin + origin.y
	};
}
/**
* The part of a polygon with `x >= minX` (Sutherland–Hodgman against one edge). Empty when
* nothing with any area is left, so a polygon that only touches the line does not survive as a
* sliver.
*/
function clipPolygonToMinX(points, minX) {
	const kept = [];
	let from = points.at(-1);
	if (from === void 0) return kept;
	for (const to of points) {
		if (from.x >= minX !== to.x >= minX) {
			const t = (minX - from.x) / (to.x - from.x);
			kept.push({
				x: minX,
				y: from.y + (to.y - from.y) * t
			});
		}
		if (to.x >= minX) kept.push(to);
		from = to;
	}
	return kept.some((p) => p.x > minX) ? kept : [];
}
/**
* Keep `point` inside the circle around `center`. Returns the very same object when it is
* already inside, so callers can detect clamping by identity.
*
* Quirk kept from the original: when the point is left of the y axis the whole x result is
* negated (not mirrored around the center), and a degenerate line falls back to `y = radius`.
*/
function clampToCircle(center, radius, point) {
	if (distance(center, point) <= radius) return point;
	const a = center.x;
	const b = center.y;
	const n = point.x;
	const m = point.y;
	let x = Math.sqrt(radius ** 2 * (a - n) ** 2 / ((a - n) ** 2 + (b - m) ** 2)) + a;
	if (point.x < 0) x *= -1;
	let y = (x - a) * (b - m) / (a - n) + b;
	if (a - n + b === 0) y = radius;
	return {
		x,
		y
	};
}
/** Two lines are the same line, so they have no single intersection point. */
const Collinear = Symbol("collinear");
/**
* Intersection of two infinite lines: a point, `null` when parallel, or `Collinear` when they
* coincide. The fold calculation treats `Collinear` as "this pointer position is degenerate".
*/
function intersectLines(one, two) {
	const a1 = one[0].y - one[1].y;
	const a2 = two[0].y - two[1].y;
	const b1 = one[1].x - one[0].x;
	const b2 = two[1].x - two[0].x;
	const c1 = one[0].x * one[1].y - one[1].x * one[0].y;
	const c2 = two[0].x * two[1].y - two[1].x * two[0].y;
	const x = -((c1 * b2 - c2 * b1) / (a1 * b2 - a2 * b1));
	const y = -((a1 * c2 - a2 * c1) / (a1 * b2 - a2 * b1));
	if (Number.isFinite(x) && Number.isFinite(y)) return {
		x,
		y
	};
	const det1 = a1 * c2 - a2 * c1;
	const det2 = b1 * c2 - b2 * c1;
	return Math.abs(det1 - det2) < .1 ? Collinear : null;
}
/** `intersectLines`, additionally dropping a hit that lands outside `bounds`. */
function intersectLinesWithin(bounds, one, two) {
	const hit = intersectLines(one, two);
	if (hit === null || hit === Collinear) return hit;
	return isPointInRect(bounds, hit) ? hit : null;
}
//#endregion
//#region src/geometry/fold.ts
/**
* The fold: where a page lands when its corner is dragged to a point.
*
* A pure function of the drag point and the page size. This is the kernel that StPageFlip
* users came for; it derives from `FlipCalculation` (MIT, Oleg Litovski) with the same output
* for the same input, checked by the parity tests. Differences are deliberate: numbers instead
* of strings for the page size (so fractional layouts stay exact), a result instead of thrown
* errors for degenerate positions, and no `null` entries inside clip polygons.
*/
/**
* Returns `null` when the point is degenerate (the corner is at rest, or the fold line would
* coincide with a page edge). Callers keep the previous fold for that frame, as the original did.
*/
function computeFold(input) {
	const { direction, corner, pageWidth, pageHeight } = input;
	const positioned = resolvePosition(input);
	if (positioned === null) return null;
	const { position, angle, rect } = positioned;
	const intersections = intersect(input, position, rect);
	if (intersections === null) return null;
	const { top, side, bottom } = intersections;
	const flippingClip = [rect.topLeft];
	if (top) flippingClip.push(top);
	let clipBottom = false;
	if (side === null) clipBottom = true;
	else flippingClip.push(side);
	if (bottom) flippingClip.push(bottom);
	if (clipBottom || corner === FlipCorner.bottom) flippingClip.push(rect.bottomLeft);
	const bottomClip = [];
	if (top) bottomClip.push(top);
	if (corner === FlipCorner.top) bottomClip.push({
		x: pageWidth,
		y: 0
	});
	else {
		if (top !== null) bottomClip.push({
			x: pageWidth,
			y: 0
		});
		bottomClip.push({
			x: pageWidth,
			y: pageHeight
		});
	}
	if (side !== null) {
		if (top === null || distance(side, top) >= 10) bottomClip.push(side);
	} else if (corner === FlipCorner.top) bottomClip.push({
		x: pageWidth,
		y: pageHeight
	});
	if (bottom) bottomClip.push(bottom);
	if (top) bottomClip.push(top);
	const shadowStart = corner === FlipCorner.top ? top : side ?? top;
	const shadowEnd = shadowStart !== side && side !== null ? side : bottom;
	let shadow = null;
	if (shadowStart !== null && shadowEnd !== null) {
		const raw = angleBetweenLines([shadowStart, shadowEnd], [{
			x: 0,
			y: 0
		}, {
			x: pageWidth,
			y: 0
		}]);
		shadow = {
			start: shadowStart,
			angle: direction === FlipDirection.forward ? raw : Math.PI - raw
		};
	}
	return {
		angle: direction === FlipDirection.forward ? -angle : angle,
		position,
		progress: Math.abs((position.x - pageWidth) / (2 * pageWidth) * 100),
		rect,
		intersections,
		flippingClip,
		bottomClip,
		activeCorner: direction === FlipDirection.forward ? rect.topLeft : rect.topRight,
		bottomPagePosition: direction === FlipDirection.back ? {
			x: pageWidth,
			y: 0
		} : {
			x: 0,
			y: 0
		},
		shadow
	};
}
/** Clamp the drag point to what the paper allows and derive the page rotation from it. */
function resolvePosition(input) {
	const { corner, pageWidth, pageHeight } = input;
	let position = input.point;
	let geometry = angleAndRect(input, position);
	if (geometry === null) return null;
	const spineNear = corner === FlipCorner.top ? {
		x: 0,
		y: 0
	} : {
		x: 0,
		y: pageHeight
	};
	const spineFar = corner === FlipCorner.top ? {
		x: 0,
		y: pageHeight
	} : {
		x: 0,
		y: 0
	};
	const clamped = clampToCircle(spineNear, pageWidth, position);
	if (clamped !== position) {
		position = clamped;
		geometry = angleAndRect(input, position);
		if (geometry === null) return null;
	}
	const crossed = corner === FlipCorner.top ? geometry.rect.bottomRight : geometry.rect.topRight;
	const opposite = corner === FlipCorner.top ? geometry.rect.topLeft : geometry.rect.bottomLeft;
	if (crossed.x <= 0) {
		position = clampToCircle(spineFar, Math.sqrt(pageWidth ** 2 + pageHeight ** 2), opposite);
		geometry = angleAndRect(input, position);
		if (geometry === null) return null;
	}
	if (Math.abs(position.x - pageWidth) < 1 && Math.abs(position.y) < 1) return null;
	return {
		position,
		...geometry
	};
}
function angleAndRect(input, position) {
	const angle = foldAngle(input, position);
	if (angle === null) return null;
	return {
		angle,
		rect: pageRect(input, position, angle)
	};
}
/** Rotation that puts the page corner at `position`, folded around the crease. */
function foldAngle(input, position) {
	const { corner, pageWidth, pageHeight } = input;
	const left = pageWidth - position.x + 1;
	const top = corner === FlipCorner.bottom ? pageHeight - position.y : position.y;
	let angle = 2 * Math.acos(left / Math.sqrt(top * top + left * left));
	if (top < 0) angle = -angle;
	const flat = Math.PI - angle;
	if (!Number.isFinite(angle) || flat >= 0 && flat < .003) return null;
	return corner === FlipCorner.bottom ? -angle : angle;
}
function pageRect(input, position, angle) {
	const { corner, pageWidth, pageHeight } = input;
	const dy = corner === FlipCorner.top ? 0 : -pageHeight;
	return {
		topLeft: rotatePoint({
			x: 0,
			y: dy
		}, position, angle),
		topRight: rotatePoint({
			x: pageWidth,
			y: dy
		}, position, angle),
		bottomLeft: rotatePoint({
			x: 0,
			y: dy + pageHeight
		}, position, angle),
		bottomRight: rotatePoint({
			x: pageWidth,
			y: dy + pageHeight
		}, position, angle)
	};
}
/** Where the fold line and the page's far edge cross the page borders. `null` when degenerate. */
function intersect(input, position, rect) {
	const { corner, pageWidth, pageHeight } = input;
	const bounds = {
		left: -1,
		top: -1,
		width: pageWidth + 2,
		height: pageHeight + 2
	};
	const topEdge = [{
		x: 0,
		y: 0
	}, {
		x: pageWidth,
		y: 0
	}];
	const rightEdge = [{
		x: pageWidth,
		y: 0
	}, {
		x: pageWidth,
		y: pageHeight
	}];
	const bottomEdge = [{
		x: 0,
		y: pageHeight
	}, {
		x: pageWidth,
		y: pageHeight
	}];
	const top = corner === FlipCorner.top ? intersectLinesWithin(bounds, [position, rect.topRight], topEdge) : intersectLinesWithin(bounds, [rect.topLeft, rect.topRight], topEdge);
	const side = corner === FlipCorner.top ? intersectLinesWithin(bounds, [position, rect.bottomLeft], rightEdge) : intersectLinesWithin(bounds, [position, rect.topLeft], rightEdge);
	const bottom = intersectLinesWithin(bounds, [rect.bottomLeft, rect.bottomRight], bottomEdge);
	if (top === Collinear || side === Collinear || bottom === Collinear) return null;
	return {
		top,
		side,
		bottom
	};
}
//#endregion
//#region src/pagination.ts
function buildSpreads(pageCount, orientation, cover) {
	const hardByPosition = /* @__PURE__ */ new Set();
	const landscape = [];
	let start = 0;
	if (cover && pageCount > 0) {
		hardByPosition.add(0);
		landscape.push([0]);
		start = 1;
	}
	for (let i = start; i < pageCount; i += 2) if (i < pageCount - 1) landscape.push([i, i + 1]);
	else {
		landscape.push([i]);
		hardByPosition.add(i);
	}
	const portrait = Array.from({ length: pageCount }, (_, i) => [i]);
	return {
		spreads: orientation === Orientation.portrait ? portrait : landscape,
		hardByPosition
	};
}
function spreadIndexOfPage(spreads, page) {
	const index = spreads.findIndex((spread) => spread[0] === page || spread[1] === page);
	return index === -1 ? null : index;
}
/** Pages lying flat on the left and right for a spread. */
function staticPages(spreads, orientation, spreadIndex, pageCount) {
	const spread = spreads[spreadIndex];
	if (spread === void 0) return {
		left: null,
		right: null
	};
	if (spread.length === 2) return {
		left: spread[0],
		right: spread[1]
	};
	if (orientation === Orientation.landscape && spread[0] === pageCount - 1) return {
		left: spread[0],
		right: null
	};
	return {
		left: null,
		right: spread[0]
	};
}
/**
* The page that lifts (its back face is what the viewer sees mid-flip), the page revealed
* underneath it (`null` when the turn reveals nothing: a turn onto a page shown alone), and the
* first page of the spread the turn leads `to`. `null` when there is no spread in that direction.
*/
function flipPages(spreads, orientation, spreadIndex, direction) {
	const forward = direction === FlipDirection.forward;
	const target = spreads[forward ? spreadIndex + 1 : spreadIndex - 1];
	if (target === void 0) return null;
	const to = target[0];
	if (orientation === Orientation.portrait) {
		const current = spreads[spreadIndex]?.[0];
		if (current === void 0) return null;
		return forward ? {
			flipping: current,
			bottom: to,
			to
		} : {
			flipping: to,
			bottom: current,
			to
		};
	}
	if (target.length === 1) return {
		flipping: to,
		bottom: null,
		to
	};
	return forward ? {
		flipping: target[0],
		bottom: target[1],
		to
	} : {
		flipping: target[1],
		bottom: target[0],
		to
	};
}
//#endregion
//#region src/controller.ts
/**
* The headless heart of the book: which spread is open, what a pointer is doing to a page, and
* where the flip animation is. It knows nothing about the DOM; it hands `Frame`s to a renderer.
* The behaviour (drop thresholds, animation paths) is the original's, so the book feels the
* same. Two things are ours: hover, click and drag all act on the same zone (see `isHandle`), so
* the cue never promises what a press would not do; and the cue is the whole edge furling, which
* a drag then carries on from, moving the fold by the pointer's travel.
*/
/** Pointer travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 5;
/**
* How deep a hover cue folds: the crease sits this far in from the edge it is hovering, the page's
* outer edge or, for a reversed turn, the spine.
*/
const FURL = 30;
/**
* How far a hover cue's crease tilts toward the pointer: this much deeper at the end of the edge
* the pointer is at, as much shallower at the other. Midway along the edge it is parallel.
*/
const TILT = 15;
/**
* Where a corner sits when a fold starts from rest: `in` from the edge and `down` it. Exactly at
* rest the fold is degenerate (the crease would lie on the edge), and the kernel treats anything
* within a pixel of it as rest, so `in` is that pixel. `down` gives a fold reached by pulling
* straight in a whisker of tilt, under three pixels of drift across a page at furl depth.
* Exported so the parity suite can start its drags from the same point.
*/
const REST_NUDGE = {
	in: 1,
	down: .5
};
/** A jump turns this many sheets at most, one per spread it passes. */
const MOST_SHEETS = 5;
/**
* How far along the edge each soft sheet of a clump folds past the one above it at its widest, in
* pixels, where the fold meets the edge of the lifted corner. Its corner peeks out about twice as
* far.
*/
const SHEET_GAP = 3.5;
/**
* How much more each deeper soft sheet curls under: this many pixels times the square of how deep
* it lies, on top of `SHEET_GAP`, so the edges splay out rather than lying evenly apart.
*/
const SHEET_CURL = 1.25;
/** How far behind each sheet of a hard clump swings at its widest, in `progress` (0..100). */
const BOARD_LAG = 1.2;
/** How far into a turn (`progress`, 0..100) a clump has closed up again, well before it lands. */
const CLUMP_CLOSED = 80;
/** Animation paths longer than this take the full `flipDuration`; shorter ones scale down. */
const FULL_FLIP_LENGTH = 1e3;
/**
* No animation is shorter than this fraction of `flipDuration`, however short its path. Scaled
* alone, a furled edge settling back 60px would take 60ms: a snap, not a settle. The original
* snapped its hovered corner the same way.
*/
const SHORTEST_FLIP = .25;
/** The direction a session's fold is computed in: its own, except a reversed turn runs forward. */
function foldDirection(session) {
	return session.reversed ? FlipDirection.forward : session.direction;
}
var FlipController = class {
	pages;
	spreads = [];
	spreadIndex = 0;
	currentPage = 0;
	orientation;
	rect;
	container;
	left = null;
	right = null;
	state = FlipState.read;
	session = null;
	tween = null;
	/** Settles the promise of the running animation when it is cut short. */
	settleTween = null;
	pressStart = null;
	dragged = false;
	/** Where the fold was when a drag took hold of it, in page space; the drag moves it from here. */
	dragBase = null;
	/** What the host was last told about a turn, so each change is told once and every turn is closed. */
	reported = null;
	options;
	clock;
	hooks;
	constructor(options, clock, hooks, pages, layout) {
		this.options = options;
		this.clock = clock;
		this.hooks = hooks;
		this.pages = pages;
		this.orientation = layout.orientation;
		this.rect = layout.rect;
		this.container = layout.container;
		this.rebuildSpreads();
	}
	get page() {
		return this.currentPage;
	}
	get pageCount() {
		return this.pages.length;
	}
	get currentState() {
		return this.state;
	}
	get currentOrientation() {
		return this.orientation;
	}
	get bookRect() {
		return this.rect;
	}
	setPages(pages) {
		this.drop();
		this.pages = pages;
		this.rebuildSpreads();
		this.showPage(Math.min(this.currentPage, Math.max(0, pages.length - 1)));
	}
	/** Returns true when the orientation changed, which re-paginates the book. */
	setLayout(layout) {
		const resized = layout.rect.pageWidth !== this.rect.pageWidth || layout.rect.height !== this.rect.height;
		this.rect = layout.rect;
		this.container = layout.container;
		const orientationChanged = layout.orientation !== this.orientation;
		if (resized && !orientationChanged) this.drop();
		if (orientationChanged) {
			this.drop();
			this.orientation = layout.orientation;
			this.rebuildSpreads();
		}
		this.showPage(this.currentPage);
		return orientationChanged;
	}
	/** End any turn and put the book at rest, as a change of pages or size does mid-flip. */
	drop() {
		this.endSession();
		this.setState(FlipState.read);
	}
	rebuildSpreads() {
		const { spreads, hardByPosition } = buildSpreads(this.pages.length, this.orientation, this.options.cover);
		this.spreads = spreads;
		for (const [index, page] of this.pages.entries()) if (hardByPosition.has(index)) {
			page.density = PageDensity.hard;
			page.drawingDensity = PageDensity.hard;
		}
	}
	showPage(page) {
		const index = spreadIndexOfPage(this.spreads, page);
		if (index === null) throw new RangeError(`@openpageflip/core: page ${page} is out of range (0..${this.pages.length - 1})`);
		this.spreadIndex = index;
		this.showSpread();
	}
	showNext() {
		if (this.spreadIndex < this.spreads.length - 1) {
			this.spreadIndex++;
			this.showSpread();
		}
	}
	showPrev() {
		if (this.spreadIndex > 0) {
			this.spreadIndex--;
			this.showSpread();
		}
	}
	showSpread() {
		const { left, right } = staticPages(this.spreads, this.orientation, this.spreadIndex, this.pages.length);
		this.left = left;
		this.right = right;
		const spread = this.spreads[this.spreadIndex];
		const page = spread === void 0 ? this.currentPage : spread[0];
		const changed = page !== this.currentPage;
		this.currentPage = page;
		this.render();
		if (changed) this.hooks.onPage(page);
	}
	flipNext(corner) {
		return this.flipFrom(this.outerEdge(FlipDirection.forward, corner));
	}
	flipPrev(corner) {
		return this.flipFrom(this.outerEdge(FlipDirection.back, corner));
	}
	/** Where a click on a page's outer edge would be, at the given corner. */
	outerEdge(direction, corner) {
		return {
			x: direction === FlipDirection.forward ? this.rect.left + this.rect.pageWidth * 2 - 10 : this.rect.left + 10,
			y: corner === FlipCorner.top ? 1 : this.rect.height - 2
		};
	}
	/**
	* Jumps to the spread beside the target without animation, then animates the last turn. The
	* static pages keep showing the current spread until that turn lands, so the page on show turns
	* straight onto the target. Past more than one spread it turns as a clump: a few sheets, one per
	* spread passed up to `MOST_SHEETS`, that fan out behind it (see `clumpSheets`).
	*/
	flipTo(page, corner) {
		this.tween?.finish();
		const target = spreadIndexOfPage(this.spreads, page);
		if (target === null || target === this.spreadIndex) return Promise.resolve(false);
		const passed = Math.abs(target - this.spreadIndex);
		const clump = passed > 1 ? Math.min(MOST_SHEETS, passed) : 0;
		const direction = target > this.spreadIndex ? FlipDirection.forward : FlipDirection.back;
		this.spreadIndex = direction === FlipDirection.forward ? target - 1 : target + 1;
		this.syncCurrentPage();
		return this.flipFrom(this.outerEdge(direction, corner), clump);
	}
	syncCurrentPage() {
		const spread = this.spreads[this.spreadIndex];
		if (spread !== void 0) this.currentPage = spread[0];
	}
	/** Full animated flip starting at a container point, as a click would, carrying `clump` sheets with it. */
	flipFrom(containerPos, clump = 0) {
		if (this.session !== null) this.tween?.finish();
		const held = this.session;
		const session = this.start(containerPos);
		if (session === null) return Promise.resolve(false);
		session.clump = clump;
		this.setState(FlipState.flipping);
		const margin = session.pageHeight / 10;
		const home = this.home(session);
		const from = (held !== null && held.direction === session.direction && held.corner === session.corner ? held.fold : null)?.position ?? {
			x: home.x - Math.sign(home.x) * margin,
			y: session.corner === FlipCorner.bottom ? home.y - margin : margin
		};
		this.applyFold(from);
		return this.animateTo(from, this.away(session), true, true);
	}
	/**
	* Let go of a fold: the turn completes if the corner crossed the spine on its way `away`,
	* otherwise it drops back `home`.
	*/
	release() {
		const session = this.session;
		if (session === null || session.fold === null) return Promise.resolve(false);
		const pos = session.fold.position;
		const turns = session.reversed ? pos.x >= 0 : pos.x <= 0;
		return this.animateTo(pos, turns ? this.away(session) : this.home(session), turns, true);
	}
	/**
	* Resolves with whether the page turned. A cancelled animation resolves with `false`. A `to`
	* function is read every frame, so a hover cue can follow the pointer on its way in.
	*/
	animateTo(from, to, turn, reset) {
		this.tween?.finish();
		const target = typeof to === "function" ? to : () => to;
		const initial = target();
		const length = Math.max(Math.abs(initial.x - from.x), Math.abs(initial.y - from.y));
		const duration = Math.max(SHORTEST_FLIP, Math.min(1, length / FULL_FLIP_LENGTH)) * this.options.flipDuration;
		return new Promise((resolve) => {
			this.settleTween = resolve;
			this.tween = startTween(this.clock, {
				duration,
				easing: this.options.easing,
				onFrame: (t) => {
					const { x, y } = target();
					this.applyFold({
						x: from.x + (x - from.x) * t,
						y: from.y + (y - from.y) * t
					});
				},
				onEnd: () => {
					this.tween = null;
					this.settleTween = null;
					const session = this.session;
					if (session === null) {
						resolve(false);
						return;
					}
					if (turn) {
						session.landed = true;
						if (session.direction === FlipDirection.back) this.showPrev();
						else this.showNext();
					}
					if (reset) {
						this.endSession();
						this.setState(FlipState.read);
						this.render();
					}
					resolve(turn);
				}
			});
		});
	}
	/** Mouse moving over the book without a button down. */
	hover(containerPos) {
		if (this.state !== FlipState.read && this.state !== FlipState.foldCorner) return;
		const current = this.session;
		if (current !== null) {
			const bookPos = containerToBook(containerPos, this.rect);
			if (this.isHandle(containerPos) && this.directionAt(bookPos) === current.direction) {
				if (this.state !== FlipState.foldCorner) return;
				current.lean = this.leanAt(containerPos, current);
				if (this.tween === null) this.applyFold(this.cuePoint(current));
				return;
			}
			if (this.state === FlipState.foldCorner) {
				this.setState(FlipState.read);
				this.stopTween();
				this.release();
			}
			return;
		}
		if (!this.isPressable(containerPos)) return;
		const session = this.start(containerPos);
		if (session === null) return;
		this.setState(FlipState.foldCorner);
		session.lean = this.leanAt(containerPos, session);
		const from = this.startPoint(session);
		this.applyFold(from);
		this.animateTo(from, () => this.cuePoint(session), false, false);
	}
	/** Where along the edge the pointer is, as `Session.lean` counts it. */
	leanAt(containerPos, session) {
		const { y } = containerToPage(containerPos, this.rect, foldDirection(session));
		return 1 - 2 * Math.min(1, Math.max(0, y / session.pageHeight));
	}
	/**
	* Where the corner is before the turn: at rest on the page's outer edge, or for a reversed turn
	* fully turned, a page's width past the spine.
	*/
	home(session) {
		return {
			x: session.reversed ? -session.pageWidth : session.pageWidth,
			y: session.corner === FlipCorner.bottom ? session.pageHeight : 0
		};
	}
	/** Where the corner is once the turn is made: `home` across the spine. */
	away(session) {
		const home = this.home(session);
		return {
			x: -home.x,
			y: home.y
		};
	}
	/** `home`, nudged in and down by `REST_NUDGE` so the fold is not degenerate. */
	startPoint(session) {
		const home = this.home(session);
		const { in: x, down: y } = REST_NUDGE;
		return {
			x: home.x - Math.sign(home.x) * x,
			y: session.corner === FlipCorner.bottom ? home.y - y : y
		};
	}
	/**
	* Where the corner goes for a hover cue: folded over a crease `FURL` px in from the edge being
	* hovered, so the page furls at its outer edge or, reversed, uncurls a strip over the spine.
	* The crease tilts by the lean, so the fold is deeper at the pointer's end of the edge. The
	* corner is nudged in like `startPoint`, so the fold is not degenerate when it is parallel.
	*/
	cuePoint(session) {
		const { pageWidth: w, pageHeight: h, reversed } = session;
		const crease = reversed ? FURL : w - FURL;
		const tilt = TILT * session.lean * (reversed ? 1 : -1);
		const bottom = session.corner === FlipCorner.bottom;
		const { x, y } = reflect({
			x: w,
			y: bottom ? h : 0
		}, [{
			x: crease + tilt,
			y: 0
		}, {
			x: crease - tilt,
			y: h
		}]);
		return {
			x,
			y: y + (bottom ? -REST_NUDGE.down : REST_NUDGE.down)
		};
	}
	/** The mouse left the book: let a furled edge settle. */
	hoverEnd() {
		if (this.state !== FlipState.foldCorner) return;
		this.setState(FlipState.read);
		this.stopTween();
		this.release();
	}
	/**
	* Returns whether the press took hold of a page: it can click or drag a corner, so the caller
	* should keep the browser's own selection away from it. A press elsewhere is still tracked, so
	* a swipe can start anywhere, but it never clicks or folds.
	*/
	pointerDown(containerPos) {
		if (this.state === FlipState.flipping) this.tween?.finish();
		this.pressStart = containerPos;
		this.dragged = false;
		this.dragBase = null;
		return this.isPressable(containerPos);
	}
	/**
	* A pressed pointer moved. Starts a drag once it travels past the click threshold. The fold
	* moves by the pointer's travel from where it was when the drag took hold: pulled straight in
	* from anywhere on the edge, the whole edge furls; pulled from a corner, it folds across.
	*/
	pointerDrag(containerPos) {
		if (this.pressStart === null) return;
		if (!this.dragged && distance(this.pressStart, containerPos) <= DRAG_THRESHOLD) return;
		this.dragged = true;
		if (!this.options.drag || !this.isHandle(this.pressStart)) return;
		if (this.dragBase === null) {
			const held = this.session;
			const heldFold = held?.fold ?? null;
			const session = this.start(this.pressStart);
			if (session === null) return;
			const start = this.startPoint(session);
			this.dragBase = held === null || heldFold === null || held.direction !== session.direction ? start : held.corner === session.corner ? heldFold.position : {
				x: heldFold.position.x,
				y: start.y
			};
			this.setState(FlipState.userFold);
		}
		const session = this.session;
		if (session === null) return;
		const from = containerToPage(this.pressStart, this.rect, foldDirection(session));
		const to = containerToPage(containerPos, this.rect, foldDirection(session));
		const gain = session.reversed ? 2 : 1;
		this.applyFold({
			x: this.dragBase.x + gain * (to.x - from.x),
			y: this.dragBase.y + gain * (to.y - from.y)
		});
	}
	/** The pointer was released. A press without a drag is a click. */
	pointerUp(containerPos) {
		if (this.pressStart === null) return;
		this.pressStart = null;
		this.dragBase = null;
		if (this.dragged) {
			this.release();
			return;
		}
		this.click(containerPos);
	}
	/** The browser took the pointer (a scroll, for instance): drop the fold, no click. */
	pointerCancel() {
		if (this.pressStart === null) return;
		this.pressStart = null;
		this.dragBase = null;
		if (this.dragged) this.release();
	}
	/** A quick horizontal swipe: turn the page the swipe points at. */
	swipe(direction, corner) {
		this.pressStart = null;
		const session = this.session;
		if (session !== null && session.fold !== null) {
			if (session.direction !== direction) return this.release();
			return this.animateTo(session.fold.position, this.away(session), true, true);
		}
		return direction === FlipDirection.forward ? this.flipNext(corner) : this.flipPrev(corner);
	}
	click(containerPos) {
		if (this.options.click === ClickMode.off || !this.isHandle(containerPos)) return;
		this.flipFrom(containerPos);
	}
	/** Decide direction and corner from where the pointer is, and pick the pages that move. */
	start(containerPos) {
		this.endSession();
		const bookPos = containerToBook(containerPos, this.rect);
		const direction = this.directionAt(bookPos);
		const corner = this.cornerAt(bookPos);
		if (!(direction === FlipDirection.forward ? this.currentPage < this.pages.length - 1 : this.currentPage >= 1)) return null;
		const pair = flipPages(this.spreads, this.orientation, this.spreadIndex, direction);
		if (pair === null) return null;
		if (this.orientation === Orientation.landscape) {
			const flipping = this.pages[pair.flipping];
			const neighbour = this.pages[direction === FlipDirection.back ? pair.flipping + 1 : pair.flipping - 1];
			if (flipping !== void 0 && neighbour !== void 0 && flipping.density !== neighbour.density) {
				flipping.drawingDensity = PageDensity.hard;
				neighbour.drawingDensity = PageDensity.hard;
			}
		}
		this.session = {
			direction,
			corner,
			flipping: pair.flipping,
			bottom: pair.bottom,
			from: this.left ?? this.right ?? this.currentPage,
			to: pair.to,
			pageWidth: this.rect.pageWidth,
			pageHeight: this.rect.height,
			reversed: this.orientation === Orientation.portrait && direction === FlipDirection.back,
			lean: 0,
			fold: null,
			progress: 0,
			hardAngle: 0,
			shadow: null,
			landed: false,
			clump: 0,
			sheets: []
		};
		return this.session;
	}
	/** Stop the running animation where it is, settling its promise with "did not turn". */
	stopTween() {
		this.tween?.cancel();
		this.tween = null;
		this.settleTween?.(false);
		this.settleTween = null;
	}
	endSession() {
		this.stopTween();
		this.session = null;
		for (const page of this.pages) page.drawingDensity = page.density;
	}
	/** Move the lifted corner to a page-space point. Degenerate points keep the previous fold. */
	applyFold(pagePos) {
		const session = this.session;
		if (session === null) return;
		const fold = computeFold({
			direction: foldDirection(session),
			corner: session.corner,
			pageWidth: session.pageWidth,
			pageHeight: session.pageHeight,
			point: pagePos
		});
		if (fold === null) return;
		const { progress } = fold;
		session.fold = fold;
		session.progress = progress;
		const swing = this.orientation === Orientation.portrait ? progress / 2 : progress;
		session.hardAngle = this.hardAngleAt(session, progress);
		const turned = session.reversed ? 100 - progress : progress;
		session.shadow = this.options.shadows && fold.shadow !== null ? {
			pos: fold.shadow.start,
			angle: fold.shadow.angle,
			width: session.pageWidth * 3 / 4 * (turned / 100),
			opacity: (100 - turned) * (100 * this.options.shadowOpacity) / 100 / 100,
			direction: foldDirection(session),
			progress: swing * 2
		} : null;
		session.sheets = this.clumpSheets(session, fold);
		this.render();
	}
	/** A hard page's angle about the spine at `progress` (0..100) of its turn. */
	hardAngleAt(session, progress) {
		const swing = this.orientation === Orientation.portrait ? progress / 2 : progress;
		return (foldDirection(session) === FlipDirection.forward ? 90 : -90) * ((200 - swing * 2) / 100);
	}
	/**
	* The blank sheets of a clump turning together. They fan out as the clump gets going, widest
	* two fifths of the way over, and have closed up again by `CLUMP_CLOSED`, so it lands as one.
	* The clump folds over as a whole, so under the page on top each soft sheet folds a little
	* further over than the one above it, and curls a little further under (`SHEET_CURL`): its flap
	* peeks out along that one's curled edge, most at the corner and tapering to nothing at the far
	* end of the fold. A hard one swings a little behind.
	*/
	clumpSheets(session, lead) {
		if (session.clump === 0) return [];
		const { pageWidth: w, pageHeight: h, corner } = session;
		const fan = Math.sin(Math.PI * Math.min(1, lead.progress / CLUMP_CLOSED));
		const lifted = {
			x: w,
			y: corner === FlipCorner.bottom ? h : 0
		};
		const { top, side, bottom } = lead.intersections;
		const near = corner === FlipCorner.bottom ? bottom : top;
		const far = corner === FlipCorner.bottom ? top ?? side : bottom ?? side;
		const sheets = [];
		for (let sheet = 1; sheet <= session.clump; sheet++) {
			const along = fan * (SHEET_GAP * sheet + SHEET_CURL * sheet * sheet);
			const moved = near === null || far === null ? null : {
				to: reflect(lifted, [{
					x: Math.max(1, near.x - along),
					y: near.y
				}, far]),
				from: reflect(lifted, [near, far])
			};
			const fold = moved === null ? null : computeFold({
				direction: foldDirection(session),
				corner,
				pageWidth: w,
				pageHeight: h,
				point: {
					x: lead.position.x + moved.to.x - moved.from.x,
					y: lead.position.y + moved.to.y - moved.from.y
				}
			});
			sheets.push({
				flap: fold?.flippingClip ?? [],
				hardAngle: this.hardAngleAt(session, Math.max(0, lead.progress - BOARD_LAG * sheet * fan))
			});
		}
		return sheets;
	}
	directionAt(bookPos) {
		if (this.orientation === Orientation.portrait) return bookPos.x - this.rect.pageWidth <= this.rect.width / 5 ? FlipDirection.back : FlipDirection.forward;
		return bookPos.x < this.rect.width / 2 ? FlipDirection.back : FlipDirection.forward;
	}
	cornerAt(bookPos) {
		return bookPos.y >= this.rect.height / 2 ? FlipCorner.bottom : FlipCorner.top;
	}
	/** How far from a page's outer edge, or a corner, still counts: the original's corner reach. */
	get reach() {
		const { pageWidth, height } = this.rect;
		return Math.sqrt(pageWidth ** 2 + height ** 2) / 5;
	}
	/** Book-space x where the visible pages start: in portrait only the right half is shown. */
	get visibleLeft() {
		return this.orientation === Orientation.portrait ? this.rect.pageWidth : 0;
	}
	isOnPage(bookPos) {
		const { width, height } = this.rect;
		return bookPos.x > this.visibleLeft && bookPos.x < width && bookPos.y > 0 && bookPos.y < height;
	}
	/** The strip along each visible page's outer edge, the full height of the page. */
	isOnEdge(bookPos) {
		return bookPos.x < this.visibleLeft + this.reach || bookPos.x > this.rect.width - this.reach;
	}
	/**
	* Whether a point is where a page can be taken hold of: the edge strip, or with
	* `click: "anywhere"` the whole page. Hover, click and drag all ask this one question, so a
	* lifted corner never promises what a press would not do.
	*/
	isHandle(containerPos) {
		const p = containerToBook(containerPos, this.rect);
		return this.isOnPage(p) && (this.options.click === ClickMode.anywhere || this.isOnEdge(p));
	}
	/** A handle where a press can actually do something: click, drag, or both. Hover furls nothing elsewhere. */
	isPressable(containerPos) {
		return this.isHandle(containerPos) && (this.options.drag || this.options.click !== ClickMode.off);
	}
	setState(state) {
		if (this.state === state) return;
		this.state = state;
		this.hooks.onState(state);
	}
	frame() {
		const session = this.session;
		const folded = session !== null && session.fold !== null ? session : null;
		return {
			rect: this.rect,
			container: this.container,
			orientation: this.orientation,
			left: this.left,
			right: folded?.reversed ? folded.flipping : this.right,
			flip: folded !== null && folded.fold !== null ? {
				direction: foldDirection(folded),
				corner: folded.corner,
				flipping: folded.flipping,
				bottom: folded.bottom,
				fold: folded.fold,
				progress: folded.progress,
				hardAngle: folded.hardAngle,
				shadow: folded.shadow,
				sheets: folded.sheets
			} : null
		};
	}
	/** Hand the current frame to the renderer again, after something else touched the DOM. */
	redraw() {
		this.render();
	}
	render() {
		this.hooks.onFrame(this.frame());
		this.reportProgress();
	}
	/**
	* Progress is read off what was just drawn, so it cannot disagree with the book: a fold is a
	* turn under way, and a turn whose fold is gone without landing is back at rest.
	*/
	reportProgress() {
		const session = this.session;
		const now = session !== null && session.fold !== null ? {
			from: session.from,
			to: session.to,
			direction: session.direction,
			progress: session.landed ? 1 : session.reversed ? 1 - session.progress / 100 : session.progress / 100
		} : null;
		const last = this.reported;
		const sameTurn = now !== null && last !== null && now.from === last.from && now.to === last.to && now.direction === last.direction;
		if (sameTurn && now.progress === last.progress) return;
		if (last !== null && !sameTurn && last.progress !== 0 && last.progress !== 1) {
			this.reported = {
				...last,
				progress: 0
			};
			this.hooks.onProgress(this.reported);
		}
		if (now === null) return;
		this.reported = now;
		this.hooks.onProgress(now);
	}
	destroy() {
		this.endSession();
		this.reportProgress();
	}
};
//#endregion
//#region src/events.ts
/** Minimal typed event emitter. `on` returns the unsubscribe function. */
function createEmitter() {
	const listeners = /* @__PURE__ */ new Map();
	const off = (name, listener) => {
		listeners.get(name)?.delete(listener);
	};
	return {
		on(name, listener, options) {
			let set = listeners.get(name);
			if (set === void 0) {
				set = /* @__PURE__ */ new Set();
				listeners.set(name, set);
			}
			const unsubscribe = () => off(name, listener);
			if (options?.signal?.aborted) return unsubscribe;
			set.add(listener);
			options?.signal?.addEventListener("abort", unsubscribe, { once: true });
			return unsubscribe;
		},
		off,
		emit(name, event) {
			const set = listeners.get(name);
			if (set === void 0) return;
			for (const listener of [...set]) listener(event);
		},
		clear() {
			listeners.clear();
		}
	};
}
//#endregion
//#region src/axes.ts
function isVertical(binding) {
	return binding === Binding.top || binding === Binding.bottom;
}
function axesFor(binding, container) {
	const vertical = isVertical(binding);
	const mirrored = binding === Binding.right || binding === Binding.bottom;
	const swap = (p) => vertical ? {
		x: p.y,
		y: p.x
	} : p;
	const size = (s) => vertical ? {
		width: s.height,
		height: s.width
	} : s;
	const book = size(container);
	const mirror = (p, width) => mirrored ? {
		x: width - p.x,
		y: p.y
	} : p;
	return {
		vertical,
		toBook: (p) => mirror(swap(p), book.width),
		toScreen: (p) => swap(mirror(p, book.width)),
		size,
		local: (p, width) => swap(mirror(p, width)),
		angle: (a) => vertical === mirrored ? a : -a,
		side: (bookSide) => {
			const x = bookSide === "right" !== mirrored;
			if (vertical) return x ? "bottom" : "top";
			return x ? "right" : "left";
		}
	};
}
//#endregion
//#region src/input.ts
/**
* Pointer Events to controller calls. One code path for mouse, touch and pen; the container's
* `touch-action` decides what the browser keeps (scrolling along the spine) and what reaches us.
* Positions are turned into book space here, so the controller never learns the binding: a swipe
* "across the pages" is horizontal on a book and vertical on a notepad by the same test, and a
* swipe to the right reads on in a right-bound book.
*/
/** A press shorter than this that travels `swipeDistance` is a swipe rather than a drag. */
const SWIPE_TIMEOUT = 250;
function attachInput(container, controller, options) {
	let press = null;
	/**
	* The pointer's position in book space. The book is laid out in the container's own pixels
	* (`clientWidth`), but the pointer arrives in the viewport's, and a host that scales the book
	* (a zoom, `transform: scale()`) makes the two differ: the drawn box over the layout box is that
	* scale, and dividing by it brings the pointer home. Rotation and skew are not undone. A
	* container hidden mid-press has no box to measure (0 / 0), and counts as unscaled.
	*/
	const local = (event) => {
		const bounds = container.getBoundingClientRect();
		const scaleX = bounds.width / container.offsetWidth || 1;
		const scaleY = bounds.height / container.offsetHeight || 1;
		const size = {
			width: container.clientWidth,
			height: container.clientHeight
		};
		return axesFor(options.binding, size).toBook({
			x: (event.clientX - bounds.left) / scaleX - container.clientLeft,
			y: (event.clientY - bounds.top) / scaleY - container.clientTop
		});
	};
	const onDown = (event) => {
		if (press !== null) return;
		if (event.pointerType === "mouse" && event.button !== 0) return;
		if (options.ignoreDragOn !== false && event.target instanceof Element && event.target.closest(options.ignoreDragOn) !== null) return;
		const start = local(event);
		press = {
			id: event.pointerId,
			start,
			startedAt: event.timeStamp
		};
		try {
			container.setPointerCapture(event.pointerId);
		} catch {}
		if (controller.pointerDown(start)) event.preventDefault();
	};
	const onMove = (event) => {
		if (press !== null) {
			if (event.pointerId === press.id) controller.pointerDrag(local(event));
			return;
		}
		if (event.pointerType === "mouse" && options.hover) controller.hover(local(event));
	};
	const onUp = (event) => {
		if (press === null || event.pointerId !== press.id) return;
		const { start, startedAt } = press;
		press = null;
		const end = local(event);
		const dx = end.x - start.x;
		const dy = end.y - start.y;
		const quick = event.timeStamp - startedAt < SWIPE_TIMEOUT;
		if (options.swipe && event.pointerType !== "mouse" && quick && Math.abs(dx) > options.swipeDistance && Math.abs(dy) < options.swipeDistance * 2) {
			const rect = controller.bookRect;
			const corner = start.y - rect.top < rect.height / 2 ? FlipCorner.top : FlipCorner.bottom;
			controller.swipe(dx > 0 ? FlipDirection.back : FlipDirection.forward, corner);
			return;
		}
		controller.pointerUp(end);
	};
	const onCancel = (event) => {
		if (press === null || event.pointerId !== press.id) return;
		press = null;
		controller.pointerCancel();
	};
	const onLeave = (event) => {
		if (press === null && event.pointerType === "mouse") controller.hoverEnd();
	};
	container.addEventListener("pointerdown", onDown);
	container.addEventListener("pointermove", onMove, { passive: true });
	container.addEventListener("pointerup", onUp);
	container.addEventListener("pointercancel", onCancel);
	container.addEventListener("pointerleave", onLeave);
	return () => {
		container.removeEventListener("pointerdown", onDown);
		container.removeEventListener("pointermove", onMove);
		container.removeEventListener("pointerup", onUp);
		container.removeEventListener("pointercancel", onCancel);
		container.removeEventListener("pointerleave", onLeave);
	};
}
//#endregion
//#region src/layout.ts
/**
* Page size and orientation for a container measured on screen. Same arithmetic as the original,
* so the book lands on the same pixels; `layout` only overrides the "is the container too narrow"
* decision. Everything is worked out in book space, so for a top- or bottom-bound book "too
* narrow" means too short for two pages one above the other. With `autoSize` such a container is
* always one page wide and two tall, so a vertically bound book that sizes itself is a spread
* unless `layout` says `single`; a host-sized container can be too short, and then it shows one
* page. A mirror changes nothing here: the book is centred either way.
*/
function computeLayout(containerWidth, containerHeight, options) {
	const screen = {
		width: containerWidth,
		height: containerHeight
	};
	const axes = axesFor(options.binding, screen);
	const container = axes.size(screen);
	/** A page `width` screen pixels wide, in book space. */
	const pageOf = (width) => axes.size({
		width,
		height: width * options.height / options.width
	});
	const page = pageOf(options.width);
	const middle = {
		x: container.width / 2,
		y: container.height / 2
	};
	const ratio = page.width / page.height;
	const portraitIf = (narrow) => options.layout === Layout.single || options.layout === Layout.auto && narrow ? Orientation.portrait : Orientation.landscape;
	const narrowest = options.size === SizeMode.stretch ? pageOf(options.minWidth) : page;
	const orientation = portraitIf(container.width < narrowest.width * 2);
	let pageWidth = page.width;
	let pageHeight = page.height;
	if (options.size === SizeMode.stretch) {
		pageWidth = orientation === Orientation.portrait ? container.width : container.width / 2;
		const widest = pageOf(options.maxWidth).width;
		if (pageWidth > widest) pageWidth = widest;
		pageHeight = pageWidth / ratio;
		if (pageHeight > container.height) {
			pageHeight = container.height;
			pageWidth = pageHeight * ratio;
		}
	}
	return {
		orientation,
		container: screen,
		rect: {
			left: orientation === Orientation.portrait ? middle.x - pageWidth / 2 - pageWidth : middle.x - pageWidth,
			top: middle.y - pageHeight / 2,
			width: pageWidth * 2,
			height: pageHeight,
			pageWidth
		}
	};
}
//#endregion
//#region src/pages.ts
function createPages(elements, hardByPosition) {
	return elements.map((element, index) => {
		const density = hardByPosition.has(index) || element.dataset["density"] === PageDensity.hard ? PageDensity.hard : PageDensity.soft;
		return {
			element,
			density,
			drawingDensity: density
		};
	});
}
//#endregion
//#region src/render/dom.ts
/**
* Draws a `Frame` with plain DOM: absolutely positioned page elements, `clip-path` polygons for
* soft pages, `rotateY` for hard ones, and four gradient elements for shadows. The style strings
* are the original's, so a frame lands on the same pixels; writes happen only when a frame is
* handed over, never on a timer. A frame is in book space; the `Axes` for the binding turn it to
* the screen: a mirror for a right-bound book, a transpose for a top-bound one, with sizes swapped
* and every rotation reversed to match.
*/
/**
* Stacking, in tens so the blank sheets of a clump can sit between two layers, one step lower
* each: a hard clump's boards just under the board turning, a soft clump's flaps just under the
* page revealed, which hides where a curled sheet's fold swings past the turning page's own.
*/
const Z = {
	flat: 10,
	bottom: 30,
	hardShadow: 40,
	flipping: 50,
	hardInnerShadow: 50,
	shadow: 100
};
const CLASS = {
	book: "opf-book",
	page: "opf-page",
	/** The side of the screen a page sits on: `opf-page--left`, `--right`, `--top` or `--bottom`. */
	side: (side) => `opf-page--${side}`,
	/** The binding, on the container: `opf-book--left`, `--right`, `--top` or `--bottom`. */
	bound: (binding) => `opf-book--${binding}`,
	flat: "opf-page--flat",
	/** The page in the air: furled, dragged or flipping. The stylesheet draws its edge. */
	turning: "opf-page--turning",
	soft: "opf-page--soft",
	hard: "opf-page--hard",
	shadow: "opf-shadow",
	/** Blank paper standing for the sheets of a clump a jump turns at once. */
	sheet: "opf-sheet"
};
/**
* The inline properties this renderer owns on a page element. Every draw sets all of them
* (clearing the ones it does not use) and touches nothing else, so a page keeps whatever other
* inline style its author or framework gave it.
*/
const PAGE_STYLE = [
	"display",
	"position",
	"zIndex",
	"left",
	"top",
	"width",
	"height",
	"transformOrigin",
	"transform",
	"clipPath",
	"backfaceVisibility"
];
function applyPageStyle(el, style) {
	for (const key of PAGE_STYLE) el.style[key] = style[key] ?? "";
}
/** Element-local points as a `clip-path`. No points (a page wholly off stage) clips everything. */
function clipPath(points) {
	return points.length === 0 ? "inset(100%)" : `polygon(${points.map((p) => `${p.x}px ${p.y}px`).join(", ")})`;
}
var DomRenderer = class {
	shadows;
	/** Blank paper for the sheets of a clump, made as a jump first needs them and kept hidden after. */
	blanks = [];
	pages = [];
	saved = /* @__PURE__ */ new Map();
	/**
	* In portrait a page lifts away from itself: the flat page stays and a mirrored copy folds
	* over it. The copy is inert, has no ids, and lives only for the duration of the flip.
	*/
	clone = null;
	/** Pages currently hidden inline. A page is hidden once when it leaves the stage, not every frame. */
	hidden = /* @__PURE__ */ new Set();
	container;
	options;
	/** Rebuilt on every frame from the container size the frame carries. */
	axes;
	constructor(container, options) {
		this.container = container;
		this.options = options;
		this.axes = axesFor(options.binding, {
			width: 0,
			height: 0
		});
		container.classList.add(CLASS.book, CLASS.bound(options.binding));
		const shadow = (name) => {
			const el = document.createElement("div");
			el.className = `${CLASS.shadow} ${CLASS.shadow}--${name}`;
			el.style.display = "none";
			container.append(el);
			return el;
		};
		this.shadows = {
			outer: shadow("outer"),
			inner: shadow("inner"),
			hardOuter: shadow("hard-outer"),
			hardInner: shadow("hard-inner")
		};
		this.applyContainerSizing();
	}
	setPages(pages) {
		for (const page of this.pages) if (!pages.some((next) => next.element === page.element)) this.restore(page.element);
		this.pages = pages;
		this.hidden.clear();
		for (const page of pages) {
			if (this.saved.has(page.element)) continue;
			this.saved.set(page.element, {
				cssText: page.element.style.cssText,
				className: page.element.className
			});
			page.element.classList.add(CLASS.page);
			if (page.element.parentElement !== this.container) this.container.append(page.element);
		}
	}
	/** Aspect ratio and width limits on the container, when the book sizes itself. */
	applyContainerSizing(orientation = Orientation.landscape) {
		const { autoSize, size, width, height, minWidth, maxWidth, layout, binding } = this.options;
		if (!autoSize) return;
		const narrowest = size === SizeMode.fixed ? width : minWidth;
		const widest = size === SizeMode.fixed ? width : maxWidth;
		const shown = orientation === Orientation.portrait ? 1 : 2;
		const style = this.container.style;
		style.width = "100%";
		if (isVertical(binding)) {
			style.minWidth = `${narrowest}px`;
			style.maxWidth = `${widest}px`;
			style.aspectRatio = `${width} / ${height * shown}`;
		} else {
			const minAcross = layout === Layout.spread ? 2 : 1;
			const maxAcross = layout === Layout.single ? 1 : 2;
			style.minWidth = `${narrowest * minAcross}px`;
			style.maxWidth = `${widest * maxAcross}px`;
			style.aspectRatio = `${width * shown} / ${height}`;
		}
	}
	render(frame) {
		const { rect, flip } = frame;
		this.axes = axesFor(this.options.binding, frame.container);
		const active = /* @__PURE__ */ new Set();
		for (const index of [
			frame.left,
			frame.right,
			flip?.flipping,
			flip?.bottom
		]) if (index !== void 0 && index !== null) active.add(index);
		for (const [index, page] of this.pages.entries()) if (active.has(index)) this.hidden.delete(index);
		else if (!this.hidden.has(index)) {
			applyPageStyle(page.element, { display: "none" });
			page.element.classList.remove(CLASS.turning);
			this.hidden.add(index);
		}
		const flippingHard = flip !== null && this.pages[flip.flipping]?.drawingDensity === PageDensity.hard;
		if (frame.orientation !== Orientation.portrait && frame.left !== null) {
			if (flip !== null && flip.direction === FlipDirection.back && flippingHard) this.drawHard(frame.left, "left", 180 + flip.hardAngle, "flipping", rect);
			else this.drawFlat(frame.left, "left", rect);
		}
		if (frame.right !== null) {
			if (flip !== null && flip.direction === FlipDirection.forward && flippingHard) this.drawHard(frame.right, "right", 180 + flip.hardAngle, "flipping", rect);
			else this.drawFlat(frame.right, "right", rect);
		}
		this.drawSheets(flip, flippingHard, frame);
		if (flip === null) {
			this.dropClone();
			this.hideShadows();
			return;
		}
		const isPageOnShow = flip.flipping === frame.right;
		const liftsFromItself = !flippingHard && isPageOnShow;
		if (!liftsFromItself) this.dropClone();
		if (flip.bottom !== null) {
			const bottomSide = flip.direction === FlipDirection.back ? "left" : "right";
			if (flippingHard) this.drawHard(flip.bottom, bottomSide, 0, "bottom", rect);
			else this.drawSoft(flip.bottom, bottomSide, flip.fold.bottomClip, flip.fold.bottomPagePosition, 0, flip.direction, "bottom", rect);
		}
		const onStage = (points) => frame.orientation === Orientation.portrait ? clipPolygonToMinX(points, 0) : points;
		const flippingSide = flip.direction === FlipDirection.forward && frame.orientation !== Orientation.portrait ? "left" : "right";
		if (flippingHard) {
			if (!isPageOnShow) this.drawHard(flip.flipping, flippingSide, flip.hardAngle, "flipping", rect);
		} else this.drawSoft(flip.flipping, flippingSide, onStage(flip.fold.flippingClip), flip.fold.activeCorner, flip.fold.angle, flip.direction, "flipping", rect, liftsFromItself);
		if (flip.shadow === null) this.hideShadows();
		else if (flippingHard && frame.orientation === Orientation.portrait) {
			this.hideSoftShadows();
			this.drawHardCastShadow(flip.shadow, rect);
		} else if (flippingHard) {
			this.hideSoftShadows();
			const landing = flip.direction === FlipDirection.forward ? frame.left : frame.right;
			this.drawHardShadows(flip.shadow, rect, {
				landing: landing !== null,
				lifting: flip.bottom !== null
			});
		} else {
			this.hideHardShadows();
			const { topLeft, topRight, bottomRight, bottomLeft } = flip.fold.rect;
			this.drawSoftShadows(flip.shadow, onStage([
				topLeft,
				topRight,
				bottomRight,
				bottomLeft
			]), rect);
		}
	}
	element(index, side, asClone = false) {
		const page = this.pages[index];
		if (page === void 0) return null;
		const el = asClone ? this.cloneOf(page.element) : page.element;
		el.classList.add(CLASS.page);
		el.classList.toggle(CLASS.hard, page.density === PageDensity.hard);
		el.classList.toggle(CLASS.soft, page.density === PageDensity.soft);
		el.classList.toggle(CLASS.side(this.axes.side("left")), side === "left");
		el.classList.toggle(CLASS.side(this.axes.side("right")), side === "right");
		return el;
	}
	cloneOf(source) {
		if (this.clone?.source === source) return this.clone.element;
		this.dropClone();
		const element = source.cloneNode(true);
		if (!(element instanceof HTMLElement)) throw new TypeError("@openpageflip/core: a page clone is not an element");
		element.removeAttribute("id");
		for (const el of element.querySelectorAll("[id]")) el.removeAttribute("id");
		element.setAttribute("aria-hidden", "true");
		element.inert = true;
		element.dataset["opfClone"] = "";
		source.after(element);
		this.clone = {
			source,
			element
		};
		return element;
	}
	dropClone() {
		this.clone?.element.remove();
		this.clone = null;
	}
	/** A page's box on screen. */
	pageSize(rect) {
		const size = this.axes.size({
			width: rect.pageWidth,
			height: rect.height
		});
		return {
			width: `${size.width}px`,
			height: `${size.height}px`
		};
	}
	/**
	* Where an element goes on screen, given its book-space `translate` and transform `origin`
	* (`translate3d` then `rotate`, as the style strings do) and its book-space `width`. The origin
	* maps as an element-local point; the translate is where the origin lands in the container,
	* minus where the origin sits in the element on screen.
	*/
	placement(translate, origin, width) {
		const localOrigin = this.axes.local(origin, width);
		const at = this.axes.toScreen({
			x: translate.x + origin.x,
			y: translate.y + origin.y
		});
		return {
			origin: localOrigin,
			translate: {
				x: at.x - localOrigin.x,
				y: at.y - localOrigin.y
			}
		};
	}
	/** Rotation about the spine, as CSS: about the y axis on screen, or the x axis when stacked. */
	spin(degrees) {
		const turned = this.axes.angle(degrees);
		return this.axes.vertical ? `rotateX(${turned}deg)` : `rotateY(${turned}deg)`;
	}
	/** A gradient running along book-space x, as the screen keyword for `linear-gradient`. */
	toward(bookSide) {
		return `to ${this.axes.side(bookSide)}`;
	}
	drawFlat(index, side, rect) {
		const el = this.element(index, side);
		if (el === null) return;
		el.classList.add(CLASS.flat);
		el.classList.remove(CLASS.turning);
		const at = this.placement({
			x: side === "right" ? rect.left + rect.pageWidth : rect.left,
			y: rect.top
		}, {
			x: 0,
			y: 0
		}, rect.pageWidth).translate;
		applyPageStyle(el, {
			position: "absolute",
			display: "block",
			...this.pageSize(rect),
			left: `${at.x}px`,
			top: `${at.y}px`,
			zIndex: String(Z.flat)
		});
	}
	drawSoft(index, side, area, position, angle, direction, layer, rect, asClone = false) {
		const el = this.element(index, side, asClone);
		if (el === null) return;
		el.classList.remove(CLASS.flat);
		el.classList.toggle(CLASS.turning, layer === "flipping");
		const at = this.placement(pageToContainer(position, rect, direction), {
			x: 0,
			y: 0
		}, rect.pageWidth);
		const polygon = clipPath(area.map((p) => {
			const local = direction === FlipDirection.back ? {
				x: -p.x + position.x,
				y: p.y - position.y
			} : {
				x: p.x - position.x,
				y: p.y - position.y
			};
			return this.axes.local(rotatePoint(local, {
				x: 0,
				y: 0
			}, angle), rect.pageWidth);
		}));
		applyPageStyle(el, {
			position: "absolute",
			display: "block",
			zIndex: String(Z[layer]),
			left: "0",
			top: "0",
			...this.pageSize(rect),
			transformOrigin: `${at.origin.x}px ${at.origin.y}px`,
			clipPath: polygon,
			transform: `translate3d(${at.translate.x}px, ${at.translate.y}px, 0) rotate(${this.axes.angle(angle)}rad)`
		});
	}
	/** Where a page on `side` goes to turn about its spine edge: the left page's right edge, the right page's left. */
	hingedAt(side, rect) {
		const spine = rect.left + rect.width / 2;
		return this.placement({
			x: side === "left" ? rect.left : spine,
			y: rect.top
		}, side === "left" ? {
			x: rect.pageWidth,
			y: 0
		} : {
			x: 0,
			y: 0
		}, rect.pageWidth);
	}
	drawHard(index, side, angle, layer, rect) {
		const el = this.element(index, side);
		if (el === null) return;
		el.classList.remove(CLASS.flat);
		el.classList.toggle(CLASS.turning, layer === "flipping");
		const at = this.hingedAt(side, rect);
		applyPageStyle(el, {
			position: "absolute",
			display: "block",
			zIndex: String(Z[layer]),
			left: "0",
			top: "0",
			...this.pageSize(rect),
			backfaceVisibility: "hidden",
			clipPath: "none",
			transformOrigin: `${at.origin.x}px ${at.origin.y}px`,
			transform: `translate3d(${at.translate.x}px, ${at.translate.y}px, 0) ${this.spin(angle)}`
		});
	}
	/**
	* The `i`th piece of blank paper: a wrapper that draws the paper's edge, around the paper
	* itself, cut to shape. The edge is a drop shadow, which the cut would trim off the paper.
	*/
	blank(i) {
		const existing = this.blanks[i];
		const edge = existing ?? document.createElement("div");
		if (existing === void 0) {
			edge.className = CLASS.sheet;
			edge.append(document.createElement("div"));
			this.container.append(edge);
			this.blanks.push(edge);
		}
		const paper = edge.firstElementChild;
		if (!(paper instanceof HTMLDivElement)) throw new TypeError("@openpageflip/core: a sheet has lost its paper");
		return {
			edge,
			paper
		};
	}
	/**
	* The blank sheets turning with a page when a jump turns several at once: plain paper in the
	* colour of the inner pages, each edged with a hairline so the stack reads as sheets. Soft:
	* each sheet's flap, under the page revealed, peeking out along the turning page's curled
	* edges. Hard: a sheet swinging a little behind the board turning, showing past its edge.
	*/
	drawSheets(flip, hard, frame) {
		const sheets = flip?.sheets ?? [];
		const colour = flip === null || sheets.length === 0 ? "" : this.innerPaper(flip, frame);
		const portrait = frame.orientation === Orientation.portrait;
		const cover = `width: ${frame.container.width}px; height: ${frame.container.height}px;`;
		for (const [i, sheet] of sheets.entries()) {
			if (flip === null) break;
			const { edge, paper } = this.blank(i);
			edge.style.cssText = `display: block; ${cover} z-index: ${(hard ? Z.flipping : Z.bottom) - 1 - i}; filter: drop-shadow(0 0 0.75px rgba(0, 0, 0, 0.55));${hard ? " perspective: inherit;" : ""}`;
			const fill = `position: absolute; left: 0; top: 0; background-color: var(--opf-sheet-color, ${colour}); filter: brightness(${1 - .015 * (i + 1)});`;
			if (hard) {
				const side = flip.direction === FlipDirection.forward ? "right" : "left";
				const at = this.hingedAt(side, frame.rect);
				const size = this.pageSize(frame.rect);
				paper.style.cssText = `${fill} width: ${size.width}; height: ${size.height}; transform-origin: ${at.origin.x}px ${at.origin.y}px; transform: translate3d(${at.translate.x}px, ${at.translate.y}px, 0) ${this.spin(180 + sheet.hardAngle)};`;
				continue;
			}
			const points = (portrait ? clipPolygonToMinX(sheet.flap, 0) : sheet.flap).map((p) => this.axes.toScreen(pageToContainer(p, frame.rect, flip.direction)));
			paper.style.cssText = `${fill} ${cover} clip-path: ${clipPath(points)};`;
		}
		for (const el of this.blanks.slice(sheets.length)) el.style.cssText = "display: none";
	}
	/**
	* The paper colour of the sheets between: a soft page's background, from the page revealed,
	* the one lifting or the one coming over, so a cover's colour never stands in for the pages
	* inside it. White when none is soft or has a background of its own.
	*/
	innerPaper(flip, frame) {
		const front = flip.direction === FlipDirection.forward ? frame.right : frame.left;
		const page = [
			flip.bottom,
			front,
			flip.flipping
		].flatMap((index) => {
			const page = index === null ? void 0 : this.pages[index];
			return page === void 0 ? [] : [page];
		}).find((p) => p.density === PageDensity.soft);
		const colour = page === void 0 ? "" : getComputedStyle(page.element).backgroundColor;
		return colour === "" || colour === "transparent" || colour === "rgba(0, 0, 0, 0)" ? "#fff" : colour;
	}
	/** `flipping` is the part of the turning page the inner shadow may fall on. */
	drawSoftShadows(shadow, flipping, rect) {
		const forward = shadow.direction === FlipDirection.forward;
		const at = pageToContainer(shadow.pos, rect, shadow.direction);
		const angle = shadow.angle + 3 * Math.PI / 2;
		const place = (width, translate, points, gradient) => {
			const size = this.axes.size({
				width,
				height: rect.height * 2
			});
			const origin = {
				x: translate,
				y: 100
			};
			const clip = clipPath(points.map((p) => {
				const offset = forward ? {
					x: p.x - shadow.pos.x,
					y: p.y - shadow.pos.y
				} : {
					x: -p.x + shadow.pos.x,
					y: p.y - shadow.pos.y
				};
				return this.axes.local(rotatePoint(offset, origin, angle), width);
			}));
			const to = this.placement({
				x: at.x - origin.x,
				y: at.y - origin.y
			}, origin, width);
			return `display: block; z-index: ${Z.shadow}; width: ${size.width}px; height: ${size.height}px; background: linear-gradient(${gradient}); transform-origin: ${to.origin.x}px ${to.origin.y}px; transform: translate3d(${to.translate.x}px, ${to.translate.y}px, 0) rotate(${this.axes.angle(angle)}rad); clip-path: ${clip};`;
		};
		this.shadows.outer.style.cssText = place(shadow.width, forward ? 0 : shadow.width, [
			{
				x: 0,
				y: 0
			},
			{
				x: rect.pageWidth,
				y: 0
			},
			{
				x: rect.pageWidth,
				y: rect.height
			},
			{
				x: 0,
				y: rect.height
			}
		], `${this.toward(forward ? "right" : "left")}, rgba(0, 0, 0, ${shadow.opacity}), rgba(0, 0, 0, 0)`);
		const innerWidth = shadow.width * 3 / 4;
		this.shadows.inner.style.cssText = place(innerWidth, forward ? innerWidth : 0, flipping, `${this.toward(forward ? "left" : "right")}, rgba(0, 0, 0, ${shadow.opacity}) 5%, rgba(0, 0, 0, 0.05) 15%, rgba(0, 0, 0, ${shadow.opacity}) 35%, rgba(0, 0, 0, 0) 100%`);
	}
	/**
	* Two gradients at the spine. Until the page passes the spine, the inner one lies on the
	* landing side and darkens as the page comes down, and the outer one lies under the lifting
	* page; past the spine they trade places. `hasPage` says which sides have a page to receive a
	* shadow; the gradient that would sit on a bare side stays hidden.
	*/
	drawHardShadows(shadow, rect, hasPage) {
		const progress = shadow.progress > 100 ? 200 - shadow.progress : shadow.progress;
		const size = Math.min(rect.pageWidth, (100 - progress) * (2.5 * rect.pageWidth) / 100 + 20);
		const spine = rect.left + rect.width / 2;
		const flipped = shadow.direction === FlipDirection.forward && shadow.progress > 100 || shadow.direction === FlipDirection.back && shadow.progress <= 100;
		const pastSpine = shadow.progress > 100;
		const showInner = pastSpine ? hasPage.lifting : hasPage.landing;
		const showOuter = pastSpine ? hasPage.landing : hasPage.lifting;
		const box = this.axes.size({
			width: size,
			height: rect.height
		});
		const at = this.placement({
			x: spine,
			y: rect.top
		}, {
			x: 0,
			y: 0
		}, size);
		const common = `display: block; width: ${box.width}px; height: ${box.height}px; left: ${at.translate.x}px; top: ${at.translate.y}px; transform-origin: ${at.origin.x}px ${at.origin.y}px;`;
		this.shadows.hardInner.style.cssText = showInner ? `${common} z-index: ${Z.hardInnerShadow}; background: linear-gradient(${this.toward("right")}, rgba(0, 0, 0, ${shadow.opacity * progress / 100}) 5%, rgba(0, 0, 0, 0) 100%); transform: translate3d(0, 0, 0)${flipped ? "" : ` ${this.spin(180)}`};` : "display: none";
		this.shadows.hardOuter.style.cssText = showOuter ? `${common} z-index: ${Z.hardShadow}; background: linear-gradient(${this.toward("left")}, rgba(0, 0, 0, ${shadow.opacity}) 5%, rgba(0, 0, 0, 0) 100%); transform: translate3d(0, 0, 0)${flipped ? ` ${this.spin(180)}` : ""};` : "display: none";
	}
	/**
	* In portrait a hard page lifts over the page it uncovers with no page on the other side to take
	* the landscape pair's second gradient, and the first, darkest at its far end and cut off
	* square, would sweep across that page on its own. Instead the board casts one shadow from the
	* spine, darkest at its foot and fading outward, reaching further past the board's edge the
	* higher it stands. The board covers what lies under it, so what shows trails off its edge and
	* fades as it lies flat.
	*/
	drawHardCastShadow(shadow, rect) {
		this.shadows.hardInner.style.cssText = "display: none";
		const lift = Math.min(100, shadow.progress) / 100 * (Math.PI / 2);
		const reach = rect.pageWidth * Math.cos(lift) + rect.pageWidth / 3 * Math.sin(lift);
		const spine = rect.left + rect.width / 2;
		const box = this.axes.size({
			width: reach,
			height: rect.height
		});
		const at = this.placement({
			x: spine,
			y: rect.top
		}, {
			x: 0,
			y: 0
		}, reach).translate;
		this.shadows.hardOuter.style.cssText = `display: block; z-index: ${Z.hardShadow}; width: ${box.width}px; height: ${box.height}px; left: ${at.x}px; top: ${at.y}px; background: linear-gradient(${this.toward("right")}, rgba(0, 0, 0, ${shadow.opacity}), rgba(0, 0, 0, 0));`;
	}
	hideSoftShadows() {
		this.shadows.outer.style.cssText = "display: none";
		this.shadows.inner.style.cssText = "display: none";
	}
	hideHardShadows() {
		this.shadows.hardOuter.style.cssText = "display: none";
		this.shadows.hardInner.style.cssText = "display: none";
	}
	hideShadows() {
		this.hideSoftShadows();
		this.hideHardShadows();
	}
	restore(element) {
		const saved = this.saved.get(element);
		if (saved === void 0) return;
		element.style.cssText = saved.cssText;
		element.className = saved.className;
		this.saved.delete(element);
	}
	/** Put the container and every page back the way they were found. */
	destroy() {
		this.dropClone();
		this.hidden.clear();
		for (const page of this.pages) this.restore(page.element);
		this.pages = [];
		for (const el of Object.values(this.shadows)) el.remove();
		for (const el of this.blanks) el.remove();
		this.blanks.length = 0;
		this.container.classList.remove(CLASS.book, CLASS.bound(this.options.binding));
		const style = this.container.style;
		style.width = "";
		style.minWidth = "";
		style.maxWidth = "";
		style.aspectRatio = "";
	}
};
//#endregion
//#region src/book.ts
function createBook(container, userOptions) {
	const { clock = browserClock, ...bookOptions } = userOptions;
	const options = resolveOptions(bookOptions);
	const elements = Array.from(bookOptions.pages ?? container.children).filter((el) => el instanceof HTMLElement);
	if (elements.length === 0) throw new TypeError("@openpageflip/core: createBook needs at least one page element");
	if (options.startPage >= elements.length) throw new TypeError(`@openpageflip/core: "startPage" ${options.startPage} is out of range for ${elements.length} pages`);
	const emitter = createEmitter();
	const renderer = new DomRenderer(container, options);
	const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
	const measure = () => {
		const width = container.clientWidth;
		const { orientation } = computeLayout(width, container.clientHeight, options);
		renderer.applyContainerSizing(orientation);
		return computeLayout(width, container.clientHeight, options);
	};
	const buildPages = (els) => {
		const { hardByPosition } = buildSpreads(els.length, "landscape", options.cover);
		return createPages(els, hardByPosition);
	};
	let pages = buildPages(elements);
	renderer.setPages(pages);
	const controller = new FlipController({
		...options,
		get flipDuration() {
			return reducedMotion.matches ? 0 : options.flipDuration;
		}
	}, clock, {
		onFrame: (frame) => renderer.render(frame),
		onPage: (page) => emitter.emit("flip", { page }),
		onState: (state) => emitter.emit("changeState", { state }),
		onProgress: (progress) => emitter.emit("flipProgress", progress)
	}, pages, measure());
	const relayout = () => {
		const layout = measure();
		if (controller.setLayout(layout)) emitter.emit("changeOrientation", { orientation: layout.orientation });
	};
	let lastSize = {
		width: container.clientWidth,
		height: container.clientHeight
	};
	let pendingRelayout = null;
	const observer = new ResizeObserver(() => {
		if (pendingRelayout !== null) return;
		pendingRelayout = clock.requestFrame(() => {
			pendingRelayout = null;
			const size = {
				width: container.clientWidth,
				height: container.clientHeight
			};
			if (size.width === lastSize.width && size.height === lastSize.height) return;
			lastSize = size;
			relayout();
		});
	});
	observer.observe(container);
	const detachInput = attachInput(container, controller, options);
	controller.showPage(options.startPage);
	queueMicrotask(() => emitter.emit("init", {
		page: controller.page,
		orientation: controller.currentOrientation
	}));
	return {
		get page() {
			return controller.page;
		},
		get pageCount() {
			return controller.pageCount;
		},
		get orientation() {
			return controller.currentOrientation;
		},
		get state() {
			return controller.currentState;
		},
		get rect() {
			return controller.bookRect;
		},
		on: emitter.on,
		off: emitter.off,
		flipNext: (corner = FlipCorner.top) => controller.flipNext(corner),
		flipPrev: (corner = FlipCorner.top) => controller.flipPrev(corner),
		flipTo: (page, corner = FlipCorner.top) => controller.flipTo(page, corner),
		turnTo: (page) => controller.showPage(page),
		turnNext: () => controller.showNext(),
		turnPrev: () => controller.showPrev(),
		setPages(next) {
			const els = Array.from(next);
			if (els.length === 0) throw new TypeError("@openpageflip/core: setPages needs at least one page element");
			pages = buildPages(els);
			renderer.setPages(pages);
			controller.setPages(pages);
			emitter.emit("update", {
				page: controller.page,
				orientation: controller.currentOrientation
			});
		},
		update: relayout,
		redraw: () => controller.redraw(),
		destroy() {
			observer.disconnect();
			if (pendingRelayout !== null) clock.cancelFrame(pendingRelayout);
			detachInput();
			controller.destroy();
			renderer.destroy();
			emitter.clear();
		}
	};
}
//#endregion
export { Binding, ClickMode, FlipCorner, FlipDirection, FlipState, Layout, Orientation, PageDensity, SizeMode, computeFold, computeLayout, createBook };

//# sourceMappingURL=index.js.map