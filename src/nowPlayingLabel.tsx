import { NowPlaying } from "./globalState";

// Turns the currently-loaded channel's guide data into the same "title" or
// "title: subtitle" text already shown in a couple of places (settings.tsx's
// Channel row, channelPickerModal.tsx's list) — shared here so
// take_screenshot's show_title argument (settings.tsx, controlBar.tsx) uses
// that exact same text rather than its own slightly different formatting.
// Empty for a channel with no guide data (nowPlaying is null) or one whose
// guide entry came back with no title at all.
export const nowPlayingLabel = (nowPlaying: NowPlaying | null): string => {
    if (!nowPlaying?.title) return '';
    return nowPlaying.subtitle ? `${nowPlaying.title}: ${nowPlaying.subtitle}` : nowPlaying.title;
};
