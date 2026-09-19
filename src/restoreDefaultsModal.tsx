import {
    ConfirmModal,
    ModalRootProps,
} from "@decky/ui";

import { modalWithState } from "./modal";
import { useGlobalState } from "./globalState";
import { CURATED_BOOKMARKS } from "./defaultBookmarks";

// A plain "are you sure?" in front of a destructive, all-at-once action —
// replacing the whole channel list wipes out any custom additions or edits
// in one go, with no per-item undo like the Arrange list's delete has.
export const RestoreDefaultsModal = (props: ModalRootProps) => {
    const [, setGlobalState] = useGlobalState();

    return <ConfirmModal
        {...props}
        strTitle="Restore Default Channels?"
        strDescription="This replaces your entire channel list with the original preset. Any channels you've added, edited, reordered, or removed will be lost. This can't be undone."
        strOKButtonText="Restore"
        strCancelButtonText="Cancel"
        onOK={() => setGlobalState(state => ({
            ...state,
            bookmarks: CURATED_BOOKMARKS.map(bookmark => ({ ...bookmark })),
            url: CURATED_BOOKMARKS[0].url,
        }))} />;
}

export const RestoreDefaultsModalWithState = modalWithState(RestoreDefaultsModal);
