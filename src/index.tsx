import merge from 'lodash/merge'
import { FaTv } from "react-icons/fa";
import { StateManager } from "cotton-box";
import { definePlugin, routerHook, } from "@decky/api";

import { PipOuter } from "./pip";
import { Settings, TitleBar } from "./settings";
import { Position, ViewMode, DEFAULT_VIEW_ORDER, DEFAULT_CONTROL_ORDER, reconcileOrder } from "./util";
import { State, Bookmark, GlobalContext } from "./globalState";
import { CURATED_BOOKMARKS } from "./defaultBookmarks";
import { PERSONAL_BOOKMARKS, PERSONAL_DEFAULT_EPG_URL } from "./personalBookmarks";
import { isLikelySteamDeck } from "./screen";

// PERSONAL_BOOKMARKS/PERSONAL_DEFAULT_EPG_URL live in src/personalBookmarks.tsx,
// which is checked in as an empty public template (see that file) so a plain
// clone always builds. A local build with real personal data edits that file
// in place and marks it `git update-index --skip-worktree` so those edits
// never show up in `git status` or get committed/pushed by accident.
const PERSONAL_SEEDED_KEY = 'pip-personal-seeded';

const DEFAULTS = {
    viewMode: ViewMode.Closed,
    visible: true,
    position: Position.TopRight,
    margin: 20,
    size: 0.80,
    url: CURATED_BOOKMARKS[0].url,
    previousUrl: '',
    volume: 100,
    muted: false,
    opacity: 100,
    playPauseSeq: 0,
    seekBackSeq: 0,
    seekForwardSeq: 0,
    seekBack30Seq: 0,
    seekForward30Seq: 0,
    screenshotFlashSeq: 0,
    lastScreenshotResult: '',
    playing: true,
    nowPlaying: null,
    showNowPlaying: true,
    defaultEpgUrl: PERSONAL_DEFAULT_EPG_URL,
    // On by default on a Steam Deck (has a touchscreen, so there's always
    // something to tap it with), off by default anywhere else (a Steam
    // Machine on a TV is normally controller-only, with no cursor to click
    // it) — see the field's own comment in globalState.tsx. Either way it's
    // just this run's starting point; the toggle in the panel changes it
    // from then on.
    controlBarEnabled: isLikelySteamDeck(),
    controlBarAlwaysVisible: false,
    appearanceCollapsed: false,
    hidden: false,
    audioIndicatorEnabled: true,
    screenshotEnabled: false,
    screenshotSaveDir: '',
    overlayConnected: true,
    overlayShowMaximize: true,
    overlayShowPosition: true,
    overlayShowScreenshot: true,
    overlayShowHide: true,
    overlayShowSwap: true,
    overlayShowClose: true,
    overlayShowSeekBack: true,
    overlayShowPlayPause: true,
    overlayShowSeekForward: true,
    overlayShowVolume: true,
    overlayShowSeekBack30: true,
    overlayShowSeekForward30: true,
    overlayShowMove: true,
    qamShowSeekBack30: true,
    qamShowSeekBack: true,
    qamShowSeekForward: true,
    qamShowSeekForward30: true,
    qamShowPlayPause: true,
    qamShowVolume: true,
    qamUseColor: false,
    // Hex equivalents of the fixed defaults these replace when qamUseColor
    // is turned on (settings.tsx's QAM_PLAY_BG/QAM_PAUSE_BG and TitleBar's
    // Close background) — so switching the toggle on for the first time
    // starts from the same look already in use, not some new arbitrary
    // color.
    qamPlayColor: '#78c878',
    qamPauseColor: '#6ea5dc',
    qamCloseColor: '#dc3c3c',
    viewOrder: DEFAULT_VIEW_ORDER,
    controlOrder: DEFAULT_CONTROL_ORDER,
    customPosX: 0.5,
    customPosY: 0.5,
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
    // [Confirmed by Josh, 2026-09-20] Overrides whatever the plain merge()
    // above did to these two arrays specifically — see reconcileOrder's own
    // comment (util.tsx) for why a brand new order-array item needs this
    // rather than trusting merge()'s by-index array behavior to place it
    // safely.
    merged.viewOrder = reconcileOrder(persistedRest.viewOrder, DEFAULT_VIEW_ORDER);
    merged.controlOrder = reconcileOrder(persistedRest.controlOrder, DEFAULT_CONTROL_ORDER);

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

    state.watch(({ position, margin, size, url, previousUrl, bookmarks, volume, muted, opacity, showNowPlaying, defaultEpgUrl, controlBarEnabled, controlBarAlwaysVisible, appearanceCollapsed, audioIndicatorEnabled, screenshotEnabled, screenshotSaveDir, overlayConnected, overlayShowMaximize, overlayShowPosition, overlayShowScreenshot, overlayShowHide, overlayShowSwap, overlayShowClose, overlayShowSeekBack, overlayShowPlayPause, overlayShowSeekForward, overlayShowVolume, overlayShowSeekBack30, overlayShowSeekForward30, overlayShowMove, qamShowSeekBack30, qamShowSeekBack, qamShowSeekForward, qamShowSeekForward30, qamShowPlayPause, qamShowVolume, qamUseColor, qamPlayColor, qamPauseColor, qamCloseColor, viewOrder, controlOrder, customPosX, customPosY }) =>
        localStorage.setItem('pip', JSON.stringify({ position, margin, size, url, previousUrl, bookmarks, volume, muted, opacity, showNowPlaying, defaultEpgUrl, controlBarEnabled, controlBarAlwaysVisible, appearanceCollapsed, audioIndicatorEnabled, screenshotEnabled, screenshotSaveDir, overlayConnected, overlayShowMaximize, overlayShowPosition, overlayShowScreenshot, overlayShowHide, overlayShowSwap, overlayShowClose, overlayShowSeekBack, overlayShowPlayPause, overlayShowSeekForward, overlayShowVolume, overlayShowSeekBack30, overlayShowSeekForward30, overlayShowMove, qamShowSeekBack30, qamShowSeekBack, qamShowSeekForward, qamShowSeekForward30, qamShowPlayPause, qamShowVolume, qamUseColor, qamPlayColor, qamPauseColor, qamCloseColor, viewOrder, controlOrder, customPosX, customPosY })));

    routerHook.addGlobalComponent("PictureInPicture", () => {
        return <GlobalContext.Provider value={state}>
            <PipOuter />
        </GlobalContext.Provider>
    });

    return {
        name: "Steam PiP",
        // TitleBar (settings.tsx) adds Close and Manage Channels as small
        // icon buttons at the top-right corner of the title row, matching
        // Decky's own CSS Loader plugin's layout — needs the same
        // GlobalContext as the rest of the panel, since both buttons act on
        // shared state.
        titleView: <GlobalContext.Provider value={state}><TitleBar /></GlobalContext.Provider>,
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
