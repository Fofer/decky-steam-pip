import {
    TextField,
    ConfirmModal,
    ModalRootProps,
    Field,
    ButtonItem,
    ToggleField,
} from "@decky/ui";
import { useEffect, useState } from "react";

import { modalWithState } from "./modal";
import { useGlobalState, Bookmark, withUrlChange } from "./globalState";

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
    // Optional override for channels where the guide identifies this
    // channel by a name with no text in common with the channel's own Name
    // above (e.g. a bookmark named after a network's brand, "FOX 11", when
    // the guide uses its real call letters, "KTTV") — the normal matching
    // already tolerates a channel number moving around or being missing,
    // so this is only needed for that no-shared-text case.
    const [epgChannelName, setEpgChannelName] = useState(existing?.epgChannelName ?? "");
    // Whether this is a live TV channel the Channel Guide could plausibly
    // know about — the two Channel Guide fields below only show once this
    // is on. [Confirmed by Josh, 2026-09-20] Defaults OFF for a new channel
    // now (reversed from defaulting on): most channels added here turn out
    // to be YouTube/streaming URLs, not live TV, so guessing "yes, try to
    // match this against the guide" by default was wrong more often than
    // right. Persisted inverted, as Bookmark.noGuide — that's the
    // historical field name every other file already checks (noGuide=true
    // meaning "don't try to guide-match this one"), so this flips the sense
    // only at the edges of this form (initial value and save()) rather than
    // renaming it everywhere.
    const [isLiveTvChannel, setIsLiveTvChannel] = useState(existing ? !existing.noGuide : false);

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
        const trimmedEpgChannelName = epgChannelName.trim() || undefined;
        const noGuide = !isLiveTvChannel;

        setGlobalState(state => {
            const bookmark: Bookmark = existing
                ? { ...existing, name: trimmedName, url: address, epgUrl: trimmedEpgUrl, epgChannelName: trimmedEpgChannelName, noGuide }
                : { id: `${Date.now()}`, name: trimmedName, url: address, epgUrl: trimmedEpgUrl, epgChannelName: trimmedEpgChannelName, noGuide };

            const bookmarks = existing
                ? state.bookmarks.map(b => b.id === existing.id ? bookmark : b)
                : [...state.bookmarks, bookmark];

            return {
                ...withUrlChange(state, address),
                visible: true,
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
        <Field label="Live TV Channel" description="Turn on if this is a live TV channel the Channel Guide could plausibly know about — reveals the two guide fields below. Leave off (the default) for YouTube, Twitch, or any other website/stream." bottomSeparator="none" childrenLayout="below">
            <ToggleField
                checked={isLiveTvChannel}
                onChange={setIsLiveTvChannel} />
        </Field>
        {isLiveTvChannel && <>
            <Field label="Channel Guide URL (optional)" description="An XMLTV feed URL to show what's currently playing on this channel. Leave blank to use the default Channel Guide URL set in the panel, if any." bottomSeparator="none" childrenLayout="below">
                <TextField
                    value={epgUrl}
                    onChange={e => setEpgUrl(e.target.value)} />
            </Field>
            <Field label="Guide Channel Name (optional)" description="Only needed if the guide calls this channel something with nothing in common with the Name above — e.g. its real call letters instead of a network brand name." bottomSeparator="none" childrenLayout="below">
                <TextField
                    value={epgChannelName}
                    onChange={e => setEpgChannelName(e.target.value)} />
            </Field>
        </>}
        {existing && (
            <ButtonItem layout="below" onClick={remove}>
                Delete Channel
            </ButtonItem>
        )}
    </ConfirmModal>;
}

export const BookmarkModalWithState = modalWithState(BookmarkModal);
