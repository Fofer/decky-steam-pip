import {
    Focusable,
    ConfirmModal,
    ModalRootProps,
    TextField,
    showModal,
    GamepadButton,
    GamepadEvent,
} from "@decky/ui";
import { CSSProperties, useRef, useState } from "react";
import { FaPlus, FaGripLines, FaTrash, FaEdit, FaEye, FaEyeSlash, FaCamera, FaFolderOpen, FaWindowMaximize } from "react-icons/fa";
import { MdSettingsInputAntenna } from "react-icons/md";

import { StateManager } from "cotton-box";

import { modalWithState } from "./modal";
import { useGlobalState, Bookmark, State } from "./globalState";
import { BookmarkModalWithState } from "./bookmarkModal";
import { GuideSettingsModalWithState } from "./guideSettingsModal";
import { ScreenshotSettingsModalWithState } from "./screenshotSettingsModal";
import { OverlaySettingsModalWithState } from "./overlaySettingsModal";
import { ChannelManagementModalWithState } from "./channelManagementModal";
import { channelIcon } from "./channelIcon";

const rowStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 4px',
};

// [Confirmed by Josh, 2026-09-20] Replaces the old up/down arrow pair —
// modeled on how Decky's own plugin manager reorders its list: grab this
// handle (A), then D-pad up/down moves the row one slot at a time while
// grabbed, then A again locks it in place (B cancels the grab and puts it
// back where it started). One handle does both pick-up and drop, rather
// than separate move controls per row.
const grabHandleStyle = (grabbed: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: grabbed ? 'rgba(120, 200, 120, 0.55)' : 'rgba(255, 255, 255, 0.08)',
    border: grabbed ? '2px solid rgba(120, 200, 120, 0.9)' : '2px solid rgba(255, 255, 255, 0.25)',
    color: 'white',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 150ms, border-color 150ms',
});

const arrowButtonStyle = (enabled: boolean): CSSProperties => ({
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '2px solid rgba(255, 255, 255, 0.25)',
    color: enabled ? 'white' : 'rgba(255, 255, 255, 0.3)',
    cursor: enabled ? 'pointer' : 'default',
    flexShrink: 0,
});

// The one-time/rare setup actions (guide data source, restoring the default
// channel set, export/import) — pulled out of the main panel's always-on
// icon row and given a home here instead, at the bottom of the channel
// list, since they're reached for once in a while during setup rather than
// during regular use.
const bottomButtonStyle: CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '2px solid rgba(255, 255, 255, 0.25)',
    color: 'white',
    cursor: 'pointer',
    flexShrink: 0,
    fontSize: 15,
};

// A small standalone "are you sure?" confirmation, shown on top of the
// arrange list itself. Deleting from here is otherwise a single tap with
// no undo, so this is the only guard against an accidental removal.
interface DeleteConfirmModalProps extends ModalRootProps {
    bookmark: Bookmark
    value: StateManager<State>
}

const DeleteConfirmModal = ({ bookmark, value, ...props }: DeleteConfirmModalProps) => {
    return <ConfirmModal
        {...props}
        strTitle="Delete Channel?"
        strDescription={`Remove "${bookmark.name}" from your channels? This can't be undone.`}
        strOKButtonText="Delete"
        strCancelButtonText="Cancel"
        onOK={() => value.set(state => ({
            ...state,
            bookmarks: state.bookmarks.filter(b => b.id !== bookmark.id)
        }))} />;
}

