import {
    Focusable,
    PanelSection,
    PanelSectionRow,
    SliderField,
    DropdownItem,
    showModal,
    ButtonItem,
    DialogCheckbox,
    ToggleField
} from "@decky/ui";
import { CSSProperties, ReactNode, useEffect, useState } from "react";
import { FaPlus, FaEdit, FaSort, FaPlay, FaUndo, FaChevronUp, FaChevronDown, FaFileExport, FaFileImport, FaExpand, FaEyeSlash, FaTimes } from "react-icons/fa";
import { MdReplay10, MdForward10 } from "react-icons/md";

import { Position, ViewMode } from "./util";
import { useGlobalState } from "./globalState";
import { BookmarkModalWithState } from "./bookmarkModal";
import { ReorderModalWithState } from "./reorderModal";
import { RestoreDefaultsModalWithState } from "./restoreDefaultsModal";
import { exportChannels, importChannels } from "./channelBackupModal";

// A spatial 3x3 grid (center cell unused) standing in for the 8
// screen positions, so picking one is "click the corner/edge you want"
// rather than scanning a dropdown list — replaces the old position
// dropdown, which read as a plain list with no visual relationship to
// where the picture would actually end up.
const GRID_CELL = 44;

const gridButtonStyle = (isCurrent: boolean): CSSProperties => ({
    width: GRID_CELL,
    height: GRID_CELL,
    borderRadius: '50%',
    background: isCurrent ? 'rgba(90, 170, 255, 0.9)' : 'rgba(255, 255, 255, 0.08)',
    border: isCurrent ? '2px solid rgba(255, 255, 255, 0.9)' : '2px solid rgba(255, 255, 255, 0.25)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: 'white',
    lineHeight: 1,
});

// Small, fixed-size icon buttons used for every icon row in this panel
// (channel management, playback, Expand/Hide/Close) so they all match. A
// ButtonItem carries enough of its own fixed padding/min-width that a row
// of them overflowed the QAM panel's width — these are plain Focusable
// squares instead. Sized down from an earlier 36px once a 6th icon (Export/
// Import) pushed the channel-management row wide enough to clip its last
// button.
const ICON_BUTTON_SIZE = 30;
const ICON_ROW_GAP = 8;

