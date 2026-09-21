import {
    ConfirmModal,
    ModalRootProps,
    Focusable,
    ToggleField,
    ButtonItem,
} from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import {
    FaArrowsAlt,
    FaCamera,
    FaExchangeAlt,
    FaExpand,
    FaEyeSlash,
    FaGripVertical,
    FaPalette,
    FaPause,
    FaTimes,
    FaVolumeUp,
} from "react-icons/fa";
import { MdReplay10, MdForward10, MdReplay30, MdForward30 } from "react-icons/md";

import { modalWithState } from "./modal";
import { useGlobalState, State } from "./globalState";
import { ViewItemKey, ControlItemKey, DEFAULT_VIEW_ORDER, DEFAULT_CONTROL_ORDER, hexToRgba, reorder } from "./util";

const columnHeaderStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 'bold',
    opacity: 0.6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '6px 0 2px',
};

const rowStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: '3px 0',
};

// [Confirmed by Josh, 2026-09-21] Matches columnHeaderStyle exactly — used
// for the "Bar Layout"/"QAM Layout" section labels below, now that those
// sections are plain flat divs (see the comment on the modal's return JSX)
// instead of Decky's own Field, which renders a distinct boxed/card
// background around its children. Kept as its own separately-named constant
// rather than reusing columnHeaderStyle directly since these two labels
// happen to look identical today but sit in a different place in the tree —
// changing one's look later shouldn't silently change the other's.
const sectionHeaderStyle: CSSProperties = columnHeaderStyle;

const sectionDescriptionStyle: CSSProperties = {
    fontSize: 11,
    opacity: 0.6,
    padding: '0 0 4px',
};

// Static per-item display info (icon/label/tooltip/the toggle's own
// State key) for every View and Control item — [Confirmed by Josh,
// 2026-09-20] kept as plain lookup tables rather than continuing to
// hardcode each row's JSX in a fixed sequence, since the actual on-screen
// order now comes from viewOrder/controlOrder (globalState.tsx) and can be
// dragged into any arrangement — the row markup itself doesn't change,
// only which key is rendered at which position.
interface ViewItemInfo {
    icon: ReactNode
    label: string
    stateKey: keyof State
}

const VIEW_ITEMS: Record<ViewItemKey, ViewItemInfo> = {
    maximize: { icon: <FaExpand />, label: "Maximize", stateKey: 'overlayShowMaximize' },
    position: { icon: <FaArrowsAlt />, label: "Position", stateKey: 'overlayShowPosition' },
    screenshot: { icon: <FaCamera />, label: "Screenshot", stateKey: 'overlayShowScreenshot' },
    hide: { icon: <FaEyeSlash />, label: "Hide", stateKey: 'overlayShowHide' },
    swap: { icon: <FaExchangeAlt />, label: "Swap", stateKey: 'overlayShowSwap' },
    close: { icon: <FaTimes />, label: "Close", stateKey: 'overlayShowClose' },
};

const CONTROL_ITEMS: Record<ControlItemKey, ViewItemInfo> = {
    seekBack30: { icon: <MdReplay30 />, label: "Back 30s", stateKey: 'overlayShowSeekBack30' },
    seekBack: { icon: <MdReplay10 />, label: "Back 10s", stateKey: 'overlayShowSeekBack' },
    playPause: { icon: <FaPause />, label: "Play/Pause", stateKey: 'overlayShowPlayPause' },
    seekForward: { icon: <MdForward10 />, label: "Fwd 10s", stateKey: 'overlayShowSeekForward' },
    seekForward30: { icon: <MdForward30 />, label: "Fwd 30s", stateKey: 'overlayShowSeekForward30' },
    volume: { icon: <FaVolumeUp />, label: "Volume", stateKey: 'overlayShowVolume' },
};

