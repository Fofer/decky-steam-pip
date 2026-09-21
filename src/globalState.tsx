import { StateManager } from 'cotton-box';
import { useContext, createContext } from 'react';

import { Position, ViewMode, ViewItemKey, ControlItemKey } from './util';
import { useStateValue } from 'cotton-box-react';

export interface Bookmark {
    id: string
    name: string
    url: string
    // For a live-TV channel that has an XMLTV programming guide (e.g. a
    // Channels DVR server), the guide's URL — used to look up and display
    // what's currently playing on this channel. Undefined for anything
    // else (YouTube, Twitch, a plain custom URL, etc.), which simply never
    // shows now-playing info.
    epgUrl?: string
    // Overrides `name` as the channel name looked up in the guide, for
    // channels where the two have no text in common at all — e.g. a
    // bookmark named after a network's on-air brand ("FOX 11") when the
    // guide identifies the channel by its real call letters ("KTTV")
    // instead. The matching itself already tolerates a channel number
    // moving around or being absent (main.py's _names_match), so this is
    // only needed for that no-shared-text case.
    epgChannelName?: string
    // For a bookmark that isn't really a live-TV channel at all (YouTube, a
    // Twitch stream, a plain website) — opts it out of guide lookups
    // entirely, even though it has no epgUrl of its own. Without this, a
    // blank epgUrl still falls back to the shared default Channel Guide URL
    // (see State.defaultEpgUrl) the same as any real channel would, so a
    // non-TV bookmark could still get matched — loosely, by name — against
    // some unrelated live channel in that guide and show its schedule,
    // which makes no sense for something that was never a channel to begin
    // with. Undefined/false (the default) behaves exactly as before.
    noGuide?: boolean
    // Lets a saved channel be tucked away without deleting it — e.g. a
    // channel you're not currently watching but don't want to lose the
    // saved URL/guide settings for. Undefined/false (the common case) shows
    // normally everywhere; true removes it from the channel picker and the
    // Previous/Next Channel surf order, while it stays fully editable from
    // Manage Channels.
    hidden?: boolean
}

export interface NowPlaying {
    title: string
    subtitle: string
}