const iconButtonStyle = (focused: boolean, active: boolean): CSSProperties => ({
    width: ICON_BUTTON_SIZE,
    height: ICON_BUTTON_SIZE,
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
const IconButton = ({ onActivate, active, children }: { onActivate: () => void, active?: boolean, children: ReactNode }) => {
    const [focused, setFocused] = useState(false);

    return <Focusable
        style={iconButtonStyle(focused, !!active)}
        onActivate={onActivate}
        onClick={onActivate}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}>
        {children}
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
        style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', margin: '4px 0' }}
        flow-children="vertical"
    >
        {ROWS.map((row, rowIndex) => (
            <Focusable
                key={rowIndex}
                style={{ display: 'flex', flexDirection: 'row', gap: 10 }}
                flow-children="horizontal"
            >
                {row.map(({ position, glyph }, colIndex) =>
                    position === null
                        ? <div key={colIndex} style={{ width: GRID_CELL, height: GRID_CELL }} />
                        : <Focusable
                            key={position}
                            style={gridButtonStyle(position === current)}
                            onActivate={() => onSelect(position)}
                            onClick={() => onSelect(position)}
                        >
                            {glyph}
                        </Focusable>
                )}
            </Focusable>
        ))}
    </Focusable>;
};

export const Settings = () => {
    const [{ viewMode, position, margin, url, size, bookmarks, volume, muted, hidden, nowPlaying, showNowPlaying }, setGlobalState, stateContext] = useGlobalState();
    const currentBookmark = bookmarks.find(b => b.url === url);

    // Steps to the next/previous bookmark in the list, wrapping around at
    // either end, so repeated presses "surf" through every saved channel
    // without opening the Channel dropdown each time. If the current URL
    // isn't a saved bookmark (a custom one-off URL), surfing starts from
    // the first channel in the list.
    const surfChannels = (direction: 1 | -1) => {
        if (bookmarks.length === 0) return;
        const currentIndex = bookmarks.findIndex(b => b.url === url);
        const nextIndex = currentIndex === -1
            ? 0
            : (currentIndex + direction + bookmarks.length) % bookmarks.length;
        const next = bookmarks[nextIndex];
        setGlobalState(state => ({
            ...state,
            visible: true,
            url: next.url,
            viewMode: ViewMode.Picture
        }));
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
                    <DropdownItem
                        label='Channel'
                        indentLevel={1}
                        selectedOption={currentBookmark?.id}
                        rgOptions={bookmarks.map(b => ({ label: b.name, data: b.id }))}
                        strDefaultLabel={currentBookmark ? undefined : 'Custom'}
                        onChange={option => {
                            const bookmark = bookmarks.find(b => b.id === option.data);
                            if (!bookmark) return;
                            setGlobalState(state => ({
                                ...state,
                                visible: true,
                                url: bookmark.url,
                                viewMode: ViewMode.Picture
                            }));
                        }} />
                </PanelSectionRow>
                {currentBookmark?.epgUrl && (
                    <PanelSectionRow>
                        <ToggleField
                            label='Show Guide Data'
                            checked={showNowPlaying}
                            onChange={showNowPlaying => setGlobalState(state => ({ ...state, showNowPlaying }))} />
                    </PanelSectionRow>
                )}
                {showNowPlaying && nowPlaying && (
                    <PanelSectionRow>
                        <div style={{ paddingLeft: 8, fontSize: 13, opacity: 0.8 }}>
                            <div style={{ fontWeight: 'bold' }}>{nowPlaying.title}</div>
                            {nowPlaying.subtitle && <div>{nowPlaying.subtitle}</div>}
                        </div>
                    </PanelSectionRow>
                )}
                <PanelSectionRow>
                    <Focusable
                        style={{ display: 'flex', flexDirection: 'row', gap: ICON_ROW_GAP, paddingLeft: 4 }}
                        flow-children="horizontal">
                        <IconButton onActivate={() => showModal(<BookmarkModalWithState value={stateContext} />)}>
                            <FaPlus />
                        </IconButton>
                        {currentBookmark && (
                            <IconButton onActivate={() => showModal(<BookmarkModalWithState value={stateContext} bookmarkId={currentBookmark.id} />)}>
                                <FaEdit />
                            </IconButton>
                        )}
                        {bookmarks.length > 1 && (
                            <IconButton onActivate={() => showModal(<ReorderModalWithState value={stateContext} />)}>
                                <FaSort />
                            </IconButton>
                        )}
                        <IconButton onActivate={() => showModal(<RestoreDefaultsModalWithState value={stateContext} />)}>
                            <FaUndo />
                        </IconButton>
                        <IconButton onActivate={() => exportChannels(bookmarks)}>
                            <FaFileExport />
                        </IconButton>
                        <IconButton onActivate={() => importChannels(setGlobalState)}>
                            <FaFileImport />
                        </IconButton>
                    </Focusable>
                </PanelSectionRow>
                <PanelSectionRow>
                    <Focusable
                        style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                        flow-children="horizontal">
                        <div style={{ flex: 1 }}>
                            <SliderField
                                label='Volume'
                                value={volume}
                                disabled={muted}
                                bottomSeparator="none"
                                showValue={true}
                                valueSuffix='%'
                                onChange={volume => setGlobalState(state => ({ ...state, volume }))}
                                min={0}
                                max={100}
                                step={1} />
                        </div>
                        <DialogCheckbox
                            label='Mute'
                            checked={muted}
                            onChange={muted => setGlobalState(state => ({ ...state, muted }))} />
                    </Focusable>
                </PanelSectionRow>
                <PanelSectionRow>
                    <Focusable
                        style={{ display: 'flex', flexDirection: 'row', gap: ICON_ROW_GAP, paddingLeft: 4, justifyContent: 'center' }}
                        flow-children="horizontal">
                        <IconButton onActivate={() => setGlobalState(state => ({
                            ...state,
                            seekBackSeq: state.seekBackSeq + 1
                        }))}>
                            <MdReplay10 />
                        </IconButton>
                        <IconButton onActivate={() => setGlobalState(state => ({
                            ...state,
                            playPauseSeq: state.playPauseSeq + 1
                        }))}>
                            <FaPlay />
                        </IconButton>
                        <IconButton onActivate={() => setGlobalState(state => ({
                            ...state,
                            seekForwardSeq: state.seekForwardSeq + 1
                        }))}>
                            <MdForward10 />
                        </IconButton>
                        {bookmarks.length > 1 && (
                            <>
                                <IconButton onActivate={() => surfChannels(-1)}>
                                    <FaChevronUp />
                                </IconButton>
                                <IconButton onActivate={() => surfChannels(1)}>
                                    <FaChevronDown />
                                </IconButton>
                            </>
                        )}
                    </Focusable>
                </PanelSectionRow>
                <PanelSectionRow>
                    <Focusable
                        style={{ display: 'flex', flexDirection: 'row', gap: ICON_ROW_GAP, paddingLeft: 4, justifyContent: 'center' }}
                        flow-children="horizontal">
                        <IconButton
                            active={viewMode == ViewMode.Expand}
                            onActivate={() => setGlobalState(state => ({
                                ...state,
                                viewMode: state.viewMode == ViewMode.Expand
                                    ? ViewMode.Picture
                                    : ViewMode.Expand
                            }))}>
                            <FaExpand />
                        </IconButton>
                        <IconButton
                            active={hidden}
                            onActivate={() => setGlobalState(state => ({ ...state, hidden: !state.hidden }))}>
                            <FaEyeSlash />
                        </IconButton>
                        <IconButton
                            onActivate={() => setGlobalState(state => ({
                                ...state,
                                viewMode: ViewMode.Closed,
                                hidden: false
                            }))}>
                            <FaTimes />
                        </IconButton>
                    </Focusable>
                </PanelSectionRow>
            </>}
            {viewMode == ViewMode.Picture && <>
                <PanelSectionRow>
                    <div style={{ marginBottom: 4 }}>Position</div>
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
                    <SliderField
                        label='Size'
                        value={size}
                        onChange={size =>
                            setGlobalState(state => ({
                                ...state,
                                size,
                                visible: true,
                                viewMode: ViewMode.Picture
                            }))}
                        min={0.55}
                        max={1.30}
                        step={0.25}
                        notchCount={4}
                        notchTicksVisible={true}
                        notchLabels={[
                            { label: "S", notchIndex: 0, value: 0.55 },
                            { label: "M", notchIndex: 1, value: 0.80 },
                            { label: "L", notchIndex: 2, value: 1.05 },
                            { label: "XL", notchIndex: 3, value: 1.30 }
                        ]} />
                </PanelSectionRow>
                <PanelSectionRow>
                    <SliderField
                        label='Margin'
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
                        step={20}
                        notchCount={4}
                        notchTicksVisible={true}
                        notchLabels={[
                            { label: "S", notchIndex: 0, value: 0 },
                            { label: "M", notchIndex: 1, value: 20 },
                            { label: "L", notchIndex: 2, value: 40 },
                            { label: "XL", notchIndex: 3, value: 60 },
                        ]} />
                </PanelSectionRow>
            </>}
        </PanelSection>
    </>;
};