interface CompactToggleProps {
    icon: ReactNode
    label: string
    checked: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
    tooltip?: string
    // Drag-reorder wiring — [Confirmed by Josh, 2026-09-20] a small grab
    // handle to the left of the icon, native HTML5 drag-and-drop (this
    // whole modal is mouse/trackpad-only already, same as controlBar.tsx's
    // own buttons — there's no D-pad-navigable equivalent of "drag" to
    // support here). Dragging a row onto another row within the SAME
    // column reorders it there; the handlers are only ever wired up
    // between rows of the same column (see ReorderableColumn below), so
    // View and Control items can never end up mixed.
    dragIndex: number
    onDragStart: (index: number) => void
    onDragOver: (index: number) => void
    onDrop: () => void
    dragging: boolean
    dropTarget: boolean
}

// A single grab handle + icon + short label + toggle, one line. [Confirmed
// by Josh, 2026-09-20] Packed into one compact row per control, split into
// the same two groups the on-screen overlay itself renders them in — the
// side "View" bar vs. the horizontal "Control" bar (controlBar.tsx).
const CompactToggle = ({
    icon, label, checked, onChange, disabled, tooltip,
    dragIndex, onDragStart, onDragOver, onDrop, dragging, dropTarget,
}: CompactToggleProps) => (
    <div
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(dragIndex); }}
        onDragOver={(e) => { e.preventDefault(); onDragOver(dragIndex); }}
        onDrop={(e) => { e.preventDefault(); onDrop(); }}
        onDragEnd={onDrop}
        style={{
            opacity: dragging ? 0.4 : 1,
            borderTop: dropTarget ? '2px solid rgba(255,255,255,0.6)' : '2px solid transparent',
        }}>
        <Focusable style={rowStyle} flow-children="horizontal">
            <div
                title="Drag to reorder"
                style={{ fontSize: 11, width: 14, display: 'flex', justifyContent: 'center', flexShrink: 0, opacity: 0.5, cursor: 'grab' }}>
                <FaGripVertical />
            </div>
            <div style={{ fontSize: 13, width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0, opacity: disabled ? 0.4 : 1 }}>
                {icon}
            </div>
            <div style={{ flex: 1, fontSize: 12, opacity: disabled ? 0.4 : 1 }}>{label}</div>
            <ToggleField
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                tooltip={tooltip}
                bottomSeparator="none" />
        </Focusable>
    </div>
);

interface SimpleToggleRowProps {
    icon: ReactNode
    label: string
    checked: boolean
    onChange: (checked: boolean) => void
}

