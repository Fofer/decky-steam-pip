// Original decky-pip values, kept exactly as-is for Steam Deck. These were
// hardcoded by the original developer for the Deck's GamepadUI canvas and
// are wrong on any other device (e.g. a Steam Machine driving a TV), which
// is why placement was off there — see getScreenBounds() in pip.tsx.
export const DECK_SCREEN_WIDTH = 854;
export const DECK_SCREEN_HEIGHT = 534;

// Both Steam Deck LCD and OLED have a fixed native panel resolution of
// 1280x800. There's no documented Valve/Decky API that reports "this is a
// Steam Deck" directly, so pip.tsx uses this well-known, fixed resolution
// as a heuristic to decide when to use the constants above. [Unverified
// as a detection method beyond the resolution fact itself, which is
// well-documented Steam Deck hardware spec.]
export const DECK_NATIVE_WIDTH = 1280;
export const DECK_NATIVE_HEIGHT = 800;

// Used only if the dynamic measurement on a non-Deck device fails.
export const FALLBACK_SCREEN_WIDTH = DECK_SCREEN_WIDTH;
export const FALLBACK_SCREEN_HEIGHT = DECK_SCREEN_HEIGHT;

export const MARGIN = 20;
export const PICTURE_ASPECT_RATIO = 1.85;
export const PICTURE_WIDTH_RATIO = 0.4;

// The Size slider's own range (settings.tsx) — shared here so pipBounds.tsx
// can clamp the actual rendered size to it too, in case a persisted `size`
// value from before this range last changed falls outside the current
// slider's own min/max (the slider itself only clamps what's displayed,
// not the underlying stored value).
export const SIZE_MIN = 0.35;
export const SIZE_MAX = 1.10;

// Width of the floating on-screen control bar drawn beside the picture
// itself (controlBar.tsx) — lives here, rather than in that file, so
// pipBounds.tsx can reserve space for it in Expand mode without a circular
// import between the two.
export const CONTROL_BAR_WIDTH = 48;

export enum ViewMode {
    Expand = 1,
    Picture = 2,
    Closed = 3
}

// Preset sizes for the Maximize button's cycle (settings.tsx, controlBar.tsx)
// — the exact same S/M/L/XL stops the Size slider's own notches already
// mark, so cycling Maximize and dragging the slider always land on
// recognizable, matching values.
export const SIZE_S = SIZE_MIN;
export const SIZE_M = 0.60;
export const SIZE_L = 0.85;
export const SIZE_XL = SIZE_MAX;

export type MaximizeStep = 'S' | 'M' | 'L' | 'XL' | 'Expand';

const MAXIMIZE_STEPS: MaximizeStep[] = ['S', 'M', 'L', 'XL', 'Expand'];
const MAXIMIZE_SIZES: Record<Exclude<MaximizeStep, 'Expand'>, number> = { S: SIZE_S, M: SIZE_M, L: SIZE_L, XL: SIZE_XL };
const MAXIMIZE_SIZE_STEPS: Exclude<MaximizeStep, 'Expand'>[] = ['S', 'M', 'L', 'XL'];

// Which of the five Maximize steps (S/M/L/XL/Expand) best matches the
// current size+viewMode — the closest size preset when in Picture mode —
// so the button's icon (and nextMaximizeStep/advanceMaximize below) track
// reality even after someone's fine-tuned Size by hand on the slider rather
// than only ever clicking Maximize.
export const currentMaximizeStep = (viewMode: ViewMode, size: number): MaximizeStep => {
    if (viewMode === ViewMode.Expand) return 'Expand';
    return MAXIMIZE_SIZE_STEPS.reduce((closest, step) =>
        Math.abs(MAXIMIZE_SIZES[step] - size) < Math.abs(MAXIMIZE_SIZES[closest] - size) ? step : closest);
};

