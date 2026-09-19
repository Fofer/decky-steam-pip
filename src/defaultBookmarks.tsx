import { Bookmark } from "./globalState";

// The out-of-the-box channel list. Kept in its own module (rather than
// inline in index.tsx) so it can also be imported by the "Restore
// Defaults" button in settings.tsx without a circular import, and so it
// stays the one place both the initial seed and the migration/restore
// logic pull from.
export const CURATED_BOOKMARKS: Bookmark[] = [
    { id: "youtube", name: "YouTube", url: "https://youtube.com" },
    { id: "plutotv", name: "Pluto TV", url: "https://pluto.tv" },
    { id: "twitch", name: "Twitch", url: "https://twitch.tv" },
    { id: "tubi", name: "Tubi", url: "https://tubitv.com" },
];
