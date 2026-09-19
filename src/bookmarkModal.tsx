import {
    TextField,
    ConfirmModal,
    ModalRootProps,
    Field,
    ButtonItem,
} from "@decky/ui";
import { useEffect, useState } from "react";

import { modalWithState } from "./modal";
import { useGlobalState, Bookmark } from "./globalState";

interface BookmarkModalProps extends ModalRootProps {
    // Editing an existing bookmark when set; adding a new one otherwise.
    bookmarkId?: string
}

export const BookmarkModal = ({ bookmarkId, ...props }: BookmarkModalProps) => {
    const [{ bookmarks }, setGlobalState] = useGlobalState();
    const existing = bookmarks.find(b => b.id === bookmarkId);
    const [name, setName] = useState(existing?.name ?? "");
    // Defaulting a new channel's address to whatever's currently playing
    // meant it was usually a personal/LAN-only URL (a home DVR server,
    // say) rather than something meant to be typed over — a neutral
    // placeholder address makes it obvious this field needs to be replaced.
    const [address, setAddress] = useState(existing?.url ?? "https://www.example.com");
    // Optional: an XMLTV guide URL (e.g. a home DVR server's guide feed) so
    // this channel can show what's currently airing, the same feature
    // Josh's own personal channels use — open to any channel, not just his.
    const [epgUrl, setEpgUrl] = useState(existing?.epgUrl ?? "");

    useEffect(() => {
        setGlobalState(state => ({
            ...state,
            visible: false
        }));

        return () => setGlobalState(state => ({
            ...state,
            visible: true
        }));
    }, [])

    const save = () => {
        const trimmedName = name.trim() || "Untitled";
        const trimmedEpgUrl = epgUrl.trim() || undefined;

        setGlobalState(state => {
            const bookmark: Bookmark = existing
                ? { ...existing, name: trimmedName, url: address, epgUrl: trimmedEpgUrl }
                : { id: `${Date.now()}`, name: trimmedName, url: address, epgUrl: trimmedEpgUrl };

            const bookmarks = existing
                ? state.bookmarks.map(b => b.id === existing.id ? bookmark : b)
                : [...state.bookmarks, bookmark];

            return {
                ...state,
                visible: true,
                url: address,
                bookmarks
            };
        });
    };

    const remove = () => {
        if (!existing) return;

        setGlobalState(state => ({
            ...state,
            visible: true,
            bookmarks: state.bookmarks.filter(b => b.id !== existing.id)
        }));
    };

    return <ConfirmModal
        {...props}
        strTitle={existing ? "Edit Channel" : "Add Channel"}
        strOKButtonText="Save"
        onOK={save}
        onCancel={() => setGlobalState(state => ({
            ...state,
            visible: true
        }))}>
        <Field label="Name" bottomSeparator="none" childrenLayout="below">
            <TextField
                value={name}
                onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Address" bottomSeparator="none" childrenLayout="below">
            <TextField
                value={address}
                onChange={e => setAddress(e.target.value)} />
        </Field>
        <Field label="TV Guide URL (optional)" description="An XMLTV feed URL (e.g. from a home DVR server) to show what's currently playing on this channel." bottomSeparator="none" childrenLayout="below">
            <TextField
                value={epgUrl}
                onChange={e => setEpgUrl(e.target.value)} />
        </Field>
        {existing && (
            <ButtonItem layout="below" onClick={remove}>
                Delete Channel
            </ButtonItem>
        )}
    </ConfirmModal>;
}

export const BookmarkModalWithState = modalWithState(BookmarkModal);
