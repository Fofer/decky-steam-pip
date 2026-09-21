import {
    ConfirmModal,
    ModalRootProps,
    Field,
    TextField,
    ButtonItem,
    Focusable,
    showModal,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { FaFolder, FaFile } from "react-icons/fa";

import { Bookmark, State } from "./globalState";
import { backendCall } from "./backendCall";

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

// Shown after the user has already picked a destination folder — this is
// just the one remaining choice, what to call the file.
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

interface DirEntry {
    name: string
    is_dir: boolean
}

interface ListResult {
    path: string
    entries: DirEntry[]
    error?: string
}

const parentOf = (path: string) => {
    const trimmed = path.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    return idx <= 0 ? '/' : trimmed.slice(0, idx);
};

const joinPath = (dir: string, name: string) => dir.endsWith('/') ? dir + name : dir + '/' + name;

interface FileBrowserModalProps extends ModalRootProps {
    startPath: string
    // "folder": Select-this-folder button, used for export's destination.
    // "file": clicking a file selects and closes immediately, used for
    // import's source file (there's nothing meaningful for a separate OK
    // button to do, so it's just a Close).
    mode: "folder" | "file"
    extensions?: string[]
    onSelectFolder?: (path: string) => void
    onSelectFile?: (path: string) => void
}

// Steam PiP's own in-panel folder/file browser. Decky's native
// openFilePicker was tried here first (it's a real, documented API), but in
// practice it did nothing when opened from this plugin's Quick Access Menu
// panel — no dialog, no error, on both export and import. This uses the
// same ConfirmModal + Focusable list pattern this plugin's other modals
// (Add/Edit Channel, Reorder, Restore Defaults) already use successfully,
// backed by the plugin's own list_directory call instead of a native
// picker.
export const FileBrowserModal = ({ startPath, mode, extensions, onSelectFolder, onSelectFile, ...props }: FileBrowserModalProps) => {
    const [currentPath, setCurrentPath] = useState(startPath);
    const [entries, setEntries] = useState<DirEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(undefined);
        backendCall<[string, string[] | null], ListResult>(
            "list_directory", currentPath, mode === "file" ? (extensions ?? null) : null)
            .then(result => {
                if (cancelled) return;
                setEntries(result?.entries ?? []);
                setError(result?.error);
                setLoading(false);
            })
            .catch(e => {
                if (cancelled) return;
                setError(String(e));
                setEntries([]);
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, [currentPath]);

    return <ConfirmModal
        {...props}
        strTitle={mode === "folder" ? "Choose a Folder" : "Choose a File"}
        strOKButtonText={mode === "folder" ? "Select This Folder" : "Close"}
        onOK={() => {
            if (mode === "folder") onSelectFolder?.(currentPath);
        }}>
        <div style={{ marginBottom: 8, fontSize: 12, opacity: 0.75, wordBreak: 'break-all' }}>{currentPath}</div>
        <Focusable
            style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}
            flow-children="vertical">
            {currentPath !== '/' && (
                <ButtonItem layout="below" onClick={() => setCurrentPath(parentOf(currentPath))}>
                    .. (up one folder)
                </ButtonItem>
            )}
            {loading && <div style={{ opacity: 0.7, padding: 8 }}>Loading…</div>}
            {!loading && error && <div style={{ color: '#ff6b6b', padding: 8 }}>{error}</div>}
            {!loading && !error && entries.length === 0 && (
                <div style={{ opacity: 0.7, padding: 8 }}>Empty folder.</div>
            )}
            {!loading && entries.map(entry => (
                <ButtonItem
                    key={entry.name}
                    layout="below"
                    onClick={() => {
                        const fullPath = joinPath(currentPath, entry.name);
                        if (entry.is_dir) {
                            setCurrentPath(fullPath);
                        } else if (mode === "file") {
                            onSelectFile?.(fullPath);
                            props.closeModal?.();
                        }
                    }}>
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {entry.is_dir ? <FaFolder /> : <FaFile />}
                        <span>{entry.name}</span>
                    </div>
                </ButtonItem>
            ))}
        </Focusable>
    </ConfirmModal>;
};

// Lets the user browse to any folder on the device (not assumed to be
// Downloads) with the in-panel browser above, then name the file
// themselves, then writes it there through the backend.
export const exportChannels = async (bookmarks: Bookmark[]) => {
    // Diagnostic: export/import have twice reported doing nothing at all on
    // real hardware (first with Decky's native file picker, then with this
    // custom in-panel browser), despite both testing out correctly in
    // isolation. This toast fires synchronously, before any async work or
    // modal, independent of this panel's own render tree — so it tells us
    // whether the click itself is even reaching this function. Confirmed
    // this round: the toast DOES appear, but nothing after it does — which
    // points at a backend `call()` that hangs rather than rejects (see
    // backendCall.ts), silently blocking the `await` below forever before
    // showModal is ever reached. That's now wrapped with a timeout so it
    // can't stall this indefinitely.
    toaster.toast({ title: "Steam PiP", body: "Export button pressed…" });

    let homeDir = "/home/deck";
    try {
        homeDir = (await backendCall<[], string>("get_home_dir")) || homeDir;
    } catch (e) {
        // Still shows the browser below with a fallback path — but if this
        // was a BackendTimeoutError, that's worth knowing about directly.
        toaster.toast({ title: "Steam PiP", body: String(e) });
    }

    showModal(<FileBrowserModal
        startPath={homeDir}
        mode="folder"
        onSelectFolder={(folderPath) => {
            showModal(<FilenameModal
                defaultFilename={defaultExportFilename()}
                onConfirm={async (filename) => {
                    try {
                        const result = await backendCall<[string, string, string], { path?: string, error?: string }>(
                            "export_channels_to", JSON.stringify(bookmarks), folderPath, filename);
                        showModal(<ResultModal
                            title="Export Channels"
                            message={result?.path
                                ? `Saved to:\n${result.path}`
                                : `Couldn't save the export: ${result?.error ?? "Unknown error"}`} />);
                    } catch (e) {
                        showModal(<ResultModal title="Export Channels" message={`Couldn't save the export: ${e}`} />);
                    }
                }} />);
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

// Lets the user browse to and pick any .json file on the device with the
// in-panel browser above (not assumed to be in Downloads), reads and
// validates it through the backend, then asks whether to append it to or
// replace the current channel list.
export const importChannels = async (setGlobalState: (setter: (state: State) => State) => void) => {
    // See the matching comment in exportChannels — same diagnostic purpose.
    toaster.toast({ title: "Steam PiP", body: "Import button pressed…" });

    let homeDir = "/home/deck";
    try {
        homeDir = (await backendCall<[], string>("get_home_dir")) || homeDir;
    } catch (e) {
        toaster.toast({ title: "Steam PiP", body: String(e) });
    }

    showModal(<FileBrowserModal
        startPath={homeDir}
        mode="file"
        extensions={["json"]}
        onSelectFile={async (filePath) => {
            let result: { bookmarks?: Bookmark[], error?: string } | undefined;
            try {
                result = await backendCall<[string], { bookmarks?: Bookmark[], error?: string }>(
                    "import_channels_from_path", filePath);
            } catch (e) {
                showModal(<ResultModal title="Import Channels" message={`Couldn't import: ${e}`} />);
                return;
            }

            if (!result?.bookmarks) {
                showModal(<ResultModal title="Import Channels" message={`Couldn't import: ${result?.error ?? "Unknown error"}`} />);
                return;
            }

            const imported = result.bookmarks;

            showModal(<ModeModal
                filename={filePath}
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
                        // existing channel, so re-importing the same file
                        // twice doesn't duplicate every entry in it.
                        const existingIds = new Set(state.bookmarks.map(b => b.id));
                        const additions = imported.filter(b => !existingIds.has(b.id));
                        return { ...state, bookmarks: [...state.bookmarks, ...additions] };
                    });
                }} />);
        }} />);
};