// Lets the user reorder saved channels with up/down controls, so channels
// added later (e.g. a custom URL migrated in from an older build) don't
// have to stay stuck at the bottom of the list. Also offers a delete
// (trash) button per row, behind its own confirmation, so removing a
// channel doesn't require going through Edit first. Doubles as the home for
// the channel-related setup actions that used to live in the main panel's
// icon row — Guide Data Settings, Screenshot Settings, and On-Screen
// Overlay Settings sit in the top row now (reached for often enough to want
// up front), while Export/Import/Restore Default Channels stay grouped into
// one Channel Management icon (channelManagementModal.tsx) at the bottom,
// since that trio really is a rare, one-time/setup-only action.
export const ReorderModal = (props: ModalRootProps) => {
    const [{ bookmarks }, setGlobalState, stateContext] = useGlobalState();
    // Plain local state, not persisted — this is a "peek at the URLs while
    // I'm in here" toggle, not a lasting preference, so it resets to the
    // simpler view the next time this modal is opened.
    const [complexView, setComplexView] = useState(false);

    // Which channel's grab handle is currently "picked up", if any — null
    // means nothing's grabbed, in which case D-pad up/down just move focus
    // between rows as normal. Only one row can be grabbed at a time.
    // grabStartIndexRef remembers where that row started, so Cancel (B) can
    // put it back rather than leaving whatever partial move was in
    // progress. A ref rather than state since it's only ever read inside
    // event handlers, never rendered.
    const [grabbedId, setGrabbedId] = useState<string | null>(null);
    const grabStartIndexRef = useRef<number | null>(null);

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= bookmarks.length) return;

        setGlobalState(state => {
            const next = [...state.bookmarks];
            [next[index], next[target]] = [next[target], next[index]];
            return { ...state, bookmarks: next };
        });
    };

    const toggleGrab = (id: string, index: number) => {
        if (grabbedId === id) {
            // Already holding this one — A locks it in place.
            setGrabbedId(null);
            grabStartIndexRef.current = null;
        } else if (grabbedId === null) {
            // Nothing else is being held — pick this one up.
            setGrabbedId(id);
            grabStartIndexRef.current = index;
        }
        // If some OTHER row is already grabbed, ignore — its own handle is
        // the only thing that should be intercepting D-pad right now, and
        // focus shouldn't be able to reach a different row's handle while
        // held anyway (see onGrabButtonDown's preventDefault below).
    };

    // [Unverified] D-pad up/down while a row is held — Focusable's own
    // onButtonDown fires for every gamepad button while it has focus;
    // GamepadButton.DIR_UP/DIR_DOWN are what a D-pad press reports here.
    // preventDefault() is called specifically to stop Decky's own built-in
    // focus-navigation from ALSO moving focus to the next row on the same
    // press — not confirmed against real hardware that this suppresses it
    // (rather than both things happening at once); if a D-pad press both
    // reorders AND shifts focus off the handle when tested on the Deck,
    // this is the first thing to revisit.
    const onGrabButtonDown = (id: string, index: number) => (evt: GamepadEvent) => {
        if (grabbedId !== id) return;
        if (evt.detail.button === GamepadButton.DIR_UP) {
            evt.preventDefault();
            move(index, -1);
        } else if (evt.detail.button === GamepadButton.DIR_DOWN) {
            evt.preventDefault();
            move(index, 1);
        }
    };

    // B while held puts the channel back where it started rather than
    // leaving it wherever it happened to be — [Confirmed by Josh,
    // 2026-09-20] matching "hit A to lock it in" implies B is the "never
    // mind" out. stopPropagation is an attempt to keep this from ALSO
    // closing the whole Settings modal (B's other, default job) — same
    // [Unverified] caveat as above; if B both cancels the grab and closes
    // the modal in one press when tested for real, that's this line.
    const onGrabCancel = (id: string) => (evt: GamepadEvent) => {
        if (grabbedId !== id) return;
        evt.preventDefault();
        evt.stopPropagation();
        const startIndex = grabStartIndexRef.current;
        if (startIndex !== null) {
            setGlobalState(state => {
                const currentIndex = state.bookmarks.findIndex(b => b.id === id);
                if (currentIndex === -1 || currentIndex === startIndex) return state;
                const next = [...state.bookmarks];
                const [item] = next.splice(currentIndex, 1);
                next.splice(startIndex, 0, item);
                return { ...state, bookmarks: next };
            });
        }
        setGrabbedId(null);
        grabStartIndexRef.current = null;
    };

    const setUrl = (id: string, url: string) => {
        setGlobalState(state => ({
            ...state,
            bookmarks: state.bookmarks.map(b => b.id === id ? { ...b, url } : b)
        }));
    };

    const toggleHidden = (id: string) => {
        setGlobalState(state => ({
            ...state,
            bookmarks: state.bookmarks.map(b => b.id === id ? { ...b, hidden: !b.hidden } : b)
        }));
    };

    const canDelete = bookmarks.length > 1;

    return <ConfirmModal
        {...props}
        strTitle="Steam PiP Settings"
        strOKButtonText="Done"
        onOK={() => { }}>
        {/* Add Channel used to live in the main panel's channel row and
            again in the Channel Picker's own header
            [Confirmed by Josh, 2026-09-20] — consolidated to just here now,
            top-right, ahead of the Show Channel URLs toggle at the far end
            (that one last, so the row reads left-to-right as "add", then
            the settings sub-pages, then "peek at what's already here").
            Guide Data/Screenshot/On-Screen Overlay Settings used to sit in
            their own row at the very bottom of this modal — moved up here
            between Add and Show Channel URLs since they turned out to be
            reached for often enough to want at the top, not tucked away
            below the whole channel list. Complex view (Show Channel URLs)
            reveals each channel's URL, editable in place, without having to
            open the full Add/Edit Channel modal just to glance at or tweak
            an address — off by default to keep the common case (reorder/
            hide/delete) uncluttered. */}
        {/* [Confirmed by Josh, 2026-09-20] Pulled up with a negative
            marginTop so this row sits level with the "Steam PiP Settings"
            title text above it instead of on its own line below — the
            ConfirmModal title itself isn't something this can render buttons
            into directly, so this is positioned to visually line up with it
            instead. marginBottom is deliberately generous (not just enough
            to clear it) so there's real breathing room before the channel
            list below, now that this row sits higher up. [Unverified]
            -36px/24 are a first estimate for exactly how far up/how much
            room — Decky's own ConfirmModal title spacing isn't something
            this could measure without seeing it rendered. */}
        <Focusable
            style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: -36, marginBottom: 24 }}
            flow-children="horizontal">
            <Focusable
                style={arrowButtonStyle(true)}
                title="Add Channel"
                onActivate={() => showModal(<BookmarkModalWithState value={stateContext} />)}
                onClick={() => showModal(<BookmarkModalWithState value={stateContext} />)}>
                <FaPlus />
            </Focusable>
            <Focusable
                style={arrowButtonStyle(true)}
                title="Guide Data Settings"
                onActivate={() => showModal(<GuideSettingsModalWithState value={stateContext} />)}
                onClick={() => showModal(<GuideSettingsModalWithState value={stateContext} />)}>
                <MdSettingsInputAntenna />
            </Focusable>
            <Focusable
                style={arrowButtonStyle(true)}
                title="Screenshot Settings"
                onActivate={() => showModal(<ScreenshotSettingsModalWithState value={stateContext} />)}
                onClick={() => showModal(<ScreenshotSettingsModalWithState value={stateContext} />)}>
                <FaCamera />
            </Focusable>
            <Focusable
                style={arrowButtonStyle(true)}
                title="Display Settings"
                onActivate={() => showModal(<OverlaySettingsModalWithState value={stateContext} />)}
                onClick={() => showModal(<OverlaySettingsModalWithState value={stateContext} />)}>
                <FaWindowMaximize />
            </Focusable>
            {/* [Confirmed by Josh, 2026-09-20] Was a chevron before — now an
                eye, matching the identical toggle in the Channel Picker
                (channelPickerModal.tsx), since they do the exact same thing. */}
            <Focusable
                style={arrowButtonStyle(true)}
                title={complexView ? "Simple View" : "Show Channel URLs"}
                onActivate={() => setComplexView(v => !v)}
                onClick={() => setComplexView(v => !v)}>
                {complexView ? <FaEyeSlash /> : <FaEye />}
            </Focusable>
        </Focusable>
        <Focusable style={{ display: 'flex', flexDirection: 'column' }} flow-children="vertical">
            {bookmarks.map((bookmark, index) => {
                const isGrabbed = grabbedId === bookmark.id;
                const anyGrabbed = grabbedId !== null;
                return (
                <Focusable key={bookmark.id} style={{ display: 'flex', flexDirection: 'column' }} flow-children="vertical">
                    <Focusable
                        style={{
                            ...rowStyle,
                            // [Confirmed by Josh, 2026-09-20] The row being
                            // moved gets a soft highlight so it's obvious
                            // which one is picked up; every OTHER row
                            // compresses its own padding slightly while
                            // anything is held, the way Decky's own plugin
                            // manager's list visibly makes room around the
                            // row currently being dragged.
                            padding: anyGrabbed && !isGrabbed ? '4px 4px' : rowStyle.padding,
                            background: isGrabbed ? 'rgba(120, 200, 120, 0.12)' : 'transparent',
                            borderRadius: isGrabbed ? 8 : 0,
                            transition: 'padding 150ms, background 150ms',
                        }}
                        flow-children="horizontal">
                        {/* Grab handle — replaces the old up/down arrow pair.
                            A picks this row up; while held, D-pad up/down
                            moves it one slot at a time (onGrabButtonDown);
                            A again locks it in place; B puts it back where
                            it started (onGrabCancel). */}
                        <Focusable
                            style={grabHandleStyle(isGrabbed)}
                            title={isGrabbed ? "Lock In Place" : "Grab to Reorder"}
                            onOKActionDescription={isGrabbed ? "Drop" : "Grab"}
                            onCancelActionDescription={isGrabbed ? "Cancel" : undefined}
                            onActivate={() => toggleGrab(bookmark.id, index)}
                            onClick={() => toggleGrab(bookmark.id, index)}
                            onButtonDown={onGrabButtonDown(bookmark.id, index)}
                            onCancel={onGrabCancel(bookmark.id)}>
                            <FaGripLines />
                        </Focusable>
                        <div style={{ fontSize: 15, flexShrink: 0, display: 'flex', opacity: bookmark.hidden ? 0.4 : 1 }}>
                            {channelIcon(bookmark)}
                        </div>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, opacity: bookmark.hidden ? 0.4 : 1 }}>
                            {bookmark.name}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
                            {/* Edits this one channel in place (reusing the
                                same Add/Edit Channel modal the "+"/pencil
                                icons in the main panel use) — chosen over
                                inlining every field directly into this list,
                                since a channel has several editable fields
                                (name, URL, per-channel guide settings)
                                beyond just the URL the Complex view exposes. */}
                            <Focusable
                                style={arrowButtonStyle(true)}
                                onActivate={() => showModal(<BookmarkModalWithState value={stateContext} bookmarkId={bookmark.id} />)}
                                onClick={() => showModal(<BookmarkModalWithState value={stateContext} bookmarkId={bookmark.id} />)}>
                                <FaEdit />
                            </Focusable>
                            {/* Tucks a channel away from the channel picker
                                and Previous/Next surfing without deleting
                                its saved URL/guide settings — e.g. a channel
                                you're not watching right now but don't want
                                to lose. */}
                            <Focusable
                                style={arrowButtonStyle(true)}
                                title={bookmark.hidden ? "Show in Channel List" : "Hide from Channel List"}
                                onActivate={() => toggleHidden(bookmark.id)}
                                onClick={() => toggleHidden(bookmark.id)}>
                                {bookmark.hidden ? <FaEyeSlash /> : <FaEye />}
                            </Focusable>
                            <Focusable
                                style={arrowButtonStyle(canDelete)}
                                onActivate={() => canDelete && showModal(<DeleteConfirmModal bookmark={bookmark} value={stateContext} />)}
                                onClick={() => canDelete && showModal(<DeleteConfirmModal bookmark={bookmark} value={stateContext} />)}>
                                <FaTrash />
                            </Focusable>
                        </div>
                    </Focusable>
                    {complexView && (
                        <div style={{ padding: '0 4px 8px' }}>
                            <TextField
                                value={bookmark.url}
                                onChange={e => setUrl(bookmark.id, e.target.value)} />
                        </div>
                    )}
                </Focusable>
                );
            })}
        </Focusable>
        <Focusable
            style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10, marginTop: 16, paddingTop: 12, borderTop: '1px solid rgba(255, 255, 255, 0.15)' }}
            flow-children="horizontal">
            {/* Export, Import, and Restore Default Channels used to each be
                their own icon here, alongside Guide Data/Screenshot/Overlay
                Settings (moved up to the top row now — see the comment
                there). [Confirmed by Josh, 2026-09-20] that made this row
                feel cluttered/intimidating — those three are all "channel
                list bulk management" in the same way, so they're grouped
                into one modal behind a single icon instead (see
                channelManagementModal.tsx, which keeps Restore Default
                Channels' own red-tinted warning treatment), left as the one
                rare/tucked-away action still down here. */}
            <Focusable
                style={bottomButtonStyle}
                title="Channel Management (Export / Import / Restore Defaults)"
                onActivate={() => showModal(<ChannelManagementModalWithState value={stateContext} />)}
                onClick={() => showModal(<ChannelManagementModalWithState value={stateContext} />)}>
                <FaFolderOpen />
            </Focusable>
        </Focusable>
    </ConfirmModal>;
}

export const ReorderModalWithState = modalWithState(ReorderModal);