export interface State {
    viewMode: ViewMode,
    position: Position
    visible: boolean
    margin: number
    size: number
    url: string
    // The URL that was loaded immediately before the current one — lets a
    // single "swap" action jump back to whatever was on before, the way a
    // TV remote's last-channel button works. Set automatically whenever
    // `url` actually changes (see withUrlChange below); never set directly.
    // Persisted so a quick swap still works right after restarting.
    previousUrl: string
    bookmarks: Bookmark[]
    // Playback volume for the picture's own audio (0-100) and whether it's
    // muted, applied inside the loaded page itself so it can be balanced
    // independently of game/Steam audio.
    volume: number
    muted: boolean
    // Fades the picture's own content toward its background as this drops
    // from 100 (see opacityJs in pip.tsx for exactly what this does and
    // doesn't do). Persisted, like volume/muted.
    opacity: number
    // Incremented each time the QAM's Play/Pause button is pressed. There's
    // no channel back out of the loaded page to report whether it's
    // actually playing, so this is a one-way "do it" signal — the picture
    // reacts by toggling whatever its own player's real state currently is.
    // Not persisted; always starts at 0.
    playPauseSeq: number
    // Same fire-once-counter pattern as playPauseSeq, for the QAM's jump
    // back/ahead 10 seconds buttons. Two separate counters (rather than one
    // counter plus a signed delta) so each button press is its own
    // independent, unambiguous "do it" signal. Not persisted; always start
    // at 0.
    seekBackSeq: number
    seekForwardSeq: number
    // Same fire-once-counter pattern, for the 30-second jump back/ahead
    // buttons added alongside the original 10-second ones — [Confirmed by
    // Josh, 2026-09-20] a bigger jump some people want available too, not a
    // replacement for the 10-second ones. Not persisted; always start at 0.
    seekBack30Seq: number
    seekForward30Seq: number
    // Bumped the instant a screenshot is triggered — before waiting on the
    // backend's own success/failure — so the on-screen flash + shutter
    // sound (screenshotFlash.tsx) can fire right away, like a real camera's
    // shutter firing before the photo is known to have come out. Same
    // fire-once-counter pattern as the other *Seq fields here. Not
    // persisted; always starts at 0.
    screenshotFlashSeq: number
    // Whether the QAM's Play/Pause icon should currently show "playing" (a
    // pause icon, ready to pause) or "paused" (a play icon, ready to
    // resume). This is an OPTIMISTIC guess, not a true readback — the loaded
    // page has no channel to report its actual play/pause state back to the
    // extension (see togglePlayPauseJs in pip.tsx), so this just flips each
    // time the button is pressed and assumes that matches what happened.
    // It'll drift out of sync if the page's own controls are used instead,
    // or if a new channel doesn't autoplay. Not persisted — always starts
    // true (assumed playing) each time the panel loads.
    playing: boolean
    // What's currently airing on the loaded channel, per its EPG (see
    // Bookmark.epgUrl) — null when the current channel has no guide, or a
    // lookup hasn't found a match yet. Not persisted; always starts null,
    // and is only ever written by the picture's own polling.
    nowPlaying: NowPlaying | null
    // User preference for whether now-playing guide data shows at all, in
    // either place (the QAM line or the picture's overlay). Persisted, like
    // volume/muted — this is a "how do you want the plugin to behave"
    // setting, not per-session UI state.
    showNowPlaying: boolean
    // A single XMLTV guide URL applied to every channel that doesn't have
    // its own Bookmark.epgUrl override. Most people only have one guide
    // source (one DVR server), so this lets them set it once instead of
    // pasting the same URL into every channel. Persisted, empty string
    // means "not set".
    defaultEpgUrl: string
    // Whether the floating on-screen control bar (controlBar.tsx) and the
    // more-visible "minimized" restore badge (minimizedIndicator.tsx) show
    // at all. Both are plain mouse/trackpad-clickable elements, not part of
    // Decky's own D-pad-navigable UI — genuinely useful on a touchscreen or
    // with a trackpad cursor (Steam Deck), much less so on a controller-only
    // setup (a Steam Machine driving a TV) where there's no cursor to click
    // them with in the first place. Defaults based on which of those this
    // looks like at first run (see index.tsx), but is a plain persisted
    // preference from then on — this plugin has no reliable way to detect
    // "a cursor is currently active" moment to moment, so it can't show or
    // hide itself automatically; this toggle is the next best thing.
    controlBarEnabled: boolean
    // Skips the on-screen control bar's auto-hide-after-a-few-seconds
    // behavior entirely and leaves every button visible all the time —
    // for someone who'd rather always see the full set of commands than
    // have them collapse to a thin edge tab between taps.
    controlBarAlwaysVisible: boolean
    // Whether the Appearance section (Position/Size/Margin/Brightness) is
    // folded away. A plain persisted preference, same reasoning as
    // controlBarEnabled above — once someone's placed their picture, they
    // said this stays collapsed across restarts rather than reopening every
    // time the panel is reloaded.
    appearanceCollapsed: boolean
    // Collapses the picture down entirely off-screen instead of closing it —
    // playback (audio/video) keeps running, it's just moved out of the way;
    // minimizedIndicator.tsx's own floating badge is the only visible trace
    // while this is on. Not persisted, like viewMode: always starts
    // un-hidden.
    hidden: boolean
    // Whether the hidden-picture badge also shows a small animated "audio is
    // playing" indicator (three pulsing bars) when the picture isn't muted —
    // a way to tell at a glance that a hidden picture is still making sound,
    // without needing to un-hide it to check. Persisted, like controlBarEnabled.
    audioIndicatorEnabled: boolean
    // Whether the screenshot feature is turned on at all. Off by default —
    // [Confirmed by Josh, 2026-09-20] someone who never takes a screenshot
    // shouldn't have its icon permanently taking up space in the channel
    // row or the on-screen control bar, so every place that icon could show
    // up checks this first and renders nothing at all when it's off, rather
    // than just disabling the button. Configured from its own settings
    // modal (screenshotSettingsModal.tsx), reached from the bottom of
    // Manage Channels.
    screenshotEnabled: boolean
    // Where take_screenshot saves its output. Empty string (the default)
    // means "figure it out automatically" — main.py's own best-effort guess
    // at whichever game/app's Steam screenshot folder is currently active
    // (see _resolve_screenshot_dir). Set to a real path to always save
    // there instead, e.g. for someone who wants their PiP screenshots kept
    // separate from their game screenshots.
    screenshotSaveDir: string
    // The full path take_screenshot last reported saving to (or an error
    // string), so it's readable at leisure in Screenshot Settings instead of
    // only flashing by in a toast — [Confirmed by Josh, 2026-09-20] a long
    // absolute path in a toast gets visually cut off before it can be read.
    // Not persisted; starts blank each session, like the other *Seq fields.
    lastScreenshotResult: string
    // Whether the on-screen overlay's two segments (the side bar and the
    // transport bar) render as one continuous L-shaped border (true, the
    // current look — zero gap, squared-off shared corner) or as two fully
    // separate rounded pills with a visible gap between them, the original
    // pre-L-shape look. [Confirmed by Josh, 2026-09-20] the connected look
    // uses up more of the screen along that whole edge, which isn't
    // necessarily wanted, so this is a user choice rather than fixed —
    // configured from overlaySettingsModal.tsx.
    overlayConnected: boolean
    // Per-control visibility toggles for the on-screen overlay — letting
    // someone hide individual buttons they never use (e.g. just Play/Pause
    // and Skip back/forward, nothing else) rather than all-or-nothing.
    // [Confirmed by Josh, 2026-09-20] All default to true (today's full set,
    // unchanged for anyone who doesn't open this settings pane). Screenshot
    // additionally still requires screenshotEnabled — this only controls
    // whether it shows up WHEN that feature's on, same relationship
    // controlBar.tsx already had between the two.
    overlayShowMaximize: boolean
    overlayShowPosition: boolean
    overlayShowScreenshot: boolean
    overlayShowHide: boolean
    overlayShowSwap: boolean
    overlayShowClose: boolean
    overlayShowSeekBack: boolean
    overlayShowPlayPause: boolean
    overlayShowSeekForward: boolean
    overlayShowVolume: boolean
    // Same idea as overlayShowSeekBack/overlayShowSeekForward, for the
    // 30-second jump buttons added alongside them. [Confirmed by Josh,
    // 2026-09-20] default true, like every other overlayShow* toggle here —
    // requested specifically to actually use right away, not an opt-in
    // extra.
    overlayShowSeekBack30: boolean
    overlayShowSeekForward30: boolean
    // Whether the freeform "drag to move anywhere" handle shows in the
    // on-screen overlay's side bar — same overlayShow*/View-column pattern
    // as every other side-bar control. [Confirmed by Josh, 2026-09-20]
    // Only meaningful in Picture mode (there's no floating picture to drag
    // around in Expand mode, same reasoning as overlayShowPosition there).
    overlayShowMove: boolean
    // Per-button visibility toggles for the QAM panel's own Playback row
    // (settings.tsx) — [Confirmed by Josh, 2026-09-20] separate from the
    // overlayShow* toggles above, which only govern the on-screen overlay.
    // Play/Pause itself has no toggle here and always shows — it's the one
    // button that's never optional in either place. All four default to
    // true (today's full 5-button row, unchanged for anyone who doesn't
    // open Display Settings). Configured from the new "QAM Layout" section
    // at the top of that same modal (overlaySettingsModal.tsx, renamed from
    // "On-Screen Overlay Settings" to "Display Settings" now that it covers
    // both surfaces).
    qamShowSeekBack30: boolean
    qamShowSeekBack: boolean
    qamShowSeekForward: boolean
    qamShowSeekForward30: boolean
    // Whether the QAM's own Play/Pause button (settings.tsx) and its title
    // bar's Close button show any background color at all. Off by default —
    // both are plain, untinted icon buttons then, same as every other icon
    // button in the panel. On applies the user's own picked colors below
    // (seeded from green Play / blue Pause / red Close, this fork's
    // original fixed look, so turning it on doesn't change anything until a
    // color is actually picked). Configured from QAM Layout
    // (overlaySettingsModal.tsx).
    qamUseColor: boolean
    // User-picked colors for the above, as "#rrggbb" hex strings (the only
    // format a native <input type="color"> works with) — converted to an
    // rgba() background via util.tsx's hexToRgba at whatever alpha that
    // button already used. Only actually applied when qamUseColor is true;
    // otherwise these are just whatever was last picked (or the default
    // below, before ever touching this) and ignored.
    qamPlayColor: string
    qamPauseColor: string
    qamCloseColor: string
    // The user's own drag-to-reorder arrangement of the on-screen overlay's
    // two columns (overlaySettingsModal.tsx's grab handles) — drives both
    // that modal's own row order and the actual on-screen render order in
    // controlBar.tsx (connected bar, Separate pills, and the Expand-mode
    // dock all read from these same two arrays). Persisted, like the
    // overlayShow* toggles above. [Confirmed by Josh, 2026-09-20] Two
    // separate arrays, never merged — View items and Control items never
    // mix, since they render in two physically different bars.
    viewOrder: ViewItemKey[]
    controlOrder: ControlItemKey[]
    // The picture's own saved location when position === Position.Custom,
    // as fractions (0-1) of the available on-screen area the picture is
    // free to occupy — not raw pixels, so it stays correct across
    // different screen resolutions (Deck vs. a Steam Machine's TV) the same
    // way the existing 8 presets already do. Set by dragging the picture's
    // own grab handle (pipBounds.tsx's Position.Custom branch); meaningless
    // while position is one of the 8 presets, but always persisted so a
    // custom spot isn't lost by switching to a preset and back.
    customPosX: number
    customPosY: number
}

// The one place `url` should ever be changed from — every channel-selection
// call site (channel surf, the picker, saving a bookmark you're currently
// on) routes through this so `previousUrl` reliably tracks whatever was
// loaded right before, for the quick-swap action in settings.tsx/
// controlBar.tsx. A no-op when the "new" URL is the same as the current one
// (re-saving the same bookmark, say) so that doesn't overwrite a
// genuinely-different previousUrl with a no-change.
export const withUrlChange = (state: State, newUrl: string): State =>
    newUrl === state.url ? state : { ...state, previousUrl: state.url, url: newUrl };

export const GlobalContext = createContext(new StateManager<State>({} as State));

export const useGlobalState = () => {
    const context = useContext(GlobalContext);
    const state = useStateValue(context);

    const setState = (setter: (state: State) => State) =>
        context.set(setter(context.get()))

    return [state, setState, context] as [State, (setter: (state: State) => State) => void, StateManager<State>];
};
