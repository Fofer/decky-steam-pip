import {
    Focusable,
    PanelSection,
    PanelSectionRow,
    SliderField,
    showModal,
    ButtonItem,
    quickAccessMenuClasses,
} from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { FaCog, FaPlay, FaPause, FaChevronUp, FaChevronDown, FaEye, FaEyeSlash, FaTimes, FaVolumeUp, FaVolumeMute, FaInfoCircle, FaMousePointer, FaTv, FaSun, FaThumbtack, FaExchangeAlt, FaCamera } from "react-icons/fa";
import { MdReplay10, MdForward10, MdReplay30, MdForward30, MdPhotoSizeSelectLarge, MdCropFree } from "react-icons/md";
import { toaster } from "@decky/api";
import { backendCallWithTimeout } from "./backendCall";
import { AudioEqBars, ensureEqKeyframes } from "./audioEqIcon";

import { Position, SIZE_MAX, SIZE_MIN, ViewMode, advanceMaximize, currentMaximizeStep, hexToRgba, maximizeTitle, shortenPathForToast } from "./util";
import { MaximizeIcon } from "./maximizeIcon";
import { nowPlayingLabel } from "./nowPlayingLabel";
import { Bookmark, useGlobalState, withUrlChange } from "./globalState";
import { usePipBounds } from "./pipBounds";
import { useScreenBounds } from "./screen";
import { ReorderModalWithState } from "./reorderModal";
import { ChannelPickerModalWithState } from "./channelPickerModal";
import { channelIcon } from "./channelIcon";
import { useChannelNowPlaying } from "./useChannelNowPlaying";

// A spatial 3x3 grid (center cell unused) standing in for the 8
// screen positions, so picking one is "click the corner/edge you want"
// rather than scanning a dropdown list — replaces the old position
// dropdown, which read as a plain list with no visual relationship to
// where the picture would actually end up.
// Shrunk ~30% from an earlier 44px per explicit request, once there was
// visibly enough room to spare.
const GRID_CELL = 32;

// [Confirmed by Josh, 2026-09-20] `isCurrent` (blue fill) marks the
// already-confirmed position; `isFocused` is a separate, additive highlight
// for whichever cell the D-pad has moved onto but not yet pressed A on —
// without it, navigating this grid by controller was "blind": nothing
// showed which cell was about to be selected until after committing to it,
// so the only way to know was to guess, hit A, and check where the picture
// landed. A focused cell gets a bright white ring + a lighter fill,
// distinct from (and layered on top of, when both are true) the current
// cell's own blue fill — so "this is where I am" and "this is what's
// already selected" never get confused for each other.
const gridButtonStyle = (isCurrent: boolean, isFocused: boolean): CSSProperties => ({
    width: GRID_CELL,
    height: GRID_CELL,
    borderRadius: '50%',
    background: isCurrent
        ? 'rgba(90, 170, 255, 0.9)'
        : (isFocused ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.08)'),
    border: isFocused
        ? '2px solid rgba(255, 255, 255, 1)'
        : (isCurrent ? '2px solid rgba(255, 255, 255, 0.9)' : '2px solid rgba(255, 255, 255, 0.25)'),
    boxShadow: isFocused ? '0 0 0 3px rgba(255, 255, 255, 0.35)' : 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    color: 'white',
    lineHeight: 1,
    transition: 'background 100ms, box-shadow 100ms, border-color 100ms',
});

// One cell of the position grid, with its own focused/not-focused tracking —
// same pattern as IconButton above, needed here because (unlike IconButton's
// square buttons) each cell also has its own independent "isCurrent" look to
// layer the focus highlight on top of rather than replace.
const GridCell = ({ position, current, glyph, onSelect }: { position: Position, current: Position, glyph: string, onSelect: (position: Position) => void }) => {
    const [focused, setFocused] = useState(false);
    return <Focusable
        style={gridButtonStyle(position === current, focused)}
        onActivate={() => onSelect(position)}
        onClick={() => onSelect(position)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}>
        {glyph}
    </Focusable>;
};

// Small, fixed-size icon buttons used for every icon row in this panel
// (channel management, playback, Expand/Hide/Close) so they all match. A
// ButtonItem carries enough of its own fixed padding/min-width that a row
// of them overflowed the QAM panel's width — these are plain Focusable
// squares instead. Sized down from an earlier 36px once a 6th icon (Export/
// Import) pushed the channel-management row wide enough to clip its last
// button.
// Shrunk twice now (44 -> 30/8 -> 28/6 -> this) and the icon rows' own left
// padding dropped to 0 below — together these reclaim just enough width
// that all 7 icons in the channel-management row reliably fit without the
// last one or two clipping off the QAM panel's right edge on first open,
// even before the panel has been interacted with (some hardware appears to
// render the QAM panel a little narrower on its very first open than after
// it's been resized/refocused once).
const ICON_BUTTON_SIZE = 26;
const ICON_ROW_GAP = 5;
// [Confirmed by Josh, 2026-09-21] The gap between Mute and the transport
// buttons on the playback row — deliberately wider than ICON_ROW_GAP (the
// even spacing between the transport buttons themselves) so Mute still
// reads as its own separate thing on that shared line, not a sixth
// transport button.
const MUTE_BUFFER = 16;

const iconButtonStyle = (focused: boolean, active: boolean, size: number = ICON_BUTTON_SIZE): CSSProperties => ({
    width: size,
    height: size,
    borderRadius: 8,
    background: active ? 'rgba(90, 170, 255, 0.9)' : (focused ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.08)'),
    border: focused ? '2px solid rgba(255, 255, 255, 0.9)' : (active ? '2px solid rgba(255, 255, 255, 0.9)' : '2px solid rgba(255, 255, 255, 0.25)'),
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    color: 'white',
    lineHeight: 1,
    flexShrink: 0,
});

