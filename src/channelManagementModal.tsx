import {
    ConfirmModal,
    ModalRootProps,
    Field,
    ButtonItem,
    showModal,
} from "@decky/ui";
import { FaFileExport, FaFileImport, FaUndo } from "react-icons/fa";

import { modalWithState } from "./modal";
import { useGlobalState } from "./globalState";
import { exportChannels, importChannels } from "./channelBackupModal";
import { RestoreDefaultsModalWithState } from "./restoreDefaultsModal";

// [Confirmed by Josh, 2026-09-20] Restore Default Channels used to get its
// own red-tinted treatment (first a solid border, then a plain light-red
// fill) to set it apart from the harmless Export/Import fields above it —
// dropped entirely now that it's no longer sitting loose in the main panel's
// row: it's tucked a level down behind its own "Channel Management" icon,
// and still has its own confirmation dialog (restoreDefaultsModal.tsx)
// before it actually does anything, so the extra red flag on top of both of
// those was no longer pulling its weight.
//
// Export, Import, and Restore Default Channels used to each be their own
// icon sitting loose in Manage Channels' bottom row alongside Guide Data
// and Screenshot Settings. [Confirmed by Josh, 2026-09-20] that row felt
// cluttered/intimidating — these three are all "channel list bulk
// management" in a way the other two settings aren't, so they're grouped
// here into one modal, reached from a single "Channel Management" icon
// instead of three separate ones.
export const ChannelManagementModal = (props: ModalRootProps) => {
    const [{ bookmarks }, setGlobalState, stateContext] = useGlobalState();

    return <ConfirmModal
        {...props}
        strTitle="Channel Management"
        strOKButtonText="Close"
        onOK={() => { }}>
        <Field
            label="Export Channels"
            description="Save your current channel list to a file you choose, so you can back it up or move it to another device."
            bottomSeparator="standard"
            childrenLayout="below">
            <ButtonItem layout="below" onClick={() => exportChannels(bookmarks)}>
                <FaFileExport style={{ marginRight: 8 }} />
                Export…
            </ButtonItem>
        </Field>
        <Field
            label="Import Channels"
            description="Load a previously exported channel list, either appending it to your current channels or replacing them entirely."
            bottomSeparator="standard"
            childrenLayout="below">
            <ButtonItem layout="below" onClick={() => importChannels(setGlobalState)}>
                <FaFileImport style={{ marginRight: 8 }} />
                Import…
            </ButtonItem>
        </Field>
        <Field
            label="Restore Default Channels"
            description="Replaces your entire channel list with the original preset. Any channels you've added, edited, reordered, or removed will be lost. This can't be undone (you'll still get a confirmation first)."
            bottomSeparator="none"
            childrenLayout="below">
            <ButtonItem
                layout="below"
                onClick={() => showModal(<RestoreDefaultsModalWithState value={stateContext} />)}>
                <FaUndo style={{ marginRight: 8 }} />
                Restore Default Channels…
            </ButtonItem>
        </Field>
    </ConfirmModal>;
};

export const ChannelManagementModalWithState = modalWithState(ChannelManagementModal);
