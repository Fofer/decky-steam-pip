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

export enum ViewMode {
    Expand = 1,
    Picture = 2,
    Closed = 3
}

export enum Position {
    Top,
    TopRight,
    Right,
    BottomRight,
    Bottom,
    BottomLeft,
    Left,
    TopLeft
}