import {
    ConfirmModal,
    ModalRootProps,
    Focusable,
    showModal,
} from "@decky/ui";
import { CSSProperties, useState } from "react";
import { FaEye, FaEyeSlash, FaCog } from "react-icons/fa";

import { modalWithState } from "./modal";
import { useGlobalState, withUrlChange } from "./globalState";
import { channelIcon } from "./channelIcon";
import { ViewMode } from "./util";
import { ReorderModalWithState } from "./reorderModal";
import { useChannelNowPlaying } from "./useChannelNowPlaying";

const rowStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: '10px 8px',
    borderRadius: 8,
    cursor: 'pointer',
};

const headerButtonStyle: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '2px solid rgba(255, 255, 255, 0.25)',
    color: 'white',
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 14,
};

// A full list of saved channels to pick from, each with its icon and — if
// guide data is on and available — what's currently playing. Replaces the
// native DropdownItem this plugin used to show the current channel with:
// that component's own internal layout turned out to squeeze the channel
// name down to a thin, right-justified sliver no matter what was tried to
// override it (a plain label removal, then a full renderButtonValue
// override) — building this list ourselves guarantees the layout instead
// of fighting Steam's own compiled-in styling for it.
export const ChannelPickerModal = (props: ModalRootProps) => {
    const [{ bookmarks, url, defaultEpgUrl, showNowPlaying }, setGlobalState, stateContext] = useGlobalState();
    // Peek-at-the-URL toggle for this list, same idea as Manage Channels'
    // own Simple/Complex view — off by default, local-only (not persisted).
    const [showUrls, setShowUrls] = useState(false);
    // What's on each channel right now, so picking one isn't a guess — same
    // shared poll settings.tsx's own Channel row uses (see
    // useChannelNowPlaying's own comment).
    const channelNowPlaying = useChannelNowPlaying(bookmarks, defaultEpgUrl, showNowPlaying);

    const select = (bookmarkUrl: string) => {
        setGlobalState(state => ({
            ...withUrlChange(state, bookmarkUrl),
            visible: true,
            viewMode: ViewMode.Picture,
            playing: true,
        }));
        props.closeModal?.();
    };

    // Channels hidden via Manage Channels' eye icon are tucked away, not
    // deleted — they simply don't clutter this everyday picker list.
    const visibleBookmarks = bookmarks.filter(b => !b.hidden);

    return <ConfirmModal
        {...props}
        strTitle="Choose a Channel"
        strOKButtonText="Close"
        onOK={() => { }}>
        {/* Add Channel used to have its own shortcut here too
            [Confirmed by Josh, 2026-09-20] — it now lives only in Manage
            Channels (reorderModal.tsx), so this is just the quickest way to
            get there (or to peek at each channel's URL inline first, same
            as Manage Channels' own Complex view) without closing this,
            opening the panel, and finding that button again. */}
        <Focusable
            style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}
            flow-children="horizontal">
            <Focusable
                style={headerButtonStyle}
                title={showUrls ? "Hide Channel URLs" : "Show Channel URLs"}
                onActivate={() => setShowUrls(v => !v)}
                onClick={() => setShowUrls(v => !v)}>
                {showUrls ? <FaEyeSlash /> : <FaEye />}
            </Focusable>
            {/* [Confirmed by Josh, 2026-09-20] Gear now, not a wrench —
                this opens the exact same "Steam PiP Settings" window as the
                gear in the QAM panel's own title bar (settings.tsx), so it
                gets the same icon and the same short "Settings" tooltip. */}
            <Focusable
                style={headerButtonStyle}
                title="Settings"
                onActivate={() => { props.closeModal?.(); showModal(<ReorderModalWithState value={stateContext} />); }}
                onClick={() => { props.closeModal?.(); showModal(<ReorderModalWithState value={stateContext} />); }}>
                <FaCog />
            </Focusable>
        </Focusable>
        <Focusable
            style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}
            flow-children="vertical">
            {visibleBookmarks.map(bookmark => {
                const current = bookmark.url === url;
                const nowPlaying = channelNowPlaying[bookmark.id];
                return (
                    <Focusable
                        key={bookmark.id}
                        style={{
                            ...rowStyle,
                            background: current ? 'rgba(90, 170, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)',
                            border: current ? '2px solid rgba(90, 170, 255, 0.9)' : '2px solid transparent',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            gap: 2,
                        }}
                        onActivate={() => select(bookmark.url)}
                        onClick={() => select(bookmark.url)}>
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <div style={{ fontSize: 18, flexShrink: 0, display: 'flex' }}>
                                {channelIcon(bookmark)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {bookmark.name}
                            </div>
                        </div>
                        {/* Its own full-width section below the icon+name
                            row, rather than squeezed into that row's own
                            width-constrained, single-line/ellipsis text —
                            wraps instead of getting cut off. Left-padded to
                            roughly line up under the name, past the icon.
                            [Confirmed by Josh, 2026-09-20] The guide's own
                            <title> is often just the generic program/league
                            name ("NFL Football", "Premier Lacrosse League"),
                            with the actual specific matchup ("Minnesota
                            Vikings at Chicago Bears") sitting in <sub-title>
                            instead — main.py already captures both, but only
                            title was ever shown here, silently dropping the
                            one piece of information most useful for
                            deciding what to watch. */}
                        {nowPlaying?.title && (
                            <div style={{ paddingLeft: 28, fontSize: 11, opacity: 0.8, whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                {nowPlaying.title}
                                {/* Colon, not em dash — see settings.tsx's
                                    matching row for the same change. */}
                                {nowPlaying.subtitle && <span>: {nowPlaying.subtitle}</span>}
                            </div>
                        )}
                        {showUrls && (
                            <div style={{ paddingLeft: 28, fontSize: 11, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {bookmark.url}
                            </div>
                        )}
                    </Focusable>
                );
            })}
        </Focusable>
    </ConfirmModal>;
};

export const ChannelPickerModalWithState = modalWithState(ChannelPickerModal);