// Wraps a single icon button with its own focused/not-focused state, since
// most of these buttons (unlike the position grid, where the selected cell
// stays highlighted regardless of focus) have nothing else to show which
// one the D-pad would activate next. `active` is for the few that also
// double as an on/off toggle (Expand, Hide) — it paints the button blue
// whether or not it's currently focused, same blue the position grid uses
// for its selected cell.
// `title` uses the plain HTML title attribute (Focusable passes through
// div attributes), which the underlying Chromium browser already shows as
// a native tooltip on mouse hover — no separate tooltip component needed.
// It's just an extra explanation for anyone using a mouse/trackpad; D-pad
// navigation obviously can't "hover", so icons still need to stand on
// their own for controller-only use.
// The native `title` attribute only ever shows up as a tooltip on mouse/
// trackpad hover — a D-pad "focused" button never triggers it, no matter
// how long it sits highlighted. So a controller-only user gets no
// equivalent hint at all, just a pulsing icon with no label. This adds that
// equivalent by hand: after the button's been focused (not just hovered)
// for a few seconds, a plain tooltip bubble fades in above it, matching
// what the mouse/trackpad already gets from `title` on hover. Hover still
// gets the instant native tooltip on top of this — the two aren't mutually
// exclusive, they just serve different input methods.
const TOOLTIP_DELAY_MS = 3000;

// [Confirmed by Josh, 2026-09-20] QAM Layout's "Use Color" toggle
// (qamUseColor) is OFF by default, and while it's off the QAM panel's own
// Play/Pause button and the title bar's Close button are plain — no
// background tint at all, same as every other icon button in this panel —
// rather than the green/blue/red these used to always show. Turning the
// toggle on is what applies color at all, using the user's own picked hex
// colors (qamPlayColor/qamPauseColor/qamCloseColor) combined with a fixed
// alpha via hexToRgba below. Those hex values are still seeded (in
// index.tsx's DEFAULTS) with green/blue/red equivalents, so the first time
// someone turns the toggle on, that's the color they see before picking
// anything else — the green/blue/red look isn't gone, it's just opt-in now.
const QAM_COLOR_ALPHA = 0.55;
const QAM_CLOSE_COLOR_ALPHA = 0.35;

export const IconButton = ({ onActivate, active, title, size, style, children }: { onActivate: () => void, active?: boolean, title?: string, size?: number, style?: CSSProperties, children: ReactNode }) => {
    const [focused, setFocused] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);
    const timerRef = useRef<number | null>(null);

    const clearTimer = () => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    const handleFocus = () => {
        setFocused(true);
        clearTimer();
        if (title) {
            timerRef.current = window.setTimeout(() => setShowTooltip(true), TOOLTIP_DELAY_MS);
        }
    };

    const handleBlur = () => {
        setFocused(false);
        setShowTooltip(false);
        clearTimer();
    };

    useEffect(() => clearTimer, []);

    return <div style={{ position: 'relative', flexShrink: 0 }}>
        <Focusable
            style={{ ...iconButtonStyle(focused, !!active, size), ...style }}
            title={title}
            onActivate={onActivate}
            onClick={onActivate}
            onFocus={handleFocus}
            onBlur={handleBlur}>
            {children}
        </Focusable>
        {showTooltip && title && (
            <div style={{
                position: 'absolute',
                bottom: '100%',
                left: '50%',
                transform: 'translateX(-50%)',
                marginBottom: 6,
                background: 'rgba(20, 20, 20, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                color: 'white',
                whiteSpace: 'nowrap',
                zIndex: 100,
                pointerEvents: 'none',
            }}>
                {title}
            </div>
        )}
    </div>;
};

// A generic "this is off" marker drawn over any icon — a diagonal line the
// same way FaEyeSlash bakes a slash into its own glyph, but usable with any
// icon rather than needing a dedicated off-variant to exist for it (there's
// no ready-made "info circle with a slash" icon in the icon sets already in
// use here).
const SlashedIcon = ({ children }: { children: ReactNode }) => (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
        <div style={{
            position: 'absolute',
            width: '140%',
            height: 2,
            background: 'currentColor',
            transform: 'rotate(-45deg)',
        }} />
    </div>
);

// Same idea as SlashedIcon above, but marks "locked on" rather than "off" —
// a small pin badge layered onto the corner of whatever icon it wraps.
// [Confirmed by Josh, 2026-09-20] On-Screen Controls' third state used to
// swap its whole icon out for a bare pin, which read as a different,
// unrelated icon rather than a state of the same control — keeping the
// base glyph the same across all three states (plain, slashed, or pinned)
// and only ever changing the badge on top of it is more consistent.
const PinnedIcon = ({ children }: { children: ReactNode }) => (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {children}
        <div style={{
            position: 'absolute',
            bottom: -4,
            right: -6,
            fontSize: '0.55em',
            display: 'flex',
        }}>
            <FaThumbtack />
        </div>
    </div>
);

// The icon for the combined Hide/audio-badge toggle below — carries all
// three of its states itself (plain eye, eye-slash, or eye-slash with a
// small pulsing equalizer badge) rather than needing a second button next
// to it just to say whether the badge will show once hidden.
const HideAudioIcon = ({ hidden, audioIndicatorEnabled }: { hidden: boolean, audioIndicatorEnabled: boolean }) => {
    if (!hidden) return <FaEye />;
    if (!audioIndicatorEnabled) return <FaEyeSlash />;
    return (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <FaEyeSlash />
            <div style={{ position: 'absolute', bottom: -5, right: -7 }}>
                <AudioEqBars height={6} barWidth={1.6} gap={1.4} />
            </div>
        </div>
    );
};