// Same one-line icon + label + toggle look as CompactToggle, minus the grab
// handle — [Confirmed by Josh, 2026-09-20] the QAM Layout rows below aren't
// reorderable (the QAM panel's own Playback row always renders Back 30s/
// Back 10s/Play-Pause/Fwd 10s/Fwd 30s in that fixed left-to-right order —
// only whether each of the four skip buttons shows at all is configurable
// here, not their order), so there's nothing to drag.
// [Confirmed by Josh, 2026-09-20] These rows weren't visibly highlighting on
// D-pad focus the way the View/Control columns' own rows do — an explicit
// focused-state background/border is applied here directly (same pattern as
// IconButton/GridCell in settings.tsx) rather than counting on it to come
// for free, so this row is guaranteed to show something the moment it's
// focused, regardless of what was or wasn't happening before.
const SimpleToggleRow = ({ icon, label, checked, onChange }: SimpleToggleRowProps) => {
    const [focused, setFocused] = useState(false);
    return (
        <div style={{
            borderRadius: 6,
            background: focused ? 'rgba(255, 255, 255, 0.14)' : 'transparent',
            border: focused ? '1px solid rgba(255, 255, 255, 0.6)' : '1px solid transparent',
            transition: 'background 100ms, border-color 100ms',
        }}>
            <Focusable
                style={rowStyle}
                flow-children="horizontal"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}>
                <div style={{ fontSize: 13, width: 16, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    {icon}
                </div>
                <div style={{ flex: 1, fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                <ToggleField
                    checked={checked}
                    onChange={onChange}
                    bottomSeparator="none" />
            </Focusable>
        </div>
    );
};

// A single labeled color swatch — a native <input type="color"> opens the
// OS/Steam's own color picker on activation, which is about as "easy/
// elegant" a palette picker as exists without building a custom one from
// scratch, and matches this modal's existing precedent of plain native
// inputs for things a D-pad can't really drive anyway (see CompactToggle's
// own drag-and-drop comment above) — picking an exact color is inherently a
// mouse/trackpad/touch action.
const ColorSwatch = ({ label, value, onChange }: { label: string, value: string, onChange: (value: string) => void }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
        <input
            aria-label={`${label} color`}
            type="color"
            value={value}
            onChange={e => onChange(e.target.value)}
            style={{ width: 30, height: 22, padding: 0, border: '2px solid rgba(255, 255, 255, 0.35)', borderRadius: 4, background: 'none', cursor: 'pointer' }} />
        <div style={{ fontSize: 10, opacity: 0.75 }}>{label}</div>
    </div>
);

interface ReorderableColumnProps<K extends string> {
    title: string
    order: K[]
    items: Record<K, ViewItemInfo>
    onReorder: (newOrder: K[]) => void
    // Per-item extra checked/disabled/tooltip overrides — only Screenshot
    // needs this (locked to Screenshot Settings' master switch), so rather
    // than threading a whole custom-render prop through, the column just
    // asks the caller for each item's actual checked/disabled/tooltip.
    resolve: (key: K) => { checked: boolean, disabled?: boolean, tooltip?: string }
    onToggle: (key: K, value: boolean) => void
}

// One draggable, reorderable column of CompactToggle rows — used for both
// the View and Control columns below. Drag state (which row is being
// dragged, which row it's currently hovering over) lives here, local to
// this one column, since a drag can never cross from one column to the
// other.
function ReorderableColumn<K extends string>({ title, order, items, onReorder, resolve, onToggle }: ReorderableColumnProps<K>) {
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    const handleDrop = () => {
        if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
            onReorder(reorder(order, dragIndex, overIndex));
        }
        setDragIndex(null);
        setOverIndex(null);
    };

    return (
        <Focusable style={{ flex: 1, display: 'flex', flexDirection: 'column' }} flow-children="vertical">
            <div style={columnHeaderStyle}>{title}</div>
            {order.map((key, index) => {
                const info = items[key];
                const { checked, disabled, tooltip } = resolve(key);
                return (
                    <CompactToggle
                        key={key}
                        icon={info.icon}
                        label={info.label}
                        checked={checked}
                        disabled={disabled}
                        tooltip={tooltip}
                        onChange={(value) => onToggle(key, value)}
                        dragIndex={index}
                        onDragStart={setDragIndex}
                        onDragOver={setOverIndex}
                        onDrop={handleDrop}
                        dragging={dragIndex === index}
                        dropTarget={overIndex === index && dragIndex !== index} />
                );
            })}
        </Focusable>
    );
}

// Moved out into its own modal, same reasoning as Guide Data/Screenshot
// Settings — this is a set-once-and-forget appearance preference, not
// something reached for during regular use. [Confirmed by Josh, 2026-09-20]
// Named "Display Settings" (not "On-Screen Overlay Settings") since it now
// covers three things rather than just the floating on-screen overlay:
// which of the QAM panel's own Playback buttons show (settings.tsx), and
// two things about the on-screen overlay itself (controlBar.tsx) — whether
// its two segments render as one connected L-shaped bar or two separate
// pills, and which individual controls show up in it at all (and now, the
// order they show up in — see viewOrder/controlOrder, globalState.tsx).
//
// [Confirmed by Josh, 2026-09-20] Every toggle here writes straight to
// global state on change and applies immediately — no local staged state,
// no Save button to commit it. Every other settings modal in this plugin
// (Guide Data, Screenshot, Channel Management) DOES stage locally behind a
// Save button, which is the right call for those: a channel guide URL or a
// save folder is invisible until you back out and test it, so there's
// nothing to lose by only committing on Save. This one's different — every
// toggle here has an immediate, visible on-screen effect (an icon
// appearing/disappearing, the bar's shape changing, a row's position
// changing), so seeing that effect live, right as you flip or drag it, is
// far more useful than a snapshot you have to close the modal to check.
export const OverlaySettingsModal = (props: ModalRootProps) => {
    const [{
        screenshotEnabled, controlBarEnabled,
        overlayConnected, overlayShowMaximize, overlayShowPosition, overlayShowScreenshot,
        overlayShowHide, overlayShowSwap, overlayShowClose, overlayShowSeekBack,
        overlayShowPlayPause, overlayShowSeekForward, overlayShowVolume,
        overlayShowSeekBack30, overlayShowSeekForward30, viewOrder, controlOrder,
        qamShowSeekBack30, qamShowSeekBack, qamShowSeekForward, qamShowSeekForward30,
        qamShowPlayPause, qamShowVolume,
        qamUseColor, qamPlayColor, qamPauseColor, qamCloseColor,
    }, setGlobalState] = useGlobalState();

    const set = <K extends keyof State>(key: K) => (value: State[K]) =>
        setGlobalState(state => ({ ...state, [key]: value }));

    // [Confirmed by Josh, 2026-09-20] Every toggle here has an immediate,
    // visible effect on the on-screen overlay — but only if that overlay is
    // actually showing at all (State.controlBarEnabled, the panel's own View
    // row toggle). Someone with it off entirely would flip every switch here
    // blind, with nothing on screen to check against. So opening this modal
    // temporarily forces it on for as long as this stays open — purely a
    // preview, not a change to the real preference — and the very first
    // value seen (whatever it actually was) is restored the moment this
    // closes, whichever way it closes. A ref rather than state since this
    // only needs to be read once, in the unmount cleanup below, and must
    // never itself trigger a re-render.
    const originalControlBarEnabled = useRef(controlBarEnabled);
    useEffect(() => {
        if (!originalControlBarEnabled.current) {
            setGlobalState(state => ({ ...state, controlBarEnabled: true }));
        }
        return () => {
            setGlobalState(state => ({ ...state, controlBarEnabled: originalControlBarEnabled.current }));
        };
    }, []);

    const viewChecked: Record<ViewItemKey, boolean> = {
        maximize: overlayShowMaximize,
        position: overlayShowPosition,
        screenshot: overlayShowScreenshot,
        hide: overlayShowHide,
        swap: overlayShowSwap,
        close: overlayShowClose,
    };
    const controlChecked: Record<ControlItemKey, boolean> = {
        seekBack30: overlayShowSeekBack30,
        seekBack: overlayShowSeekBack,
        playPause: overlayShowPlayPause,
        seekForward: overlayShowSeekForward,
        seekForward30: overlayShowSeekForward30,
        volume: overlayShowVolume,
    };

    const resetToDefault = () => setGlobalState(state => ({
        ...state,
        viewOrder: DEFAULT_VIEW_ORDER,
        controlOrder: DEFAULT_CONTROL_ORDER,
    }));

    // Live preview swatch for each color — shown next to its picker so it's
    // obvious what the actual on-screen alpha-blended result looks like,
    // not just the raw picked hue (a native color input always shows a
    // fully-opaque swatch, which can look noticeably different once
    // blended at the button's real ~0.35-0.55 alpha).
    const playPreview = hexToRgba(qamPlayColor, 0.55);
    const pausePreview = hexToRgba(qamPauseColor, 0.55);
    const closePreview = hexToRgba(qamCloseColor, 0.35);

    return <ConfirmModal
        {...props}
        strTitle="Display Settings"
        strOKButtonText="Close"
        onOK={() => { }}>
        {/* [Confirmed by Josh, 2026-09-20] Bar Layout back at the top —
            it's the setting most people open this modal to check/change,
            and it governs how the two columns below are actually drawn
            on-screen (one connected L vs. two separate pills), so seeing it
            first makes more sense than after them.
            [Confirmed by Josh, 2026-09-21] Was wrapped in Decky's own Field,
            which — per Josh's own photo from his Steam Machine/TV — renders
            a distinct bluish-gray rounded card behind everything inside it.
            That looked inconsistent next to the View/Control columns below,
            which were never Field-wrapped and render flat/black with only
            each ToggleField's own switch showing a gray pill. Rebuilt as a
            plain header + description + row, same look and same D-pad
            navigation feel as those columns, so this whole modal now reads
            as one continuous flat list rather than two different styles. */}
        <div style={{ marginTop: 2 }}>
            <div style={sectionHeaderStyle}>Bar Layout</div>
            <div style={sectionDescriptionStyle}>
                {overlayConnected
                    ? "Connected: one L-shaped bar around the picture's corner."
                    : "Separate: two independent pills, sized to fit only what's on."}
            </div>
            <Focusable style={rowStyle} flow-children="horizontal">
                <div style={{ flex: 1, fontSize: 12 }}>Connected</div>
                <ToggleField
                    checked={overlayConnected}
                    onChange={set('overlayConnected')}
                    bottomSeparator="none" />
            </Focusable>
        </div>
        {/* Two columns matching the on-screen overlay's own two segments —
            [Confirmed by Josh, 2026-09-20] View (the side bar) on the left,
            Control (the horizontal bar) on the right — rather than one long
            alphabetical list with no relation to how these actually group
            together on screen. Drag a row's grab handle up or down to
            reorder it within its own column — the new order drives both
            this list and the actual on-screen buttons. */}
        <Focusable style={{ display: 'flex', flexDirection: 'row', gap: 16, marginTop: 6 }} flow-children="horizontal">
            <ReorderableColumn
                title="View"
                order={viewOrder}
                items={VIEW_ITEMS}
                onReorder={(newOrder) => setGlobalState(state => ({ ...state, viewOrder: newOrder }))}
                resolve={(key) => {
                    // Screenshot is grayed out AND shown unchecked when
                    // Screenshots aren't enabled at all (Screenshot
                    // Settings) — [Confirmed by Josh, 2026-09-20] the
                    // underlying overlayShowScreenshot preference itself is
                    // untouched either way, this only affects what's
                    // DISPLAYED here while locked.
                    if (key === 'screenshot') {
                        return {
                            checked: screenshotEnabled && overlayShowScreenshot,
                            disabled: !screenshotEnabled,
                            tooltip: screenshotEnabled ? undefined : "Enable screenshots in Screenshot Settings first — this only controls whether its icon shows in the overlay once that's on.",
                        };
                    }
                    return { checked: viewChecked[key] };
                }}
                onToggle={(key, value) => set(VIEW_ITEMS[key].stateKey)(value as any)} />
            <ReorderableColumn
                title="Control"
                order={controlOrder}
                items={CONTROL_ITEMS}
                onReorder={(newOrder) => setGlobalState(state => ({ ...state, controlOrder: newOrder }))}
                resolve={(key) => ({ checked: controlChecked[key] })}
                onToggle={(key, value) => set(CONTROL_ITEMS[key].stateKey)(value as any)} />
        </Focusable>
        {/* [Confirmed by Josh, 2026-09-20] Restores both arrays to the
            order these items originally shipped in — a plain reset, not a
            confirmation dialog, since it only touches display order and is
            trivially undone by dragging things back.
            [Confirmed by Josh, 2026-09-21] No longer Field-wrapped, same
            flat-background reasoning as Bar Layout/QAM Layout above/below —
            a bare margin is all this needs. */}
        <div style={{ marginTop: 10 }}>
            <ButtonItem layout="below" onClick={resetToDefault}>
                Reset to Default Order
            </ButtonItem>
        </div>
        {/* [Confirmed by Josh, 2026-09-20] The QAM panel's own Playback row
            (settings.tsx) gets the same "which buttons show" control as the
            on-screen overlay, now that this modal covers both surfaces.
            Moved below the View/Control columns (was above them) and laid
            out as a grid instead of a single vertical list, about half the
            height.
            [Confirmed by Josh, 2026-09-21] Play/Pause and Volume (Mute +
            slider together) are now toggleable here too, same as the four
            skip buttons — neither is singled out as always-on anymore, and
            Mute itself moved onto the same row/size as the other playback
            buttons in settings.tsx (was its own separate row). 2x3 grid now
            to fit all six without growing taller per row.
            [Confirmed by Josh, 2026-09-21 → same section] Same Field-removal
            as Bar Layout above — this was the section in Josh's photo
            actually showing the boxed card background, next to the flat
            View/Control columns above it. Now a plain header + description,
            same as Bar Layout, so the whole modal matches. */}
        <div style={{ marginTop: 10 }}>
            <div style={sectionHeaderStyle}>QAM Layout</div>
            <div style={sectionDescriptionStyle}>Playback row buttons, and optional custom colors.</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 10 }}>
                <SimpleToggleRow icon={<MdReplay30 />} label="Back 30s" checked={qamShowSeekBack30} onChange={set('qamShowSeekBack30')} />
                <SimpleToggleRow icon={<MdForward30 />} label="Fwd 30s" checked={qamShowSeekForward30} onChange={set('qamShowSeekForward30')} />
                <SimpleToggleRow icon={<MdReplay10 />} label="Back 10s" checked={qamShowSeekBack} onChange={set('qamShowSeekBack')} />
                <SimpleToggleRow icon={<MdForward10 />} label="Fwd 10s" checked={qamShowSeekForward} onChange={set('qamShowSeekForward')} />
                <SimpleToggleRow icon={<FaPause />} label="Play/Pause" checked={qamShowPlayPause} onChange={set('qamShowPlayPause')} />
                <SimpleToggleRow icon={<FaVolumeUp />} label="Volume" checked={qamShowVolume} onChange={set('qamShowVolume')} />
            </div>
            {/* [Confirmed by Josh, 2026-09-20] Off by default — with it off,
                the QAM Play/Pause button and the title bar's Close button
                are plain, no background tint at all, same as every other
                icon button in this panel. Turning it on is what applies any
                color, and the pickers below start out seeded with hex
                equivalents of the green/blue/red this used to always show
                (index.tsx's DEFAULTS), so turning it on for the first time
                shows that familiar look rather than some arbitrary color —
                nothing changes on screen until a swatch is actually
                changed. */}
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.12)' }}>
                <SimpleToggleRow icon={<FaPalette />} label="Use Color" checked={qamUseColor} onChange={set('qamUseColor')} />
                {qamUseColor && (
                    <Focusable style={{ display: 'flex', flexDirection: 'row', gap: 18, padding: '4px 0 2px 22px' }} flow-children="horizontal">
                        <ColorSwatch label="Play" value={qamPlayColor} onChange={set('qamPlayColor')} />
                        <ColorSwatch label="Pause" value={qamPauseColor} onChange={set('qamPauseColor')} />
                        <ColorSwatch label="Close" value={qamCloseColor} onChange={set('qamCloseColor')} />
                        {/* Blended preview — see playPreview/pausePreview/
                            closePreview's own comment above. */}
                        <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            <div style={{ width: 16, height: 16, borderRadius: '50%', background: playPreview }} title="Play preview" />
                            <div style={{ width: 16, height: 16, borderRadius: '50%', background: pausePreview }} title="Pause preview" />
                            <div style={{ width: 16, height: 16, borderRadius: '50%', background: closePreview }} title="Close preview" />
                        </div>
                    </Focusable>
                )}
            </div>
        </div>
    </ConfirmModal>;
};

export const OverlaySettingsModalWithState = modalWithState(OverlaySettingsModal);
