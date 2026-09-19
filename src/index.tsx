import merge from 'lodash/merge'
import { FaTv } from "react-icons/fa";
import { StateManager } from "cotton-box";
import { quickAccessMenuClasses } from "@decky/ui";
import { definePlugin, routerHook, } from "@decky/api";

import { PipOuter } from "./pip";
import { Settings } from "./settings";
import { Position, ViewMode } from "./util";
import { State, Bookmark, GlobalContext } from "./globalState";
import { CURATED_BOOKMARKS } from "./defaultBookmarks";
import { PERSONAL_BOOKMARKS } from "./personalBookmarks";

// PERSONAL_BOOKMARKS lives in a gitignored file (src/personalBookmarks.tsx)
// and is never meant to ship in the public repo — if that file is removed
// for a public build, delete this import and the seeding block below along
// with it.
const PERSONAL_SEEDED_KEY = 'pip-personal-seeded';

const DEFAULTS = {
    viewMode: ViewMode.Closed,
    visible: true,
    position: Position.TopRight,
    margin: 20,
    size: 0.80,
    url: CURATED_BOOKMARKS[0].url,
    volume: 100,
    muted: false,
    playPauseSeq: 0,
    seekBackSeq: 0,
    seekForwardSeq: 0,
    nowPlaying: null,
    showNowPlaying: true,
    hidden: false,
};

// Builds the initial state. Bookmarks are handled outside of lodash's
// merge() (which merges arrays element-by-element, not by appending).
// The curated preset list is only ever seeded in on a true first-ever run
// (no `bookmarks` key saved yet for this install) — a pre-existing custom
// URL from before bookmarks existed (e.g. a Channels DVR address) is folded
// in as its own bookmark at that same moment. On every later load, whatever
// bookmarks array is already persisted is used exactly as-is, with no
// re-injection of "missing" curated channels — otherwise a channel the user
// deliberately deleted would simply reappear on the next reboot. Bringing
// the curated set back after that point is only ever done explicitly, via
// the Restore Defaults button. The channel the user has actually selected
// (state.url) is carried forward as-is, so it remains the default going
// forward.
const buildInitialState = (): State => {
    const persisted = JSON.parse(localStorage.getItem('pip') ?? '{}') as Partial<State>;
    const { bookmarks: persistedBookmarks, url: persistedUrl, ...persistedRest } = persisted;

    const merged = merge({}, DEFAULTS, persistedRest) as State;

    let bookmarks: Bookmark[];
    if (persistedBookmarks === undefined) {
        bookmarks = CURATED_BOOKMARKS.map(b => ({ ...b }));
        if (persistedUrl && !bookmarks.some(b => b.url === persistedUrl)) {
            bookmarks.push({ id: `${Date.now()}`, name: "Custom", url: persistedUrl });
        }
    } else {
        bookmarks = persistedBookmarks;
    }

    // Seed Josh's personal channels in exactly once, ever, regardless of
    // whether this is a fresh install or an existing one — tracked with its
    // own marker so it's independent of the curated-list seeding above and
    // of the Restore Defaults flow. Once seeded, these behave like any
    // other bookmark: if he deletes one, it stays deleted on later loads,
    // same as the deletion-persistence fix for the curated list.
    if (!localStorage.getItem(PERSONAL_SEEDED_KEY)) {
        for (const preset of PERSONAL_BOOKMARKS) {
            if (!bookmarks.some(b => b.id === preset.id)) {
                bookmarks.push(preset);
            }
        }
        localStorage.setItem(PERSONAL_SEEDED_KEY, '1');
    }

    return {
        ...merged,
        bookmarks,
        url: persistedUrl ?? merged.url,
    };
};

export default definePlugin(() => {
    const state = new StateManager<State>(buildInitialState());

    state.watch(({ position, margin, size, url, bookmarks, volume, muted, showNowPlaying }) =>
        localStorage.setItem('pip', JSON.stringify({ position, margin, size, url, bookmarks, volume, muted, showNowPlaying })));

    routerHook.addGlobalComponent("PictureInPicture", () => {
        return <GlobalContext.Provider value={state}>
            <PipOuter />
        </GlobalContext.Provider>
    });

    return {
        name: "Steam PiP",
        titleView: <div className={quickAccessMenuClasses.Title}>Steam PiP</div>,
        icon: <FaTv />,
        content:
            <GlobalContext.Provider value={state}>
                <Settings />
            </GlobalContext.Provider>,
        onDismount() {
            routerHook.removeGlobalComponent("PictureInPicture");
        },
    };
});