// [Confirmed by Josh, 2026-09-20] Widening this slider to fill its row
// (flex: 1) fixed how much of it there was to grab, but a plain native
// <input type="range"> isn't part of Decky's own gamepad-navigation graph at
// all — only Focusable components are — so the D-pad could never land on it
// to begin with, wide or not; only a mouse/trackpad cursor could actually
// [Confirmed by Josh, 2026-09-20 → corrected 2026-09-21 after hardware
// testing] The plain native <input type="range"> tried here — even widened
// to fill the row and wrapped in a Focusable with manual DIR_LEFT/DIR_RIGHT
// handling — never actually became D-pad-selectable. A native range input
// simply isn't part of Steam's gamepad-nav focus graph, wrapper or not: the
// D-pad cursor skipped straight over the whole row (Mute stayed reachable,
// but nothing below or above it could land on the slider itself), and
// dragging it was mouse/trackpad-only the entire time, exactly the
// limitation this was meant to fix. Switched to Decky's own SliderField
// instead — the same real, gamepad-nav-integrated slider already used for
// Size/Margin/Brightness above (and visibly working/selectable in Josh's
// own screenshot) — which is Valve's actual D-pad-drivable widget
// (minimumDpadGranularity exists specifically for stepping it with a
// controller). The earlier note about SliderField "ignoring a narrow
// wrapping div and always rendering full width" was about forcing it to sit
// narrowly beside the Mute button in one flex row; giving it its own full
// PanelSectionRow — same as every other SliderField in this file — avoids
// that fight entirely rather than working around it.

// The full-width "what am I watching" button that replaced Decky's native
// Channel DropdownItem (see the comment where it's used, below, for why).
// Left-justified icon + name, growing to fill whatever width the row gives
// it (flex: 1) so the Channel Surf up/down buttons docked beside it are the
// only thing constraining its width — exactly the "fill up that whole top
// section" layout asked for, without touching where those buttons sit.
const channelButtonStyle = (focused: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    height: 40,
    borderRadius: 8,
    background: focused ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.08)',
    border: focused ? '2px solid rgba(255, 255, 255, 0.9)' : '2px solid rgba(255, 255, 255, 0.25)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: '0 10px',
    color: 'white',
});

// Guide text used to render as a second line inside this button (see
// nowPlayingTitle in an earlier version), but this button's own width is
// squeezed by the icon columns flanking it on both sides (Add/Edit, Swap/
// Screenshot, Previous/Next) — nowhere near enough room for a real guide
// title before it got clipped. That text now renders in its own full-width
// row below the whole channel row instead (see Settings, below), so this
// button only ever needs to fit the channel's own name.
const ChannelButton = ({ bookmark, onActivate }: { bookmark: Bookmark | undefined, onActivate: () => void }) => {
    const [focused, setFocused] = useState(false);

    return <Focusable
        style={channelButtonStyle(focused)}
        title="Choose Channel"
        onActivate={onActivate}
        onClick={onActivate}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}>
        <div style={{ fontSize: 16, flexShrink: 0, display: 'flex' }}>
            {bookmark ? channelIcon(bookmark) : <FaTv />}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'bold' }}>
            {bookmark ? bookmark.name : 'Custom'}
        </div>
    </Focusable>;
};

// D-pad navigation between these buttons needs Steam's own gamepad-nav
// system to know which button is above/below/left/right of which — a CSS
// grid alone doesn't tell it that (it only saw a flat pile of buttons,
// which is why the D-pad couldn't move between them and only the
// trackpad/mouse worked). Nesting Focusable rows inside a Focusable
// column, matching the actual visual rows, is the pattern Steam's own
// grids (the game library, etc.) use for this.
const ROWS: { position: Position | null, glyph: string }[][] = [
    [
        { position: Position.TopLeft, glyph: '↖' },
        { position: Position.Top, glyph: '↑' },
        { position: Position.TopRight, glyph: '↗' },
    ],
    [
        { position: Position.Left, glyph: '←' },
        { position: null, glyph: '' },
        { position: Position.Right, glyph: '→' },
    ],
    [
        { position: Position.BottomLeft, glyph: '↙' },
        { position: Position.Bottom, glyph: '↓' },
        { position: Position.BottomRight, glyph: '↘' },
    ],
];

const PositionGrid = ({ current, onSelect }: { current: Position, onSelect: (position: Position) => void }) => {
    return <Focusable
        style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', margin: '4px 0' }}
        flow-children="vertical"
    >
        {ROWS.map((row, rowIndex) => (
            <Focusable
                key={rowIndex}
                style={{ display: 'flex', flexDirection: 'row', gap: 8 }}
                flow-children="horizontal"
            >
                {row.map(({ position, glyph }, colIndex) =>
                    position === null
                        ? <div key={colIndex} style={{ width: GRID_CELL, height: GRID_CELL }} />
                        : <GridCell key={position} position={position} current={current} glyph={glyph} onSelect={onSelect} />
                )}
            </Focusable>
        ))}
    </Focusable>;
};

// The "Display" collapsible section header (Position/Size/Margin/Brightness)
// used to have no focus indicator of its own at all — a D-pad user landing
// on it saw no visual change from any other unfocused row, nothing telling
// them A would expand/collapse the section beneath. Same focused-tracking
// pattern as IconButton/GridCell above, applied to a text row instead of an
// icon: on focus, a background/border highlight appears behind the chevron
// + "Display" text together, exactly like every other focusable control in
// this panel already gets.
const DisplayHeaderToggle = ({ collapsed, onToggle }: { collapsed: boolean, onToggle: () => void }) => {
    const [focused, setFocused] = useState(false);
    return <Focusable
        style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            marginTop: 4,
            padding: '4px 8px',
            margin: '4px -8px 0',
            borderRadius: 6,
            background: focused ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
            border: focused ? '2px solid rgba(255, 255, 255, 0.9)' : '2px solid transparent',
        }}
        flow-children="horizontal"
        onActivate={onToggle}
        onClick={onToggle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}>
        {collapsed ? <FaChevronDown /> : <FaChevronUp />}
        <div>Display</div>
    </Focusable>;
};

