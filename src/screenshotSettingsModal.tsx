import {
    ConfirmModal,
    ModalRootProps,
    Field,
    ToggleField,
    ButtonItem,
    showModal,
} from "@decky/ui";
import { useEffect, useState } from "react";
import { toaster } from "@decky/api";

import { modalWithState } from "./modal";
import { useGlobalState } from "./globalState";
import { backendCall } from "./backendCall";
import { FileBrowserModal } from "./channelBackupModal";

// Moved out of the always-visible panel and into its own modal, same
// reasoning as Guide Data Settings — this is a set-once-and-forget setting,
// not something reached for during regular use. [Confirmed by Josh,
// 2026-09-20] The enable/disable toggle here is the one thing that controls
// whether the camera icon shows up ANYWHERE in the plugin at all (the
// channel row, the on-screen control bar) — someone who never takes a
// screenshot shouldn't have it permanently taking up space, so every place
// that icon could appear checks screenshotEnabled first and renders nothing
// at all when it's off, not just a disabled/greyed-out button.
export const ScreenshotSettingsModal = (props: ModalRootProps) => {
    const [{ screenshotEnabled, screenshotSaveDir, lastScreenshotResult }, setGlobalState] = useGlobalState();
    const [enabled, setEnabled] = useState(screenshotEnabled);
    // A blank save dir means "figure it out automatically" (main.py's own
    // best-effort guess at the current game/app's Steam screenshot folder)
    // — the toggle below just decides whether a custom path is shown/used.
    const [useCustomDir, setUseCustomDir] = useState(!!screenshotSaveDir);
    const [saveDir, setSaveDir] = useState(screenshotSaveDir);
    // The actual folder screenshots save to right now — resolved on the
    // backend (get_screenshot_dir) rather than duplicating
    // _resolve_screenshot_dir's own logic here, and re-fetched whenever the
    // custom-folder toggle or chosen folder changes so it's always accurate
    // to what Save would actually apply.
    const [resolvedDir, setResolvedDir] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        backendCall<[string], string>("get_screenshot_dir", useCustomDir ? saveDir.trim() : '')
            .then(dir => { if (!cancelled) setResolvedDir(dir); })
            .catch(() => { if (!cancelled) setResolvedDir(null); });
        return () => { cancelled = true; };
    }, [useCustomDir, saveDir]);

    const openScreenshotFolder = async () => {
        if (!resolvedDir) return;
        try {
            const result = await backendCall<[string], { ok?: boolean, error?: string }>("open_folder", resolvedDir);
            if (result?.error) {
                toaster.toast({ title: "Steam PiP", body: result.error });
            }
        } catch (e) {
            toaster.toast({ title: "Steam PiP", body: String(e) });
        }
    };

    const save = () => {
        setGlobalState(state => ({
            ...state,
            screenshotEnabled: enabled,
            screenshotSaveDir: useCustomDir ? saveDir.trim() : '',
        }));
    };

    // Same in-panel folder browser export/import already use (see
    // channelBackupModal.tsx's own comment) rather than a plain typed-in
    // path — Decky's native folder picker didn't actually work when opened
    // from this plugin, and a raw text field would mean typing out a full
    // path by hand on a controller.
    const browseForFolder = async () => {
        let homeDir = "/home/deck";
        try {
            homeDir = (await backendCall<[], string>("get_home_dir")) || homeDir;
        } catch (e) {
            // Still opens the browser below with a fallback starting path.
        }
        showModal(<FileBrowserModal
            startPath={saveDir || homeDir}
            mode="folder"
            onSelectFolder={setSaveDir} />);
    };

    return <ConfirmModal
        {...props}
        strTitle="Screenshot Settings"
        strOKButtonText="Save"
        onOK={save}>
        <Field
            label="Enable Screenshots"
            description="Shows the camera icon in the channel row and on-screen controls. Off by default so it doesn't clutter things up for anyone who never uses it."
            bottomSeparator="none"
            childrenLayout="below">
            <ToggleField
                checked={enabled}
                onChange={setEnabled} />
        </Field>
        {enabled && <>
            {/* A toast alone isn't enough to see a full save path — it's
                long enough to get visually cut off before it can be read
                [Confirmed by Josh, 2026-09-20] — so the last result also
                lands here, where there's room and no rush to read it. */}
            <Field
                label="Last Screenshot"
                description={lastScreenshotResult || "No screenshot taken yet this session."}
                bottomSeparator="none"
                childrenLayout="below" />
            {/* Deliberately its own dedicated folder, not mixed in with
                Steam's own per-app screenshot folders — [Confirmed by Josh,
                2026-09-20] Steam's Screenshot Manager likely won't show these
                either way (see main.py's own comment), so there's no upside
                to blending in, only the downside of them being harder to
                find among real game screenshots. This field always shows
                exactly where a screenshot would save right now, whichever
                toggle state is chosen below. */}
            <Field
                label="Screenshot Folder"
                description={(resolvedDir || "Figuring out…") + " (Open Folder needs Desktop Mode.)"}
                bottomSeparator="standard"
                childrenLayout="below">
                <ButtonItem layout="below" disabled={!resolvedDir} onClick={openScreenshotFolder}>
                    Open Folder
                </ButtonItem>
            </Field>
            <Field
                label="Save to a Custom Folder"
                description="Off saves to a dedicated Steam PiP folder under Pictures, kept separate from your game screenshots. On lets you pick a different folder instead — e.g. your Downloads folder."
                bottomSeparator="none"
                childrenLayout="below">
                <ToggleField
                    checked={useCustomDir}
                    onChange={setUseCustomDir} />
            </Field>
            {useCustomDir && (
                <Field label="Folder" description={saveDir || "No folder chosen yet."} bottomSeparator="none" childrenLayout="below">
                    <ButtonItem layout="below" onClick={browseForFolder}>
                        Choose Folder…
                    </ButtonItem>
                </Field>
            )}
        </>}
    </ConfirmModal>;
};

export const ScreenshotSettingsModalWithState = modalWithState(ScreenshotSettingsModal);
