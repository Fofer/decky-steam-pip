import { CSSProperties, Fragment, ReactNode, useEffect, useRef } from "react";
import { FaArrowsAlt, FaCamera, FaExchangeAlt, FaEyeSlash, FaPause, FaPlay, FaTimes, FaVolumeMute, FaVolumeUp } from "react-icons/fa";
import { MdReplay10, MdForward10, MdReplay30, MdForward30 } from "react-icons/md";
import { toaster } from "@decky/api";

import { useGlobalState, withUrlChange } from "./globalState";
import { useAutoHide } from "./useAutoHide";
import { backendCallWithTimeout } from "./backendCall";
import { CONTROL_BAR_WIDTH, ControlItemKey, ViewItemKey, ViewMode, advanceMaximize, currentMaximizeStep, maximizeTitle, nextPosition, shortenPathForToast } from "./util";
import { useScreenBounds } from "./screen";
import { MaximizeIcon } from "./maximizeIcon";
import { nowPlayingLabel } from "./nowPlayingLabel";

// The side bar (Maximize/Position/Screenshot/Hide, plus Swap when there's a
// previous channel to swap to, plus Close in Expand mode — see below) still
// scales its button size down for a short picture, same reasoning as
// before. The button count varies (Swap only shows sometimes, Close only in
// Expand mode), so it's computed from what's actually showing rather than a
// fixed constant — see vNumButtons below.
const MAX_BUTTON_SIZE = 44;
const MIN_BUTTON_SIZE = 20;
const GAP_RATIO = 4 / MAX_BUTTON_SIZE;
const PADDING_RATIO = 22 / MAX_BUTTON_SIZE;
const FONT_RATIO = 18 / MAX_BUTTON_SIZE;

// Everything below (the side bar's own width, the horizontal bar's height/
// button size, and Close's size) used to be fixed regardless of the
// picture's size, which made the whole overlay look oversized — "big and
// fat" — next to a small picture, since only the side bar's individual
// button size (above) actually shrank. `buttonScale` is how much smaller
// than its own largest case (MAX_BUTTON_SIZE) the side bar's buttons
// currently are, and every *_MAX constant below is scaled down by that same
// fraction (with its own *_MIN floor so nothing gets illegibly small) —
// so the whole overlay grows and shrinks together as one unit, and still
// looks exactly like it used to at the largest picture sizes, where
// buttonScale is 1.
const H_BUTTON_SIZE_MAX = 34;
const H_BUTTON_SIZE_MIN = 22;
const H_BAR_HEIGHT_MAX = 46;
const H_BAR_HEIGHT_MIN = 30;
const H_ICON_FONT_SIZE_MAX = 20;
const H_ICON_FONT_SIZE_MIN = 13;
// The horizontal bar's HEIGHT/button size scale with the picture as above.
// Its overall WIDTH used to separately track the picture's own width in
// Connected mode (so the transport controls stayed visually centered under/
// over the picture at any Size) — [Confirmed by Josh, 2026-09-20] dropped
// in favor of sizing to fit only the buttons actually on, in EVERY mode now,
// not just Separate: a bar stretching the picture's full width when it only
// holds two small icons left a lot of dead, empty pill for no reason. See
// hIntrinsicWidth below for the actual calculation both modes now share.
// Nudges the back/play/forward/volume row down a few pixels off the bar's
// own top edge — but ONLY when horizontalSide is 'bottom', i.e. this bar
// sits directly below the picture, right next to the now-playing title/
// description text rendered at the picture's own bottom edge (pip.tsx's
// #now-playing overlay). [Confirmed by Josh, 2026-09-20] Previously applied
// unconditionally regardless of horizontalSide, which also fought against
// alignItems: 'center' below and left the row visibly NOT centered — pinned
// close to the bar's top edge with a lot of dead space beneath it — every
// time the bar sat ABOVE the picture instead, where there's no adjacent
// text and this offset was never actually needed.
const H_ROW_SHIFT_DOWN = 12;
// [Confirmed by Josh, 2026-09-20] Shortened to 46 in an earlier round to fix
// it overflowing the QAM panel's own volume slider (settings.tsx, a
// different element — see its own native <input> there) — but 46px turned
// out too small a target to reliably click into with a controller's cursor.
// A first widen to 62px (~35%) still wasn't enough — doubled from that
// 62px value instead. The horizontal bar itself now clamps to stay fully
// on-screen at this width (see H_BAR_EDGE_PAD below) rather than trusting
// the picture's own position to always leave enough room to its right.
const VOLUME_SLIDER_WIDTH = 124;
// The horizontal bar's own left/right padding and the gap between its
// buttons — pulled out as named constants (rather than the magic numbers
// they used to be inline in the JSX below) so the intrinsic-width
// calculation for the "Separate" overlay layout can use the exact same
// numbers the actual layout does, instead of drifting out of sync with it.
const H_ROW_H_PADDING = 10;
const H_ROW_GAP = 6;
const H_ROW_VOLUME_SPACER = 14;

// The side bar's own width — also scaled by buttonScale, same as everything
// else above. Its MAX is CONTROL_BAR_WIDTH itself (util.tsx) — the same
// constant pipBounds.tsx reserves space for in Expand mode — so the bar
// never renders wider than what's actually been reserved for it.
const V_BAR_WIDTH_MIN = 34;

