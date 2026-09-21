import {
    TextField,
    ConfirmModal,
    ModalRootProps,
    Field,
} from "@decky/ui";
import { useState } from "react";

import { modalWithState } from "./modal";
import { useGlobalState } from "./globalState";

// Moved out of the always-visible panel and into its own modal — this is a
// set-once-and-forget setting (an XMLTV guide URL applied to every channel
// that doesn't set its own), so it doesn't need permanent real estate in
// the QAM's main view. Opened via its own icon in the channel-management
// row instead.
export const GuideSettingsModal = (props: ModalRootProps) => {
    const [{ defaultEpgUrl }, setGlobalState] = useGlobalState();
    const [epgUrl, setEpgUrl] = useState(defaultEpgUrl);

    const save = () => {
        setGlobalState(state => ({ ...state, defaultEpgUrl: epgUrl.trim() }));
    };

    return <ConfirmModal
        {...props}
        strTitle="Channel Guide Settings"
        strOKButtonText="Save"
        onOK={save}>
        <Field
            label="Channel Guide URL (all channels)"
            description="An XMLTV feed URL (e.g. from a home DVR server) applied to any channel that doesn't set its own. Leave blank if you don't have one."
            bottomSeparator="none"
            childrenLayout="below">
            <TextField
                value={epgUrl}
                onChange={e => setEpgUrl(e.target.value)} />
        </Field>
    </ConfirmModal>;
};

export const GuideSettingsModalWithState = modalWithState(GuideSettingsModal);
