import { StateManager } from 'cotton-box';
import { useContext, createContext } from 'react';

import { Position, ViewMode } from './util';
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
    bookmarks: Bookmark[]
    // Playback volume for the picture's own audio (0-100) and whether it's
    // muted, applied inside the loaded page itself so it can be balanced
    // independently of game/Steam audio.
    volume: number
    muted: boolean
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
    // Collapses the picture down to a thin sliver docked to the right edge
    // of the screen instead of closing it — playback (audio/video) keeps
    // running, it's just shrunk out of the way. Not persisted, like
    // viewMode: always starts un-hidden.
    hidden: boolean
}

export const GlobalContext = createContext(new StateManager<State>({} as State));

export const useGlobalState = () => {
    const context = useContext(GlobalContext);
    const state = useStateValue(context);

    const setState = (setter: (state: State) => State) =>
        context.set(setter(context.get()))

    return [state, setState, context] as [State, (setter: (state: State) => State) => void, StateManager<State>];
};