// [Confirmed by Josh, 2026-09-20] The Maximize button used to be a plain
// Picture/Expand toggle — replaced with a five-step cycle instead: Small ->
// Medium -> Large -> Extra Large -> Maximize (Expand) -> back to Small. The
// Size slider already gives fine, continuous control over exactly how big
// the picture is; this is the quick, no-slider way to jump between its
// marked notches and, one click further, full Expand.
export const advanceMaximize = <S extends { viewMode: ViewMode, size: number }>(state: S): S => {
    const current = currentMaximizeStep(state.viewMode, state.size);
    const next = MAXIMIZE_STEPS[(MAXIMIZE_STEPS.indexOf(current) + 1) % MAXIMIZE_STEPS.length];
    if (next === 'Expand') {
        return { ...state, viewMode: ViewMode.Expand };
    }
    return { ...state, viewMode: ViewMode.Picture, size: MAXIMIZE_SIZES[next] };
};

const MAXIMIZE_TITLES: Record<MaximizeStep, string> = {
    S: "Size: Small (tap for Medium)",
    M: "Size: Medium (tap for Large)",
    L: "Size: Large (tap for Extra Large)",
    XL: "Size: Extra Large (tap to Maximize)",
    Expand: "Maximized (tap to restore to Small)",
};

export const maximizeTitle = (step: MaximizeStep): string => MAXIMIZE_TITLES[step];

export enum Position {
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
    TopLeft,
}

// The enum's own declaration order is already a clockwise walk around the
// screen edge (Top -> TopRight -> Right -> ... -> TopLeft -> back to Top),
// matching the position grid's own layout — so "the next position
// clockwise" is just "the next number", wrapping around at the end. Used by
// the on-screen control bar's Position button to cycle through placements
// without opening the QAM.
export const nextPosition = (position: Position): Position => {
    const values = [
        Position.Top, Position.TopRight, Position.Right, Position.BottomRight,
        Position.Bottom, Position.BottomLeft, Position.Left, Position.TopLeft,
    ];
    const index = values.indexOf(position);
    return values[(index + 1) % values.length];
};