// Replaces the plugin's plain text-only title (set via definePlugin's
// titleView in index.tsx) with a row matching Decky's own CSS Loader plugin:
// the title on the left, and a couple of small icon buttons all by
// themselves at the top-right corner — Close and Manage Channels ("Settings"
// gear, matching CSS Loader's own gear icon for its equivalent action)
// moved up here from lower in the panel per explicit feedback, so they're
// always reachable without scrolling and the rows underneath aren't
// cluttered with them anymore. Needs the same GlobalContext the rest of the
// panel uses, so index.tsx wraps this in a Provider the same way it already
// does for the panel's own content.
export const TitleBar = () => {
    const [{ qamUseColor, qamCloseColor }, setGlobalState, stateContext] = useGlobalState();
    // undefined (not a fixed red) when qamUseColor is off — see that
    // toggle's own comment above for why plain is now the off-state default.
    const closeStyle: CSSProperties | undefined = qamUseColor ? { background: hexToRgba(qamCloseColor, QAM_CLOSE_COLOR_ALPHA) } : undefined;

    return (
        <Focusable
            style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
            flow-children="horizontal">
            <div className={quickAccessMenuClasses.Title}>Steam PiP</div>
            <Focusable
                style={{ display: 'flex', flexDirection: 'row', gap: 6, flexShrink: 0 }}
                flow-children="horizontal">
                <IconButton
                    title="Close"
                    style={closeStyle}
                    onActivate={() => setGlobalState(state => ({
                        ...state,
                        viewMode: ViewMode.Closed,
                        hidden: false
                    }))}>
                    <FaTimes />
                </IconButton>
                <IconButton
                    title="Settings"
                    onActivate={() => showModal(<ReorderModalWithState value={stateContext} />)}>
                    <FaCog />
                </IconButton>
            </Focusable>
        </Focusable>
    );
};