// Close lives in its own separate round button beyond the far end of the
// horizontal bar — not grouped into the side bar with Expand/Position/Hide
// (a different "kind" of control — closing the picture, not adjusting it)
// and not packed against the transport controls either, so a visible gap
// (CLOSE_GAP) always separates it from the H bar's own rounded end.
const CLOSE_BUTTON_SIZE_MAX = 38;
const CLOSE_BUTTON_SIZE_MIN = 26;
const CLOSE_GAP = 10;
const CLOSE_ICON_FONT_SIZE_MAX = 16;
const CLOSE_ICON_FONT_SIZE_MIN = 11;
// A soft reddish-pink rather than a saturated alarm red — enough of a tint
// to read as "this one's different" without shouting.
const CLOSE_BG = 'rgba(200, 120, 115, 0.6)';
// [Confirmed by Josh, 2026-09-20] Play/Pause on the on-screen overlay used
// to get the same green/blue tinted-button treatment as Close — dropped so
// that coloring stays exclusive to the QAM panel's own Play/Pause button
// (settings.tsx's QAM_PLAY_BG/QAM_PAUSE_BG, optionally user-picked via QAM
// Layout's "Use Color" toggle). Here it's now a plain icon button, styled
// identically to every other button in this transport row.

// [Confirmed by Josh, 2026-09-20] In Expand mode the transport controls (Back
// 10s/Play-Pause/Forward 10s) and Close move out of the side bar/floating-
// Close-button arrangement (which only makes sense next to a floating
// picture) into one small dock centered along the bottom of the whole
// screen — this is how far up from the screen's bottom edge that dock sits.
const EXPAND_BOTTOM_MARGIN = 20;

// Zero — the side bar sits flush against the picture's own edge, not gapped
// off of it, per explicit feedback that a gap here read as "a couple pixels
// off" rather than properly hugging the picture.
const GAP_FROM_PICTURE = 0;
const COLLAPSED_LINE_WIDTH = 5;
const COLLAPSED_TAP_WIDTH = 16;


interface ControlBarProps {
    // The PICTURE's own bounds (not the bar's) — this positions both of its
    // own segments relative to that rectangle.
    x: number
    y: number
    width: number
    height: number
    verticalSide: 'left' | 'right'
    horizontalSide: 'top' | 'bottom'
    viewMode: ViewMode
}