// Which two outer edges of the picture are free to wrap an L-shaped control
// bar around, for a given Position — the two edges NOT already flush
// against a screen boundary (or, on the right, against the QAM panel's
// docked strip). For an edge-centered position (Top/Bottom/Left/Right) only
// one axis is actually constrained; the other defaults to matching the
// existing single-side behavior (right side, bottom edge) rather than
// picking arbitrarily.
export const getControlBarSides = (position: Position): { vertical: 'left' | 'right', horizontal: 'top' | 'bottom' } => {
    const touchesRight = position === Position.TopRight || position === Position.Right || position === Position.BottomRight;
    const touchesBottom = position === Position.BottomRight || position === Position.Bottom || position === Position.BottomLeft;
    return {
        vertical: touchesRight ? 'left' : 'right',
        horizontal: touchesBottom ? 'top' : 'bottom',
    };
};
// Converts a "#rrggbb" hex color (the only format a native <input
// type="color"> ever produces or accepts) into an rgba() string at a given
// alpha — used wherever a user-picked color (QAM Layout's "Use Color"
// toggle, overlaySettingsModal.tsx/settings.tsx) needs to go into a
// semi-transparent button background, matching the fixed alpha the
// hardcoded default colors already used at that same spot. Falls back to a
// mid-gray if the string isn't actually a 6-digit hex (e.g. a persisted
// value from before this feature existed, or corrupted localStorage) rather
// than rendering "rgba(NaN, NaN, NaN, ...)".
export const hexToRgba = (hex: string, alpha: number): string => {
    const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
    if (!match) return `rgba(128, 128, 128, ${alpha})`;
    const int = parseInt(match[1], 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Shortens a long absolute path to its last few segments (e.g.
// ".../remote/0/screenshots/steampip_20260920_103712.png") for display
// somewhere space-constrained like a toast. [Confirmed by Josh, 2026-09-20]
// a full Steam userdata path is long enough to get visually cut off in a
// Decky toast before it can be read — the full, untruncated path is always
// still available afterward via lastScreenshotResult in Screenshot Settings.
export const shortenPathForToast = (path: string, keepSegments: number = 3): string => {
    const parts = path.split('/').filter(p => p.length > 0);
    if (parts.length <= keepSegments) return path;
    return '.../' + parts.slice(-keepSegments).join('/');
};

// [Confirmed by Josh, 2026-09-20] The on-screen overlay's two segments —
// the side "View" bar and the horizontal "Control" bar — are each now
// user-reorderable (overlaySettingsModal.tsx's grab handles), rather than
// hardcoded render order. These key unions are the two columns' item
// identities: persisted as ordered arrays (globalState.tsx's viewOrder/
// controlOrder), never mixed between columns, and used to both order the
// settings-modal rows and drive controlBar.tsx's actual render order (the
// connected L-bar, the Separate pill mode, and the Expand-mode bottom dock
// all read from the same two arrays).
// [Confirmed by Josh, 2026-09-21] 'move' — a freeform drag-to-move handle —
// briefly existed here, but never reliably worked (at least on the Steam
// Machine) and appeared to be causing occasional loss of controller focus
// during actual gameplay, which matters far more than repositioning the
// picture. Removed entirely rather than just hidden, along with all of its
// supporting code (controlBar.tsx's pointer-drag handlers, Position.Custom
// and customPosX/customPosY in globalState.tsx/pipBounds.tsx, the QAM
// grid's own toggle for it). May come back in a later version done properly
// (D-pad-drivable, not just mouse/trackpad drag), but not worth risking this
// release over.
export type ViewItemKey = 'maximize' | 'position' | 'screenshot' | 'hide' | 'swap' | 'close';
export type ControlItemKey = 'seekBack30' | 'seekBack' | 'playPause' | 'seekForward' | 'seekForward30' | 'volume';

// The order every fresh install (and "Reset to Default Order") ships with —
// exactly the order these items were hardcoded in before becoming
// reorderable, so resetting restores familiar behavior rather than some new
// arbitrary arrangement.
export const DEFAULT_VIEW_ORDER: ViewItemKey[] = ['maximize', 'position', 'screenshot', 'hide', 'swap', 'close'];
export const DEFAULT_CONTROL_ORDER: ControlItemKey[] = ['seekBack30', 'seekBack', 'playPause', 'seekForward', 'seekForward30', 'volume'];

// Moves the item at index `from` to index `to`, shifting the items between
// them rather than swapping — the standard drag-and-drop reorder semantics
// (dropping item A onto item B's row inserts A there, it doesn't trade
// places with B). Returns a new array; never mutates the input.
export const reorder = <T,>(arr: T[], from: number, to: number): T[] => {
    if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return arr;
    const copy = arr.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
};

// [Confirmed by Josh, 2026-09-20] Reconciles a persisted order array (from
// localStorage, possibly saved by an older build) against the current
// default order — used in place of letting lodash's plain `merge()` handle
// viewOrder/controlOrder. `merge()` combines arrays by INDEX, not by key:
// if a brand new item is added anywhere but the very last index of
// DEFAULT_VIEW_ORDER/DEFAULT_CONTROL_ORDER, that index-based merge
// overwrites it with whatever the user's shorter, older persisted array
// happens to have at that same index instead — silently dropping the new
// item, with no error. Explicitly keeping every key the user's own array
// already had (in the order they left it, including any they've dragged
// around) and appending only the ones genuinely missing from it sidesteps
// that failure mode entirely, and doesn't depend on a new key always being
// added at the end of the default array to stay safe.
export const reconcileOrder = <T extends string>(persisted: T[] | undefined, defaultOrder: T[]): T[] => {
    if (!persisted || !Array.isArray(persisted)) return defaultOrder;
    const kept = persisted.filter(key => defaultOrder.includes(key));
    const missing = defaultOrder.filter(key => !kept.includes(key));
    return [...kept, ...missing];
};