export const Settings = () => {
    const [{ viewMode, position, margin, url, previousUrl, size, bookmarks, volume, muted, opacity, hidden, showNowPlaying, defaultEpgUrl, playing, controlBarEnabled, controlBarAlwaysVisible, appearanceCollapsed, audioIndicatorEnabled, screenshotEnabled, screenshotSaveDir, nowPlaying, qamShowSeekBack30, qamShowSeekBack, qamShowSeekForward, qamShowSeekForward30, qamShowPlayPause, qamShowVolume, qamUseColor, qamPlayColor, qamPauseColor }, setGlobalState, stateContext] = useGlobalState();
    const currentBookmark = bookmarks.find(b => b.url === url);
    const previousBookmark = bookmarks.find(b => b.url === previousUrl);
    const swapAvailable = !!previousUrl && previousUrl !== url;
    const pipBounds = usePipBounds();
    const screenBounds = useScreenBounds();
    // A channel's own guide URL wins if it has one; otherwise this is what
    // decides whether there's any guide data to show at all — unless this
    // bookmark isn't really a live channel (YouTube, a website, etc.), which
    // opts out of the default guide fallback entirely (Bookmark.noGuide).
    const effectiveEpgUrl = currentBookmark?.noGuide ? undefined : (currentBookmark?.epgUrl || defaultEpgUrl || undefined);

    // Steps to the next/previous bookmark in the list, wrapping around at
    // either end, so repeated presses "surf" through every saved channel
    // without opening the Channel dropdown each time. If the current URL
    // isn't a saved bookmark (a custom one-off URL), surfing starts from
    // the first channel in the list. Channels marked hidden (via Manage
    // Channels' eye icon) are skipped entirely, same as they're left out of
    // the Channel picker.
    const visibleBookmarks = bookmarks.filter(b => !b.hidden);
    const surfChannels = (direction: 1 | -1) => {
        if (visibleBookmarks.length === 0) return;
        const currentIndex = visibleBookmarks.findIndex(b => b.url === url);
        const nextIndex = currentIndex === -1
            ? 0
            : (currentIndex + direction + visibleBookmarks.length) % visibleBookmarks.length;
        const next = visibleBookmarks[nextIndex];
        setGlobalState(state => ({
            ...withUrlChange(state, next.url),
            visible: true,
            viewMode: ViewMode.Picture,
            playing: true
        }));
    };

    // Jumps straight back to whichever channel was loaded right before this
    // one — a TV remote's "last channel" button. previousUrl is tracked
    // automatically by withUrlChange every time the channel actually
    // changes (see globalState.tsx), so this doesn't need its own history
    // bookkeeping.
    const swapToPreviousChannel = () => {
        if (!previousUrl || previousUrl === url) return;
        setGlobalState(state => ({
            ...withUrlChange(state, previousUrl),
            visible: true,
            viewMode: ViewMode.Picture,
            playing: true
        }));
    };

    // Grabs a freeze-frame of the picture as it currently looks. The
    // picture itself renders through Steam's native CreateBrowserView, not
    // a DOM element (see pip.tsx), so there's no way to just draw it to a
    // <canvas> from here the way a normal <video> could be — this hands the
    // job to the backend instead, which takes a full screenshot and crops
    // it down to the picture's own current on-screen rectangle.
    // [Unverified] Exactly which screenshot tool (if any) is actually
    // available, and whether this plugin's own on-screen coordinate space
    // lines up 1:1 with the real display's pixels on this hardware, isn't
    // something that could be confirmed without testing on the actual
    // Steam Machine — see main.py's take_screenshot for the fallback chain
    // and how it reports back what happened.
    const takeScreenshot = async () => {
        // Fires the on-screen flash + shutter sound right away, before the
        // backend call below even starts — see screenshotFlashSeq's own
        // comment in globalState.tsx for why this doesn't wait on whether
        // the save actually succeeds.
        setGlobalState(state => ({ ...state, screenshotFlashSeq: state.screenshotFlashSeq + 1 }));
        try {
            // take_screenshot can legitimately take a while — the backend
            // tries several screenshot tools in turn before giving up (see
            // main.py) — so this gets its own longer timeout instead of
            // backendCall's normal 5s, which is sized for quick lookups.
            // screenBounds' width/height are also passed through — the
            // backend compares them to the real captured image's own pixel
            // dimensions and rescales the crop if they don't match, since
            // they can come from a different coordinate space entirely on a
            // Steam Machine (see pipBounds.tsx/screen.tsx's own comments,
            // and main.py's take_screenshot for the fix this enables).
            const result = await backendCallWithTimeout<[number, number, number, number, string, number, number, string], { path?: string, error?: string, tool?: string }>(
                35000, "take_screenshot", pipBounds.x, pipBounds.y, pipBounds.width, pipBounds.height, screenshotSaveDir, screenBounds.width, screenBounds.height, nowPlayingLabel(nowPlaying));
            if (result?.error) {
                toaster.toast({ title: "Steam PiP", body: `Screenshot failed: ${result.error}` });
                setGlobalState(state => ({ ...state, lastScreenshotResult: `Failed: ${result.error}` }));
            } else if (result?.path) {
                // Full path always goes to lastScreenshotResult (readable at
                // leisure in Screenshot Settings); the toast only gets a
                // shortened version so it doesn't get cut off — see
                // shortenPathForToast's own comment in util.tsx.
                toaster.toast({ title: "Steam PiP", body: `Saved: ${shortenPathForToast(result.path)}` });
                setGlobalState(state => ({ ...state, lastScreenshotResult: result.path! }));
            }
        } catch (e) {
            toaster.toast({ title: "Steam PiP", body: String(e) });
            setGlobalState(state => ({ ...state, lastScreenshotResult: `Failed: ${e}` }));
        }
    };

    useEffect(() => {
        setGlobalState(state => ({
            ...state,
            visible: true,
            viewMode: state.viewMode == ViewMode.Closed
                ? ViewMode.Picture
                : state.viewMode
        }));
    }, []);

    // Registers the pulsing-bars @keyframes (audioEqIcon.tsx) the first time
    // this panel actually needs to show them on the combined Hide/audio-
    // badge button below, same lazy-injection idea as MinimizedIndicator's
    // own use of the same helper.
    useEffect(() => {
        if (hidden && audioIndicatorEnabled) ensureEqKeyframes();
    }, [hidden, audioIndicatorEnabled]);

    // Annotates the Channel dropdown itself with what's currently airing on
    // each channel, not just whichever one is loaded — so channel surfing
    // (or just opening the dropdown) shows what's on before picking, not
    // only after. Only runs at all while this panel is open (mounting/
    // unmounting with it), and not when guide data is turned off. Shared
    // with channelPickerModal.tsx's own "Choose a Channel" list via
    // useChannelNowPlaying — see that file's own comment.
    const channelNowPlaying = useChannelNowPlaying(bookmarks, defaultEpgUrl, showNowPlaying);

    return <>
        <PanelSection>
            {viewMode == ViewMode.Closed && <>
                <PanelSectionRow>
                    <ButtonItem
                        bottomSeparator="none"
                        layout="below"
                        onClick={() => setGlobalState(state => ({
                            ...state,
                            viewMode: ViewMode.Picture
                        }))}>
                        Open
                    </ButtonItem>
                </PanelSectionRow>
            </>}
            {viewMode != ViewMode.Closed && <>
                <PanelSectionRow>
                    {/* The currently-selected channel is the single most
                        important thing on this whole panel — what am I
                        watching — so it gets as much width as this row can
                        give it, up to the Channel Surf buttons docked at the
                        right edge. Built as our own button rather than
                        Decky's native DropdownItem: that component's own
                        internal layout kept squeezing the channel name down
                        to a thin, right-justified sliver no matter what was
                        tried against it (removing its label, then a full
                        renderButtonValue override) — this guarantees the
                        layout instead of fighting Steam's own compiled-in
                        styling for it. Opens a full list to choose from
                        (channelPickerModal.tsx) rather than an inline
                        dropdown menu.
                        [Confirmed by Josh, 2026-09-21] marginTop nudges this
                        whole row down slightly — Steam draws its own
                        Settings (gear)/Close (X) buttons in the QAM panel's
                        header, above and outside anything this plugin
                        renders, and this row sat close enough to that header
                        that the channel name/Swap/Channel Surf chevrons read
                        as crowding right up against it. */}
                    <Focusable
                        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}
                        flow-children="horizontal">
                        {/* Add Channel used to live here too
                            [Confirmed by Josh, 2026-09-20]: it now lives only
                            in Manage Channels (reorderModal.tsx), top-right
                            next to the Show Channel URLs icon — one place to
                            add a channel instead of the same "+" appearing in
                            three different spots, and it frees up this row
                            for the channel name. */}
                        <ChannelButton
                            bookmark={currentBookmark}
                            onActivate={() => showModal(<ChannelPickerModalWithState value={stateContext} />)} />
                        {/* Swap stacked above Screenshot — a third two-icon
                            column flanking the channel button, mirroring
                            Add/Edit on the left and Previous/Next on the
                            right — but only once Screenshots are actually
                            turned on (screenshotSettingsModal.tsx). [Confirmed
                            by Josh, 2026-09-20] Someone who never takes a
                            screenshot shouldn't have that icon (or the
                            column height it needs) taking up space here at
                            all, so with screenshots off this is just the
                            plain Swap button on its own, centered in the row
                            like every other icon — not a column with an
                            empty second slot. Swap itself only shows once
                            there's actually somewhere to swap back to — a
                            fresh install with no channel history yet, or
                            already sitting on the only channel that's ever
                            been loaded, has nothing to swap with. */}
                        {swapAvailable && !screenshotEnabled && (
                            <IconButton
                                title={previousBookmark ? `Swap to ${previousBookmark.name}` : "Swap to Last Channel"}
                                onActivate={swapToPreviousChannel}>
                                <FaExchangeAlt />
                            </IconButton>
                        )}
                        {screenshotEnabled && (
                            <Focusable
                                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                                flow-children="vertical">
                                {swapAvailable && (
                                    <IconButton
                                        title={previousBookmark ? `Swap to ${previousBookmark.name}` : "Swap to Last Channel"}
                                        onActivate={swapToPreviousChannel}>
                                        <FaExchangeAlt />
                                    </IconButton>
                                )}
                                <IconButton title="Take Screenshot" onActivate={takeScreenshot}>
                                    <FaCamera />
                                </IconButton>
                            </Focusable>
                        )}
                        {visibleBookmarks.length > 1 && (
                            <Focusable
                                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                                flow-children="vertical">
                                <IconButton title="Previous Channel" onActivate={() => surfChannels(-1)}>
                                    <FaChevronUp />
                                </IconButton>
                                <IconButton title="Next Channel" onActivate={() => surfChannels(1)}>
                                    <FaChevronDown />
                                </IconButton>
                            </Focusable>
                        )}
                    </Focusable>
                </PanelSectionRow>
                <PanelSectionRow>
                    {/* Its own full-width row rather than a second line
                        packed inside the channel button above — that
                        button's width is squeezed by the icon columns on
                        both sides of it, nowhere near enough room for a
                        real guide title before it got clipped. Full panel
                        width plus wrapping (no nowrap/ellipsis) here
                        instead, so a long title is readable rather than cut
                        off.
                        [Confirmed by Josh, 2026-09-20] Always rendered now,
                        at a fixed min-height sized for two lines of text —
                        this row used to only appear once guide data actually
                        loaded, which shoved the Back/Play/Forward buttons
                        below it down by however much text showed up (none,
                        one line, two lines), so those buttons never sat in
                        the same place from one channel to the next.
                        Reserving the space up front, empty or not, keeps
                        them anchored regardless of whether this channel has
                        guide data at all. [Confirmed by Josh, 2026-09-20]
                        Added paddingBottom — a two-line title/subtitle sat
                        right on top of the Back/Play/Forward row below it
                        with no breathing room at all. */}
                    <div style={{ paddingLeft: 8, paddingBottom: 8, fontSize: 12, opacity: 0.8, whiteSpace: 'normal', wordBreak: 'break-word', minHeight: 34, display: 'flex', alignItems: 'flex-start' }}>
                        {currentBookmark && channelNowPlaying[currentBookmark.id]?.title && (
                            <div>
                                {channelNowPlaying[currentBookmark.id]?.title}
                                {/* [Confirmed by Josh, 2026-09-20] colon reads
                                    better than an em dash here — "Premier
                                    Lacrosse League: Denver Outlaws vs.
                                    Philadelphia Waterdogs" rather than "...
                                    League — Denver...". */}
                                {channelNowPlaying[currentBookmark.id]?.subtitle && (
                                    <span style={{ opacity: 0.8 }}>: {channelNowPlaying[currentBookmark.id]?.subtitle}</span>
                                )}
                            </div>
                        )}
                    </div>
                </PanelSectionRow>
                <PanelSectionRow>
                    {/* Playback comes right after the channel row now — the
                        most reached-for controls while actually
                        watching something (pause, back/ahead 10s) get top
                        billing, ahead of volume. All five buttons share the
                        same larger size so Play/Pause doesn't look like an
                        afterthought next to the 10/30-second buttons; the
                        10/30-second glyphs get a bigger icon still, since the
                        extra button room was specifically to make that
                        number legible. [Confirmed by Josh, 2026-09-20] Back
                        30s/Fwd 30s bracket the original 10-second jumps
                        rather than mixing in among them — "big jump, small
                        jump, play/pause, small jump, big jump" left to right
                        — matching the same order the on-screen overlay uses
                        (overlaySettingsModal.tsx/controlBar.tsx). Each of the
                        four skip buttons can be hidden from this row via the
                        "QAM Layout" section in Display Settings
                        (overlaySettingsModal.tsx).
                        [Confirmed by Josh, 2026-09-21] Play/Pause is now
                        hideable too (qamShowPlayPause) — it used to be the
                        one button in this row with no toggle, but there's no
                        real reason to single it out from the rest anymore.
                        [Confirmed by Josh, 2026-09-21, same day, take 3] Mute
                        went from this row's far end (take 1), to its own row
                        entirely above the slider (take 2), and now lands here
                        for good: back on this same line, parallel with the
                        transport buttons, but pinned to the LEFT edge with a
                        real gap (MUTE_BUFFER, a plain spacer div rather than
                        widening the row's shared `gap`, which would've
                        space every button out evenly instead of just this
                        one) separating it from Back/Play/Forward — visually
                        its own thing on the same line, not a sixth transport
                        button. Gated by qamShowVolume, same as the slider
                        row below it. */}
                    <Focusable
                        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: ICON_ROW_GAP, paddingLeft: 4, justifyContent: 'center' }}
                        flow-children="horizontal">
                        {qamShowVolume && (
                            <>
                                <IconButton
                                    size={34}
                                    title={muted ? "Unmute" : "Mute"}
                                    style={muted ? { background: 'rgba(220, 90, 90, 0.4)', border: '2px solid rgba(255, 140, 140, 0.6)' } : undefined}
                                    onActivate={() => setGlobalState(state => ({ ...state, muted: !state.muted }))}>
                                    {muted ? <FaVolumeMute /> : <FaVolumeUp />}
                                </IconButton>
                                <div style={{ width: MUTE_BUFFER, flexShrink: 0 }} />
                            </>
                        )}
                        {qamShowSeekBack30 && (
                            <IconButton
                                size={34}
                                title="Back 30 Seconds"
                                onActivate={() => setGlobalState(state => ({
                                ...state,
                                seekBack30Seq: state.seekBack30Seq + 1
                            }))}>
                                <MdReplay30 style={{ fontSize: 26 }} />
                            </IconButton>
                        )}
                        {qamShowSeekBack && (
                            <IconButton
                                size={34}
                                title="Back 10 Seconds"
                                onActivate={() => setGlobalState(state => ({
                                ...state,
                                seekBackSeq: state.seekBackSeq + 1
                            }))}>
                                <MdReplay10 style={{ fontSize: 26 }} />
                            </IconButton>
                        )}
                        {qamShowPlayPause && (
                            <IconButton
                                size={34}
                                active={!playing}
                                title={playing ? "Pause" : "Play"}
                                style={qamUseColor
                                    ? { background: hexToRgba(playing ? qamPauseColor : qamPlayColor, QAM_COLOR_ALPHA) }
                                    : undefined}
                                onActivate={() => setGlobalState(state => ({
                                    ...state,
                                    playPauseSeq: state.playPauseSeq + 1,
                                    playing: !state.playing
                                }))}>
                                {playing ? <FaPause /> : <FaPlay />}
                            </IconButton>
                        )}
                        {qamShowSeekForward && (
                            <IconButton
                                size={34}
                                title="Ahead 10 Seconds"
                                onActivate={() => setGlobalState(state => ({
                                ...state,
                                seekForwardSeq: state.seekForwardSeq + 1
                            }))}>
                                <MdForward10 style={{ fontSize: 26 }} />
                            </IconButton>
                        )}
                        {qamShowSeekForward30 && (
                            <IconButton
                                size={34}
                                title="Ahead 30 Seconds"
                                onActivate={() => setGlobalState(state => ({
                                ...state,
                                seekForward30Seq: state.seekForward30Seq + 1
                            }))}>
                                <MdForward30 style={{ fontSize: 26 }} />
                            </IconButton>
                        )}
                    </Focusable>
                </PanelSectionRow>
                {qamShowVolume && (
                    <PanelSectionRow>
                        {/* [Confirmed by Josh, 2026-09-21] Real SliderField, on
                            its own full-width row — see the comment above this
                            section's old VolumeSlider for why: a native range
                            input was never actually D-pad-selectable no matter
                            how it was wrapped, and SliderField only fought back
                            when forced into a narrow shared row. Given its own
                            row like Size/Margin/Brightness, it behaves exactly
                            like those — real focus highlight, real D-pad
                            drag/step.
                            No leading icon here (was a plain volume/muted
                            glyph via `label`) — redundant right next to the
                            Mute button on the transport row above, which
                            already shows the same on/off state. */}
                        <SliderField
                            value={volume}
                            disabled={muted}
                            showValue={true}
                            valueSuffix='%'
                            onChange={volume => setGlobalState(state => ({ ...state, volume }))}
                            min={0}
                            max={100}
                            step={1} />
                    </PanelSectionRow>
                )}
                <PanelSectionRow>
                    <Focusable
                        style={{ display: 'flex', flexDirection: 'row', gap: ICON_ROW_GAP, paddingLeft: 4, justifyContent: 'center' }}
                        flow-children="horizontal">
                        <IconButton
                            title={maximizeTitle(currentMaximizeStep(viewMode, size))}
                            onActivate={() => setGlobalState(state => advanceMaximize(state))}>
                            <MaximizeIcon step={currentMaximizeStep(viewMode, size)} />
                        </IconButton>
                        {/* [Confirmed by Josh, 2026-09-20] Hide and its
                            neighboring audio-badge toggle used to be two
                            separate icons — collapsed into one three-state
                            cycling toggle instead, the same pattern as
                            On-Screen Controls just below: Show -> Hide (with
                            audio badge) -> Hide (no audio badge) -> back to
                            Show. The icon itself carries the state (a plain
                            eye, an eye-slash, or an eye-slash with a small
                            pulsing equalizer badge) rather than needing a
                            second button next to it just to say whether the
                            badge will show once hidden. */}
                        <IconButton
                            title={
                                !hidden ? "Hide (tap to hide with audio badge)"
                                    : audioIndicatorEnabled ? "Hidden, with audio badge (tap to hide without it)"
                                        : "Hidden, no audio badge (tap to show)"
                            }
                            onActivate={() => setGlobalState(state => {
                                if (!state.hidden) {
                                    return { ...state, hidden: true, audioIndicatorEnabled: true };
                                }
                                if (state.audioIndicatorEnabled) {
                                    return { ...state, audioIndicatorEnabled: false };
                                }
                                return { ...state, hidden: false };
                            })}>
                            <HideAudioIcon hidden={hidden} audioIndicatorEnabled={audioIndicatorEnabled} />
                        </IconButton>
                        {effectiveEpgUrl && (
                            <IconButton
                                title="Show Guide Data"
                                onActivate={() => setGlobalState(state => ({ ...state, showNowPlaying: !state.showNowPlaying }))}>
                                {showNowPlaying ? <FaInfoCircle /> : <SlashedIcon><FaInfoCircle /></SlashedIcon>}
                            </IconButton>
                        )}
                        {/* [Confirmed by Josh, 2026-09-20] This used to be
                            two separate icons — On-Screen Controls on/off,
                            plus a Pin that only showed up once that was on —
                            collapsed into one three-state cycling toggle
                            instead: Off -> On -> On & Locked -> back to Off.
                            "Locked" is what controlBarAlwaysVisible actually
                            means (skips auto-hide, i.e. pinned/always
                            shown), so this is the same two booleans as
                            before, just presented as one control that always
                            occupies the same slot in this row instead of the
                            row's length changing depending on state. */}
                        <IconButton
                            title={
                                !controlBarEnabled ? "On-Screen Controls: Off (tap for On)"
                                    : !controlBarAlwaysVisible ? "On-Screen Controls: On, Auto-Hide (tap to Lock On)"
                                        : "On-Screen Controls: On & Locked (tap to turn Off)"
                            }
                            onActivate={() => setGlobalState(state => {
                                if (!state.controlBarEnabled) {
                                    return { ...state, controlBarEnabled: true, controlBarAlwaysVisible: false };
                                }
                                if (!state.controlBarAlwaysVisible) {
                                    return { ...state, controlBarAlwaysVisible: true };
                                }
                                return { ...state, controlBarEnabled: false, controlBarAlwaysVisible: false };
                            })}>
                            {!controlBarEnabled
                                ? <SlashedIcon><FaMousePointer /></SlashedIcon>
                                : !controlBarAlwaysVisible
                                    ? <FaMousePointer />
                                    : <PinnedIcon><FaMousePointer /></PinnedIcon>}
                        </IconButton>
                    </Focusable>
                </PanelSectionRow>
            </>}
            {viewMode == ViewMode.Picture && <>
                <PanelSectionRow>
                    {/* A collapsible header rather than a separate toggle
                        icon in the View row above — this section is the one
                        that's only fiddled with right after placing the
                        picture, so folding it away (and the header itself
                        doubling as the control) keeps the rest of the panel
                        from looking cluttered during actual gameplay. The
                        collapsed state itself persists (see globalState.tsx)
                        so it stays folded across restarts once someone's
                        settled on a placement, rather than reopening every
                        time the panel loads. */}
                    <DisplayHeaderToggle
                        collapsed={appearanceCollapsed}
                        onToggle={() => setGlobalState(state => ({ ...state, appearanceCollapsed: !state.appearanceCollapsed }))} />
                </PanelSectionRow>
                {!appearanceCollapsed && <>
                <PanelSectionRow>
                    {/* No "Position" label — the grid's own on-screen layout
                        already reads as "pick a corner/edge" without it. */}
                    <PositionGrid
                        current={position}
                        onSelect={selected =>
                            setGlobalState(state => ({
                                ...state,
                                visible: true,
                                position: selected,
                                viewMode: ViewMode.Picture
                            }))} />
                </PanelSectionRow>
                <PanelSectionRow>
                    {/* Text labels swapped for icons throughout this section
                        (a resize glyph for Size, a crop/frame glyph for
                        Margin, a sun for Brightness below) so this reads
                        more like a TV remote's dedicated buttons than a
                        settings form. The step is finer than the S/M/L/XL
                        notches suggest (~2.5% per notch of range) so there's
                        real in-between control, not just four fixed sizes;
                        the notch labels stay as reference points along the
                        way. */}
                    <SliderField
                        label={<MdPhotoSizeSelectLarge />}
                        value={size}
                        onChange={size =>
                            setGlobalState(state => ({
                                ...state,
                                size,
                                visible: true,
                                viewMode: ViewMode.Picture
                            }))}
                        min={SIZE_MIN}
                        max={SIZE_MAX}
                        step={0.05}
                        notchCount={4}
                        notchTicksVisible={true}
                        notchLabels={[
                            { label: "S", notchIndex: 0, value: SIZE_MIN },
                            { label: "M", notchIndex: 1, value: 0.60 },
                            { label: "L", notchIndex: 2, value: 0.85 },
                            { label: "XL", notchIndex: 3, value: SIZE_MAX }
                        ]} />
                </PanelSectionRow>
                <PanelSectionRow>
                    <SliderField
                        label={<MdCropFree />}
                        value={margin}
                        onChange={margin =>
                            setGlobalState(state => ({
                                ...state,
                                margin,
                                visible: true,
                                viewMode: ViewMode.Picture
                            }))}
                        min={0}
                        max={60}
                        step={5}
                        notchCount={4}
                        notchTicksVisible={true}
                        notchLabels={[
                            { label: "S", notchIndex: 0, value: 0 },
                            { label: "M", notchIndex: 1, value: 20 },
                            { label: "L", notchIndex: 2, value: 40 },
                            { label: "XL", notchIndex: 3, value: 60 },
                        ]} />
                </PanelSectionRow>
                <PanelSectionRow>
                    <SliderField
                        label={<FaSun />}
                        value={opacity}
                        bottomSeparator="none"
                        showValue={true}
                        valueSuffix='%'
                        onChange={opacity => setGlobalState(state => ({ ...state, opacity }))}
                        min={20}
                        max={100}
                        step={1} />
                </PanelSectionRow>
                </>}
            </>}
        </PanelSection>
    </>;
};
