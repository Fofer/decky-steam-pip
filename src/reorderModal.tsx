import {
    Focusable,
    ConfirmModal,
    ModalRootProps,
    showModal,
} from "@decky/ui";
import { CSSProperties } from "react";
import { FaArrowUp, FaArrowDown, FaTrash } from "react-icons/fa";

import { StateManager } from "cotton-box";

import { modalWithState } from "./modal";
import { useGlobalState, Bookmark, State } from "./globalState";

const rowStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '8px 4px',
};

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
// channel doesn't require going through Edit first.
export const ReorderModal = (props: ModalRootProps) => {
    const [{ bookmarks }, setGlobalState, stateContext] = useGlobalState();

    const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= bookmarks.length) return;

        setGlobalState(state => {
            const next = [...state.bookmarks];
            [next[index], next[target]] = [next[target], next[index]];
            return { ...state, bookmarks: next };
        });
    };

    const canDelete = bookmarks.length > 1;

    return <ConfirmModal
        {...props}
        strTitle="Arrange Channels"
        strOKButtonText="Done"
        onOK={() => { }}>
        <Focusable style={{ display: 'flex', flexDirection: 'column' }} flow-children="vertical">
            {bookmarks.map((bookmark, index) => (
                <Focusable key={bookmark.id} style={rowStyle} flow-children="horizontal">
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {bookmark.name}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
                        <Focusable
                            style={arrowButtonStyle(index > 0)}
                            onActivate={() => move(index, -1)}
                            onClick={() => move(index, -1)}>
                            <FaArrowUp />
                        </Focusable>
                        <Focusable
                            style={arrowButtonStyle(index < bookmarks.length - 1)}
                            onActivate={() => move(index, 1)}
                            onClick={() => move(index, 1)}>
                            <FaArrowDown />
                        </Focusable>
                        <Focusable
                            style={arrowButtonStyle(canDelete)}
                            onActivate={() => canDelete && showModal(<DeleteConfirmModal bookmark={bookmark} value={stateContext} />)}
                            onClick={() => canDelete && showModal(<DeleteConfirmModal bookmark={bookmark} value={stateContext} />)}>
                            <FaTrash />
                        </Focusable>
                    </div>
                </Focusable>
            ))}
        </Focusable>
    </ConfirmModal>;
}

export const ReorderModalWithState = modalWithState(ReorderModal);