// A floating on-screen control strip drawn directly over the game screen,
// wrapped in an L around whichever corner of the picture has free space
// (see getControlBarSides in util.tsx) — a side segment running the
// picture's full height (Maximize, Position, Hide) and a segment along its
// top or bottom edge (10s back, Play/Pause, 10s forward, then Mute + a
// volume slider), with the two segments' near edges flush against each
// other (zero radius on the corner where they meet) so they read as one
// continuous L-shaped border rather than two separate floating pills. Close
// sits just beyond the far end of the horizontal segment as its own round
// button, gapped away from it. Adapted from the same idea in
// ajustinjames's decky-portal, another fork of the original decky-pip,
// though the L shape and the split between the segments are this fork's
// own. Unlike this plugin's own panel (which needs the Quick Access Menu
// opened every time), this stays reachable while actually watching, and
// collapses to a thin edge tab after a few seconds so it doesn't sit over
// the picture indefinitely — tap the tab to bring it back, or turn on
// "always visible" in the panel's View row to skip the auto-hide entirely.
//
// [Unverified] This renders as plain HTML buttons/inputs, not Decky's own
// Focusable components, so it's reachable with a mouse/trackpad cursor —
// the same way the tooltip text on this plugin's panel icons already turned
// out to need one. Whether a Steam Controller can "confirm" onto it at all
// without switching into cursor mode isn't confirmed; the panel's own
// buttons remain the reliable D-pad-navigable way to do everything this bar
// does.
//
// The picture-hugging L-shaped bar (side segment + horizontal segment +
// floating Close) is only shown in Picture mode — Expand mode has no
// meaningful "free edge" to wrap it around (the picture fills nearly the
// whole screen). There, this component instead renders a shorter side bar
// (Maximize/Screenshot/Hide/Swap) plus a separate small dock of Back 10s/
// Play-Pause/Forward 10s/Close centered along the bottom of the whole
// screen — see showExpandBottomBar below.
export const ControlBar = ({ x, y, width, height, verticalSide, horizontalSide, viewMode }: ControlBarProps) => {
    const [{
        playing, muted, volume, size, controlBarAlwaysVisible, opacity, url, previousUrl, bookmarks, nowPlaying,
        screenshotEnabled, screenshotSaveDir, overlayConnected, overlayShowMaximize, overlayShowPosition,
        overlayShowScreenshot, overlayShowHide, overlayShowSwap, overlayShowClose, overlayShowSeekBack,
        overlayShowPlayPause, overlayShowSeekForward, overlayShowVolume,
        overlayShowSeekBack30, overlayShowSeekForward30, viewOrder, controlOrder,
    }, setGlobalState] = useGlobalState();
    const autoHide = useAutoHide();
    const screenBounds = useScreenBounds();
    const prevViewModeRef = useRef(viewMode);

    // Expand mode has no "picture" to duck around, so the bar just stays
    // fully shown there regardless of the preference below; otherwise, the
    // "always visible" toggle in the panel's View row skips auto-hide
    // entirely for someone who'd rather always see every button.
    const alwaysShow = viewMode === ViewMode.Expand || controlBarAlwaysVisible;
    const expanded = alwaysShow || autoHide.expanded;
    const { show, onInteraction } = autoHide;

    useEffect(() => {
        if (prevViewModeRef.current !== viewMode) {
            prevViewModeRef.current = viewMode;
            show();
        }
    }, [viewMode, show]);

    const withInteraction = (handler: () => void) => () => {
        onInteraction();
        handler();
    };

    const advanceMaximizeStep = () => setGlobalState(state => advanceMaximize(state));

    const cyclePosition = () => setGlobalState(state => ({
        ...state,
        position: nextPosition(state.position),
    }));

    const togglePlayPause = () => setGlobalState(state => ({
        ...state,
        playPauseSeq: state.playPauseSeq + 1,
        // Same optimistic assumption as the panel's own Play/Pause button —
        // there's no readback from the loaded page's actual player state.
        playing: !state.playing,
    }));

    const seekBack = () => setGlobalState(state => ({ ...state, seekBackSeq: state.seekBackSeq + 1 }));
    const seekForward = () => setGlobalState(state => ({ ...state, seekForwardSeq: state.seekForwardSeq + 1 }));
    const seekBack30 = () => setGlobalState(state => ({ ...state, seekBack30Seq: state.seekBack30Seq + 1 }));
    const seekForward30 = () => setGlobalState(state => ({ ...state, seekForward30Seq: state.seekForward30Seq + 1 }));

    const hide = () => setGlobalState(state => ({ ...state, hidden: true }));

    const toggleMute = () => setGlobalState(state => ({ ...state, muted: !state.muted }));

    const close = () => setGlobalState(state => ({
        ...state,
        viewMode: ViewMode.Closed,
        hidden: false,
    }));

    // Mirrors settings.tsx's swap button — jumps straight back to whatever
    // channel was loaded right before this one. previousUrl is tracked
    // automatically by withUrlChange (globalState.tsx) every time the
    // channel actually changes, so there's no separate history to keep here.
    const swapToPreviousChannel = () => {
        if (!previousUrl || previousUrl === url) return;
        setGlobalState(state => ({
            ...withUrlChange(state, previousUrl),
            visible: true,
            viewMode: ViewMode.Picture,
            playing: true,
        }));
    };

    // Mirrors settings.tsx's screenshot button, but uses this component's
    // own already-known x/y/width/height props directly rather than calling
    // usePipBounds() again.
    const takeScreenshot = async () => {
        // Fires the flash/sound immediately — see screenshotFlashSeq's
        // comment in globalState.tsx.
        setGlobalState(state => ({ ...state, screenshotFlashSeq: state.screenshotFlashSeq + 1 }));
        try {
            // Same longer timeout as settings.tsx's version of this — see
            // its comment for why 5s (backendCall's default) isn't enough.
            // See settings.tsx's own version of this call for why
            // screenBounds is passed too.
            const result = await backendCallWithTimeout<[number, number, number, number, string, number, number, string], { path?: string, error?: string, tool?: string }>(
                35000, "take_screenshot", x, y, width, height, screenshotSaveDir, screenBounds.width, screenBounds.height, nowPlayingLabel(nowPlaying));
            if (result?.error) {
                toaster.toast({ title: "Steam PiP", body: `Screenshot failed: ${result.error}` });
                setGlobalState(state => ({ ...state, lastScreenshotResult: `Failed: ${result.error}` }));
            } else if (result?.path) {
                toaster.toast({ title: "Steam PiP", body: `Saved: ${shortenPathForToast(result.path)}` });
                setGlobalState(state => ({ ...state, lastScreenshotResult: result.path! }));
            }
        } catch (e) {
            toaster.toast({ title: "Steam PiP", body: String(e) });
            setGlobalState(state => ({ ...state, lastScreenshotResult: `Failed: ${e}` }));
        }
    };

    // Whether there's actually a previous channel to swap back to — same
    // condition as settings.tsx's own swap button, and the previous
    // channel's own name for a nicer tooltip when it's a saved bookmark.
    const swapAvailable = !!previousUrl && previousUrl !== url;
    const previousBookmark = bookmarks.find(b => b.url === previousUrl);

    // Each side-bar control's actual visibility, folding its own
    // per-control toggle (overlaySettingsModal.tsx) together with whatever
    // other condition already governed it (screenshotEnabled for
    // Screenshot, swapAvailable for Swap) — computed once so both the
    // button count below and the render further down agree on exactly the
    // same set. Close isn't part of this side-bar set at all anymore — see
    // showExpandBottomBar/overlayShowClose further down for where it lives
    // in each mode.
    const showMaximizeButton = overlayShowMaximize;
    // [Confirmed by Josh, 2026-09-20] Change Position cycles where the
    // floating picture sits on screen (util.tsx's nextPosition) — in Expand
    // mode there's no floating picture to move, so the button did nothing
    // there and is left out of the side bar entirely while expanded.
    const showPositionButton = overlayShowPosition && viewMode !== ViewMode.Expand;
    const showScreenshotButton = screenshotEnabled && overlayShowScreenshot;
    const showHideButton = overlayShowHide;
    const showSwapButton = swapAvailable && overlayShowSwap;

    // [Confirmed by Josh, 2026-09-20] Render order for both the View side
    // bar and the Control row now comes from the user's own drag-to-reorder
    // arrangement (viewOrder/controlOrder, set in overlaySettingsModal.tsx)
    // rather than a fixed sequence — these two lookup tables are what let
    // `viewOrder.map(...)`/`controlOrder.map(...)` below stay in sync with
    // whichever per-control toggle governs that same item's visibility.
    // 'close' is a View item for settings-modal/toggle purposes only — it
    // never renders inside this vertical bar at all (Picture mode floats it
    // as its own separate round button past the horizontal bar's end;
    // Expand mode docks it at the far end of the bottom dock instead), so
    // its own position within viewOrder has no visible effect and that's
    // expected, not a bug.
    const viewButtonVisible: Record<ViewItemKey, boolean> = {
        maximize: showMaximizeButton,
        position: showPositionButton,
        screenshot: showScreenshotButton,
        hide: showHideButton,
        swap: showSwapButton,
        close: false,
    };
    const renderViewButton = (key: ViewItemKey): ReactNode => {
        switch (key) {
            case 'maximize':
                return (
                    <button
                        aria-label="Expand"
                        title={maximizeTitle(currentMaximizeStep(viewMode, size))}
                        style={vButtonStyle}
                        onClick={withInteraction(advanceMaximizeStep)}>
                        <MaximizeIcon step={currentMaximizeStep(viewMode, size)} />
                    </button>
                );
            case 'position':
                return (
                    <button
                        aria-label="Change Position"
                        title="Change Position"
                        style={vButtonStyle}
                        onClick={withInteraction(cyclePosition)}>
                        <FaArrowsAlt />
                    </button>
                );
            case 'screenshot':
                return (
                    <button
                        aria-label="Take Screenshot"
                        title="Take Screenshot"
                        style={vButtonStyle}
                        onClick={withInteraction(takeScreenshot)}>
                        <FaCamera />
                    </button>
                );
            case 'hide':
                return (
                    <button
                        aria-label="Hide"
                        title="Hide (keeps playing)"
                        style={vButtonStyle}
                        onClick={withInteraction(hide)}>
                        <FaEyeSlash />
                    </button>
                );
            case 'swap':
                return (
                    <button
                        aria-label="Swap to Last Channel"
                        title={previousBookmark ? `Swap to ${previousBookmark.name}` : "Swap to Last Channel"}
                        style={vButtonStyle}
                        onClick={withInteraction(swapToPreviousChannel)}>
                        <FaExchangeAlt />
                    </button>
                );
            case 'close':
                return null;
        }
    };

    // Same idea for the Control row — one renderer shared by the Picture-
    // mode horizontal bar (all six items, including Volume) and the
    // Expand-mode bottom dock (everything but Volume — see
    // expandControlVisible further down). `hButtonStyle` is defined further
    // below (after buttonScale etc. are computed), so this renderer is only
    // actually called once it's in scope.
    const renderControlButton = (key: ControlItemKey): ReactNode => {
        switch (key) {
            case 'seekBack30':
                return (
                    <button aria-label="Back 30 Seconds" style={hButtonStyle} onClick={withInteraction(seekBack30)}>
                        <MdReplay30 />
                    </button>
                );
            case 'seekBack':
                return (
                    <button aria-label="Back 10 Seconds" style={hButtonStyle} onClick={withInteraction(seekBack)}>
                        <MdReplay10 />
                    </button>
                );
            case 'playPause':
                return (
                    <button aria-label="Play/Pause" style={hButtonStyle} onClick={withInteraction(togglePlayPause)}>
                        {playing ? <FaPause /> : <FaPlay />}
                    </button>
                );
            case 'seekForward':
                return (
                    <button aria-label="Ahead 10 Seconds" style={hButtonStyle} onClick={withInteraction(seekForward)}>
                        <MdForward10 />
                    </button>
                );
            case 'seekForward30':
                return (
                    <button aria-label="Ahead 30 Seconds" style={hButtonStyle} onClick={withInteraction(seekForward30)}>
                        <MdForward30 />
                    </button>
                );
            case 'volume':
                return (
                    <>
                        <div style={{ width: H_ROW_VOLUME_SPACER }} />
                        <button aria-label="Mute" style={hButtonStyle} onClick={withInteraction(toggleMute)}>
                            {muted ? <FaVolumeMute /> : <FaVolumeUp />}
                        </button>
                        <input
                            aria-label="Volume"
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={volume}
                            disabled={muted}
                            onChange={e => { onInteraction(); setGlobalState(state => ({ ...state, volume: Number(e.target.value) })); }}
                            style={{ width: VOLUME_SLIDER_WIDTH, accentColor: 'white', opacity: muted ? 0.4 : 1, marginTop: Math.max(0, (hButtonSize - 20) / 2) }}
                        />
                    </>
                );
        }
    };

    // The side-bar buttons need to stay visible regardless of how short the
    // picture is — at the smallest picture sizes there wasn't enough
    // vertical room at a fixed 44px each. Solving for the largest button
    // size that still fits them all (down to a 20px floor) keeps every
    // control reachable at every picture size, just more compact at the
    // smallest ones. Counted dynamically from the actual visible set above
    // (rather than a fixed constant), with a floor of 1 so the sizing math
    // below never divides by (effectively) zero on the rare setup where
    // every side-bar control has been turned off in Overlay Settings.
    const vNumButtons = Math.max(1, [showMaximizeButton, showPositionButton, showScreenshotButton, showHideButton, showSwapButton]
        .filter(Boolean).length);
    // [Confirmed by Josh, 2026-09-20] — the actual (unfloored) count, so the
    // side bar itself can disappear entirely when every one of its controls
    // has been turned off in Overlay Settings, rather than showing an empty
    // strip the full height of the picture.
    const anyVButtonVisible = showMaximizeButton || showPositionButton || showScreenshotButton || showHideButton || showSwapButton;
    // Same idea for the horizontal transport bar — if every one of Skip
    // Back/Play-Pause/Skip Forward/Volume is off, there's nothing left to
    // show in it (Close, when shown, is its own separate button beyond the
    // bar's end either way, not inside this row).
    const anyHButtonVisible = overlayShowSeekBack30 || overlayShowSeekBack || overlayShowPlayPause || overlayShowSeekForward || overlayShowSeekForward30 || overlayShowVolume;
    // Per-item visibility for the Control row, keyed the same way as
    // controlOrder — lets `controlOrder.filter(...).map(...)` (below, and in
    // the Expand-mode dock) render in the user's own dragged order while
    // still respecting each item's individual overlayShow* toggle.
    const controlButtonVisible: Record<ControlItemKey, boolean> = {
        seekBack30: overlayShowSeekBack30,
        seekBack: overlayShowSeekBack,
        playPause: overlayShowPlayPause,
        seekForward: overlayShowSeekForward,
        seekForward30: overlayShowSeekForward30,
        volume: overlayShowVolume,
    };
    const totalRatio = vNumButtons + (vNumButtons - 1) * GAP_RATIO + 2 * PADDING_RATIO;
    const buttonSize = Math.max(MIN_BUTTON_SIZE, Math.min(MAX_BUTTON_SIZE, height / totalRatio));
    const gap = buttonSize * GAP_RATIO;
    const vPadding = buttonSize * PADDING_RATIO;
    const iconFontSize = buttonSize * FONT_RATIO;

    // How much smaller than its own largest case buttonSize currently is —
    // 1 at the largest picture sizes (today's look, unchanged), smaller for
    // a small picture. Drives every other dimension in this overlay (the
    // side bar's own width, the horizontal bar's height/button size, Close)
    // so the whole thing scales as one unit instead of just the side bar's
    // individual buttons.
    const buttonScale = buttonSize / MAX_BUTTON_SIZE;
    const scaled = (max: number, min: number) => Math.max(min, max * buttonScale);

    const barWidth = scaled(CONTROL_BAR_WIDTH, V_BAR_WIDTH_MIN);
    const hButtonSize = scaled(H_BUTTON_SIZE_MAX, H_BUTTON_SIZE_MIN);
    const hBarHeight = scaled(H_BAR_HEIGHT_MAX, H_BAR_HEIGHT_MIN);
    const hIconFontSize = scaled(H_ICON_FONT_SIZE_MAX, H_ICON_FONT_SIZE_MIN);
    const closeButtonSize = scaled(CLOSE_BUTTON_SIZE_MAX, CLOSE_BUTTON_SIZE_MIN);
    const closeIconFontSize = scaled(CLOSE_ICON_FONT_SIZE_MAX, CLOSE_ICON_FONT_SIZE_MIN);

    const vButtonStyle: CSSProperties = {
        background: 'none',
        border: 'none',
        color: 'white',
        cursor: 'pointer',
        width: buttonSize,
        minHeight: buttonSize,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        fontSize: iconFontSize,
    };

    const hButtonStyle: CSSProperties = {
        background: 'none',
        border: 'none',
        color: 'white',
        cursor: 'pointer',
        width: hButtonSize,
        height: hButtonSize,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        fontSize: hIconFontSize,
    };

    // The side bar's own outer (far-from-picture) edge is where the two
    // segments join — the picture's free OUTER corner, diagonally away from
    // wherever the picture is anchored. For verticalSide 'left' that's the
    // side bar's LEFT edge, so the horizontal segment starts there and
    // reaches rightward, back across the picture. For verticalSide 'right'
    // it's the side bar's RIGHT edge instead, so the horizontal segment has
    // to reach LEFTWARD from there instead — this was previously hardcoded
    // to always extend rightward regardless of which side the bar was on,
    // which sent the horizontal segment shooting off away from the picture
    // (rather than across it) whenever verticalSide was 'right'.
    const barX = verticalSide === 'left' ? x - barWidth - GAP_FROM_PICTURE : x + width + GAP_FROM_PICTURE;
    // The horizontal bar's own width — sized to fit only the buttons that
    // are actually on, in every mode now (see the comment on H_BAR_HEIGHT_MIN
    // etc. above for why this changed from Connected mode separately
    // tracking the picture's own width). Computed here from the exact same
    // items/gap/padding the actual row below renders, in the same
    // left-to-right order, so this always matches what's really on screen.
    const hItemWidths: number[] = [];
    if (overlayShowSeekBack30) hItemWidths.push(hButtonSize);
    if (overlayShowSeekBack) hItemWidths.push(hButtonSize);
    if (overlayShowPlayPause) hItemWidths.push(hButtonSize);
    if (overlayShowSeekForward) hItemWidths.push(hButtonSize);
    if (overlayShowSeekForward30) hItemWidths.push(hButtonSize);
    if (overlayShowVolume) hItemWidths.push(H_ROW_VOLUME_SPACER, hButtonSize, VOLUME_SLIDER_WIDTH);
    const hContentWidth = hItemWidths.reduce((sum, w) => sum + w, 0) + Math.max(0, hItemWidths.length - 1) * H_ROW_GAP;
    const hIntrinsicWidth = hContentWidth + H_ROW_H_PADDING * 2;
    const hBarWidth = hIntrinsicWidth;
    // [Confirmed by Josh, 2026-09-20] Connected (the default) keeps the two
    // segments flush against each other, so the squared-off shared corner
    // below reads as one continuous L-shaped border. Separate used to just
    // pull the horizontal bar's near (joint) end a few pixels away from the
    // side bar's outer edge instead — still hugging that same corner, just
    // with a gap — which read as "leaning off the corner" rather than two
    // genuinely independent pills. It's centered along the picture's own
    // top/bottom edge instead now, same idea as the side bar already
    // centering itself along the picture's own left/right edge in Separate
    // mode (vBarTop below) — completely independent of where the side bar
    // (and its corner) happens to be.
    const hBarLeftRaw = overlayConnected
        ? (verticalSide === 'left' ? barX : barX + barWidth - hBarWidth)
        : x + (width - hBarWidth) / 2;
    // [Confirmed by Josh, 2026-09-20] Widening the volume slider (below)
    // made the whole horizontal bar wide enough that it could run off the
    // real screen's right edge for a picture anchored close to it — clamped
    // back on-screen the same way Close already is (CLOSE_EDGE_PAD below),
    // rather than trusting the picture's own position to always leave
    // enough room. This can pull the bar's near (joined) edge away from the
    // side bar in Connected mode in that edge case, trading the flush join
    // for staying fully visible, which is the right trade.
    const H_BAR_EDGE_PAD = 6;
    const hBarLeft = Math.max(H_BAR_EDGE_PAD, Math.min(hBarLeftRaw, screenBounds.width - hBarWidth - H_BAR_EDGE_PAD));
    // Flush against the side bar's own near edge (y or y + height) with no
    // gap between the two segments — that gap was the "two sausages" look;
    // removing it lets the shared corner (squared off below) read as one
    // continuous L-shaped border instead of two separate floating pills.
    const horizontalY = horizontalSide === 'top' ? y - hBarHeight : y + height;
    // Same shrink-to-content idea, applied to the side bar's own height —
    // [Confirmed by Josh, 2026-09-20] it used to always span the picture's
    // FULL height regardless of how many buttons were actually in it, which
    // (combined with justifyContent: 'center' inside a box far taller than
    // its content) made the buttons look adrift in a lot of empty bar rather
    // than snugly centered. The join with the horizontal bar has to stay
    // flush though — so this only ever trims the FAR (non-joined) end in
    // Connected mode, keeping the near (joined) edge exactly where it was;
    // Separate has no join to preserve, so it centers the shorter bar freely
    // along the picture's own edge instead.
    //
    // [Confirmed by Josh, 2026-09-20] This used to be Math.min(height,
    // vContentHeight) — capping the bar at the picture's own height even
    // when the buttons actually on needed more room than that. At a small
    // enough picture size with enough View buttons enabled, buttonSize hits
    // its MIN_BUTTON_SIZE floor and vContentHeight can end up taller than
    // the picture itself; the old cap
    // silently clipped whatever didn't fit into this box's invisible
    // overflowY:'auto' scroll region — with no visible scrollbar or any
    // other hint that something was cut off, one or more buttons (whichever
    // came last in the render order) just never appeared at all. Using the
    // content's own height outright — letting the bar's FAR end extend a
    // little past the picture's edge in that edge case rather than clipping
    // — trades a small cosmetic overhang for every enabled button always
    // actually being visible, which matters more.
    const vContentHeight = vNumButtons * buttonSize + Math.max(0, vNumButtons - 1) * gap + vPadding * 2;
    const vBarHeight = vContentHeight;
    const vBarTop = !overlayConnected
        ? y + (height - vBarHeight) / 2
        : horizontalSide === 'top'
            ? y
            : y + height - vBarHeight;

    // The corner where the two segments meet is squared off on both sides
    // (0 radius) so they blend into a single shape when overlayConnected is
    // on; every other corner (and every corner of both bars when
    // overlayConnected is off) keeps its full pill-style rounding as a free
    // "end cap". The vertical bar's join is always its two corners on the
    // horizontalSide edge (the horizontal segment's width fully covers the
    // vertical bar's own width either way, so both of those corners sit
    // flush underneath/above it). The horizontal bar's join is on its LEFT
    // corner when verticalSide is 'left' (it starts at the side bar's outer
    // edge) or its RIGHT corner when verticalSide is 'right' (it ends at
    // the side bar's outer edge).
    const vRadius = barWidth / 2;
    const hRadius = hBarHeight / 2;
    const vBorderRadius: CSSProperties = !overlayConnected
        ? { borderTopLeftRadius: vRadius, borderTopRightRadius: vRadius, borderBottomLeftRadius: vRadius, borderBottomRightRadius: vRadius }
        : horizontalSide === 'top'
            ? { borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomLeftRadius: vRadius, borderBottomRightRadius: vRadius }
            : { borderTopLeftRadius: vRadius, borderTopRightRadius: vRadius, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 };
    const hJointOnLeft = verticalSide === 'left';
    const hBorderRadius: CSSProperties = !overlayConnected
        ? { borderTopLeftRadius: hRadius, borderTopRightRadius: hRadius, borderBottomLeftRadius: hRadius, borderBottomRightRadius: hRadius }
        : horizontalSide === 'top'
            ? {
                borderBottomLeftRadius: hJointOnLeft ? 0 : hRadius,
                borderBottomRightRadius: hJointOnLeft ? hRadius : 0,
                borderTopLeftRadius: hRadius,
                borderTopRightRadius: hRadius,
            }
            : {
                borderTopLeftRadius: hJointOnLeft ? 0 : hRadius,
                borderTopRightRadius: hJointOnLeft ? hRadius : 0,
                borderBottomLeftRadius: hRadius,
                borderBottomRightRadius: hRadius,
            };

    // The panel's brightness slider (opacity, 0-100) dims the picture's own
    // content — this applies the same fraction to the always-visible on-
    // screen controls, so they dim along with the video rather than staying
    // at full brightness while everything else fades.
    const barOpacity = opacity / 100;

    // Close's raw position, beyond the horizontal bar's far end — clamped to
    // stay fully on the real screen below. [Confirmed by Josh, 2026-09-20]
    // With the picture anchored close to a screen edge, this could land
    // partly or fully off that edge and read as "hidden" — Close is the one
    // button here that should never be unreachable, so it's pulled back
    // in-bounds by CLOSE_EDGE_PAD rather than left to clip.
    const CLOSE_EDGE_PAD = 6;
    const closeLeftRaw = hJointOnLeft ? hBarLeft + hBarWidth + CLOSE_GAP : hBarLeft - CLOSE_GAP - closeButtonSize;
    const closeTopRaw = horizontalY + (hBarHeight - closeButtonSize) / 2;
    const closeLeft = Math.max(CLOSE_EDGE_PAD, Math.min(closeLeftRaw, screenBounds.width - closeButtonSize - CLOSE_EDGE_PAD));
    const closeTop = Math.max(CLOSE_EDGE_PAD, Math.min(closeTopRaw, screenBounds.height - closeButtonSize - CLOSE_EDGE_PAD));

    // [Confirmed by Josh, 2026-09-20] Expand mode's own bottom-center dock —
    // Back 10s/Play-Pause/Forward 10s in one small pill plus Close just past
    // it, both centered along the bottom of the whole screen rather than
    // anchored to a floating picture that (in Expand mode) no longer exists.
    // Each still respects its own Overlay Settings toggle, same as every
    // other overlay control.
    const showExpandBottomBar = viewMode === ViewMode.Expand;
    const expandSeekBack30 = showExpandBottomBar && overlayShowSeekBack30;
    const expandSeekBack = showExpandBottomBar && overlayShowSeekBack;
    const expandPlayPause = showExpandBottomBar && overlayShowPlayPause;
    const expandSeekForward = showExpandBottomBar && overlayShowSeekForward;
    const expandSeekForward30 = showExpandBottomBar && overlayShowSeekForward30;
    const expandClose = showExpandBottomBar && overlayShowClose;
    // Same key-lookup pattern as controlButtonVisible above, for the
    // Expand-mode dock's own transport row — Volume never appears there
    // (there's no room/need for a slider in this small bottom dock), so
    // it's always false regardless of overlayShowVolume.
    const expandControlVisible: Record<ControlItemKey, boolean> = {
        seekBack30: expandSeekBack30,
        seekBack: expandSeekBack,
        playPause: expandPlayPause,
        seekForward: expandSeekForward,
        seekForward30: expandSeekForward30,
        volume: false,
    };
    const anyExpandTransportButton = expandSeekBack30 || expandSeekBack || expandPlayPause || expandSeekForward || expandSeekForward30;
    const anyExpandBottomButton = anyExpandTransportButton || expandClose;
    const expandTransportItemCount = [expandSeekBack30, expandSeekBack, expandPlayPause, expandSeekForward, expandSeekForward30].filter(Boolean).length;
    const expandTransportContentWidth = expandTransportItemCount * hButtonSize + Math.max(0, expandTransportItemCount - 1) * H_ROW_GAP;
    const expandTransportWidth = expandTransportContentWidth + H_ROW_H_PADDING * 2;
    const expandGroupWidth = (anyExpandTransportButton ? expandTransportWidth : 0)
        + (expandClose ? (anyExpandTransportButton ? CLOSE_GAP : 0) + closeButtonSize : 0);
    const expandGroupHeight = Math.max(anyExpandTransportButton ? hBarHeight : 0, expandClose ? closeButtonSize : 0);
    const expandGroupLeft = Math.max(0, (screenBounds.width - expandGroupWidth) / 2);
    const expandGroupTop = screenBounds.height - EXPAND_BOTTOM_MARGIN - expandGroupHeight;

    const collapsedLineHeight = Math.round(height * 0.4);
    const collapsedX = verticalSide === 'left' ? barX + barWidth - COLLAPSED_TAP_WIDTH : barX;

    if (!expanded) {
        // Collapsed to a single thin tab along the side bar's own position
        // (vertically centered on the picture) — tapping it reveals both
        // segments (and Close) together, same as before this L-shaped
        // redesign.
        return (
            <div
                style={{
                    position: 'absolute',
                    zIndex: 7001,
                    left: collapsedX,
                    top: y,
                    width: COLLAPSED_TAP_WIDTH,
                    height,
                    display: 'flex',
                    cursor: 'pointer',
                }}
                onClick={show}
            >
                <div style={{
                    width: COLLAPSED_LINE_WIDTH,
                    height: collapsedLineHeight,
                    background: 'rgba(40, 40, 40, 0.6)',
                    borderRadius: COLLAPSED_LINE_WIDTH / 2,
                    margin: 'auto',
                    opacity: barOpacity,
                }} />
            </div>
        );
    }

    return (
        <>
            {anyVButtonVisible && (
            <div
                style={{
                    position: 'absolute',
                    zIndex: 7001,
                    left: barX,
                    top: vBarTop,
                    width: barWidth,
                    height: vBarHeight,
                    background: 'rgba(40, 40, 40, 0.6)',
                    opacity: barOpacity,
                    ...vBorderRadius,
                    boxSizing: 'border-box',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap,
                    padding: `${vPadding}px 0`,
                }}
            >
                {/* Maximize, Screenshot, Hide, Swap — Close lives in the
                    bottom-center dock instead of here (see
                    showExpandBottomBar below). Render order now follows the
                    user's own viewOrder (overlaySettingsModal.tsx's drag
                    handles) rather than a fixed sequence — every button here
                    still gets a native `title` tooltip, matching Swap/
                    Screenshot, which previously had them. */}
                {viewOrder.filter(key => viewButtonVisible[key]).map(key => (
                    <Fragment key={key}>{renderViewButton(key)}</Fragment>
                ))}
            </div>
            )}
            {viewMode !== ViewMode.Expand && (
                <>
                    {anyHButtonVisible && (
                    <div
                        style={{
                            position: 'absolute',
                            zIndex: 7001,
                            left: hBarLeft,
                            top: horizontalY,
                            width: hBarWidth,
                            height: hBarHeight,
                            background: 'rgba(40, 40, 40, 0.6)',
                            opacity: barOpacity,
                            ...hBorderRadius,
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: H_ROW_GAP,
                            // [Confirmed by Josh, 2026-09-20] alignItems was
                            // 'flex-start' here, which pinned every button to
                            // the bar's own top edge instead of centering
                            // them in it — the actual cause of the row
                            // looking uncentered, not something padding
                            // alone could fix. The extra top-only padding
                            // below now only applies when this bar sits
                            // right beneath the picture's bottom edge, next
                            // to the now-playing text rendered there — see
                            // H_ROW_SHIFT_DOWN's own comment.
                            padding: horizontalSide === 'bottom' ? `${H_ROW_SHIFT_DOWN}px ${H_ROW_H_PADDING}px 0` : `0 ${H_ROW_H_PADDING}px`,
                        }}
                    >
                        {/* Render order follows the user's own controlOrder
                            (overlaySettingsModal.tsx's drag handles) rather
                            than a fixed sequence. */}
                        {controlOrder.filter(key => controlButtonVisible[key]).map(key => (
                            <Fragment key={key}>{renderControlButton(key)}</Fragment>
                        ))}
                    </div>
                    )}
                    {/* Separate from both segments — a visible gap beyond the
                        horizontal bar's own free (non-joined) rounded end,
                        so Close reads as its own distinct action rather than
                        another transport button or a side-bar toggle. That
                        free end is on the right when the bar reaches
                        rightward (verticalSide 'left') or on the left when
                        it reaches leftward instead (verticalSide 'right').
                        Anchored off hBarLeft/hBarWidth regardless of whether
                        the transport bar itself is showing, so Close stays
                        in a sensible spot even if every transport button is
                        hidden. */}
                    {overlayShowClose && (
                    <button
                        aria-label="Close"
                        onClick={withInteraction(close)}
                        style={{
                            position: 'absolute',
                            zIndex: 7001,
                            left: closeLeft,
                            top: closeTop,
                            width: closeButtonSize,
                            height: closeButtonSize,
                            borderRadius: closeButtonSize / 2,
                            background: CLOSE_BG,
                            opacity: barOpacity,
                            border: 'none',
                            color: 'white',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: 0,
                            fontSize: closeIconFontSize,
                        }}
                    >
                        <FaTimes />
                    </button>
                    )}
                </>
            )}
            {anyExpandBottomButton && (
                <div
                    style={{
                        position: 'absolute',
                        zIndex: 7001,
                        left: expandGroupLeft,
                        top: expandGroupTop,
                        width: expandGroupWidth,
                        height: expandGroupHeight,
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: CLOSE_GAP,
                    }}
                >
                    {anyExpandTransportButton && (
                        <div
                            style={{
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: H_ROW_GAP,
                                width: expandTransportWidth,
                                height: hBarHeight,
                                background: 'rgba(40, 40, 40, 0.6)',
                                opacity: barOpacity,
                                borderRadius: hBarHeight / 2,
                                boxSizing: 'border-box',
                                padding: `0 ${H_ROW_H_PADDING}px`,
                            }}
                        >
                            {/* Same controlOrder-driven render order as the
                                Picture-mode horizontal bar — this dock
                                mirrors the same control set, minus Volume
                                (see expandControlVisible above). */}
                            {controlOrder.filter(key => expandControlVisible[key]).map(key => (
                                <Fragment key={key}>{renderControlButton(key)}</Fragment>
                            ))}
                        </div>
                    )}
                    {expandClose && (
                        <button
                            aria-label="Close"
                            title="Close"
                            onClick={withInteraction(close)}
                            style={{
                                width: closeButtonSize,
                                height: closeButtonSize,
                                borderRadius: closeButtonSize / 2,
                                background: CLOSE_BG,
                                opacity: barOpacity,
                                border: 'none',
                                color: 'white',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 0,
                                fontSize: closeIconFontSize,
                                flexShrink: 0,
                            }}
                        >
                            <FaTimes />
                        </button>
                    )}
                </div>
            )}
        </>
    );
};
