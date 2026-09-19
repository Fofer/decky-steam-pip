import {
    ConfirmModal,
    ModalRootProps,
    Field,
    TextField,
    ButtonItem,
    showModal,
} from "@decky/ui";
import { call, openFilePicker, FileSelectionType } from "@decky/api";
import { useState } from "react";

import { Bookmark, State } from "./globalState";

// A plain "here's what happened" dialog — used for both a successful export
// and any error along the way, so there's never a silent "OK"/"Close" with
// nothing to actually confirm.
interface ResultModalProps extends ModalRootProps {
    title: string
    message: string
}

const ResultModal = ({ title, message, ...props }: ResultModalProps) => (
    <ConfirmModal {...props} strTitle={title} strOKButtonText="Close" onOK={() => { }}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{message}</div>
    </ConfirmModal>
);

interface FilenameModalProps extends ModalRootProps {
    defaultFilename: string
    onConfirm: (filename: string) => void
}

// Shown after the user has already picked a destination folder via Decky's
// own native folder browser (the same one used to pick a ZIP to install) —
// this is just the one remaining choice, what to call the file.
const FilenameModal = ({ defaultFilename, onConfirm, ...props }: FilenameModalProps) => {
    const [filename, setFilename] = useState(defaultFilename);

    return <ConfirmModal
        {...props}
        strTitle="Name the Export File"
        strOKButtonText="Save"
        onOK={() => onConfirm(filename.trim() || defaultFilename)}>
        <Field label="Filename" bottomSeparator="none" childrenLayout="below">
            <TextField value={filename} onChange={e => setFilename(e.target.value)} />
        </Field>
    </ConfirmModal>;
};

const defaultExportFilename = () => {
    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    return `steampip-channels-${stamp}.json`;
};

// Lets the user browse to any folder on the device (not assumed to be
// Downloads) via Decky's own native file picker, then name the file
// themselves, then writes it there through the backend.
export const exportChannels = async (bookmarks: Bookmark[]) => {
    let homeDir = "/home/deck";
    try {
        homeDir = (await call<[], string>("get_home_dir")) || homeDir;
    } catch (e) { /* fall back to the default start path */ }

    let folder: { path: string, realpath: string };
    try {
        folder = await openFilePicker(FileSelectionType.FOLDER, homeDir, false, true);
    } catch (e) {
        return; // user canceled — nothing to do
    }

    showModal(<FilenameModal
        defaultFilename={defaultExportFilename()}
        onConfirm={async (filename) => {
            const result = await call<[string, string, string], { path?: string, error?: string }>(
                "export_channels_to", JSON.stringify(bookmarks), folder.realpath, filename);
            showModal(<ResultModal
                title="Export Channels"
                message={result?.path
                    ? `Saved to:\n${result.path}`
                    : `Couldn't save the export: ${result?.error ?? "Unknown error"}`} />);
        }} />);
};

interface ModeModalProps extends ModalRootProps {
    filename: string
    onChoose: (mode: "append" | "overwrite") => void
}

// The append-vs-overwrite choice, asked only for the one file the user just
// picked. Both buttons apply immediately and close the modal — there's no
// separate overall "OK" since these two are the actions.
const ModeModal = ({ filename, onChoose, ...props }: ModeModalProps) => (
    <ConfirmModal {...props} strTitle="Import Channels" strOKButtonText="Close" onOK={() => { }}>
        <div style={{ marginBottom: 12 }}>
            Importing from:<br /><strong>{filename}</strong>
        </div>
        <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
            <div style={{ flex: 1 }}>
                <ButtonItem layout="below" onClick={() => { onChoose("append"); props.closeModal?.(); }}>
                    Append
                </ButtonItem>
            </div>
            <div style={{ flex: 1 }}>
                <ButtonItem layout="below" onClick={() => { onChoose("overwrite"); props.closeModal?.(); }}>
                    Overwrite
                </ButtonItem>
            </div>
        </div>
    </ConfirmModal>
);

// Lets the user browse to and pick any .json file on the device via
// Decky's own native file picker (not assumed to be in Downloads), reads
// and validates it through the backend, then asks whether to append it to
// or replace the current channel list.
export const importChannels = async (setGlobalState: (setter: (state: State) => State) => void) => {
    let homeDir = "/home/deck";
    try {
        homeDir = (await call<[], string>("get_home_dir")) || homeDir;
    } catch (e) { /* fall back to the default start path */ }

    let picked: { path: string, realpath: string };
    try {
        picked = await openFilePicker(FileSelectionType.FILE, homeDir, true, true, undefined, ["json"], false, false);
    } catch (e) {
        return; // user canceled — nothing to do
    }

    const result = await call<[string], { bookmarks?: Bookmark[], error?: string }>(
        "import_channels_from_path", picked.realpath);

    if (!result?.bookmarks) {
        showModal(<ResultModal title="Import Channels" message={`Couldn't import: ${result?.error ?? "Unknown error"}`} />);
        return;
    }

    const imported = result.bookmarks;

    showModal(<ModeModal
        filename={picked.path}
        onChoose={(mode) => {
            setGlobalState(state => {
                if (mode === "overwrite") {
                    return {
                        ...state,
                        bookmarks: imported,
                        url: imported[0]?.url ?? state.url,
                    };
                }
                // Append: skip anything whose id already matches an
                // existing channel, so re-importing the same file twice
                // doesn't duplicate every entry in it.
                const existingIds = new Set(state.bookmarks.map(b => b.id));
                const additions = imported.filter(b => !existingIds.has(b.id));
                return { ...state, bookmarks: [...state.bookmarks, ...additions] };
            });
        }} />);
};
