import { useEffect, useState } from "react";

import { Bookmark, NowPlaying } from "./globalState";
import { backendCall } from "./backendCall";

// Looks up what's currently airing on every bookmarked channel that has a
// guide URL (its own, or the shared default), so a list of channels can
// show what's on before picking one — not just for whichever channel is
// already loaded. Channels sharing one guide URL (the common case — one DVR
// for all of them) are looked up in a single batched call rather than one
// fetch per channel. Shared between settings.tsx (the QAM panel's own
// Channel row) and channelPickerModal.tsx (the "Choose a Channel" list) so
// both show the same data without either owning it — each caller runs its
// own poll for as long as it's mounted, same as this used to work when it
// lived only in settings.tsx.
export const useChannelNowPlaying = (bookmarks: Bookmark[], defaultEpgUrl: string, showNowPlaying: boolean): Record<string, NowPlaying | null> => {
    const [channelNowPlaying, setChannelNowPlaying] = useState<Record<string, NowPlaying | null>>({});

    useEffect(() => {
        if (!showNowPlaying) {
            setChannelNowPlaying({});
            return;
        }

        let cancelled = false;

        const poll = async () => {
            const groups = new Map<string, Bookmark[]>();
            for (const b of bookmarks) {
                // A bookmark that isn't really a live channel (YouTube, a
                // website, etc.) opts out of the default guide URL
                // fallback entirely — see Bookmark.noGuide's own comment.
                if (b.noGuide) continue;
                const epg = b.epgUrl || defaultEpgUrl;
                if (!epg) continue;
                if (!groups.has(epg)) groups.set(epg, []);
                groups.get(epg)!.push(b);
            }
            if (groups.size === 0) {
                if (!cancelled) setChannelNowPlaying({});
                return;
            }

            const updates: Record<string, NowPlaying | null> = {};
            for (const [epgUrl, group] of groups) {
                try {
                    const names = group.map(b => b.epgChannelName || b.name);
                    const result = await backendCall<[string, string[]], Record<string, NowPlaying | null>>(
                        "get_now_playing_batch", epgUrl, names);
                    group.forEach((b, i) => { updates[b.id] = result?.[names[i]] ?? null; });
                } catch (e) {
                    console.error("SteamPiP: batch now-playing lookup failed", e);
                }
            }
            if (!cancelled) setChannelNowPlaying(updates);
        };

        poll();
        const interval = setInterval(poll, 60000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [bookmarks, defaultEpgUrl, showNowPlaying]);

    return channelNowPlaying;
};
