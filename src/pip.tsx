import {
    Router,
    WindowRouter,
} from "@decky/ui";
import { call } from "@decky/api";
import { useEffect, useRef, useState } from "react";

import { NowPlaying, useGlobalState } from "./globalState";
import { usePipBounds } from "./pipBounds";
import { UIComposition, useUIComposition } from "./useUIComposition";
import { ViewMode } from "./util";

interface BrowserProps {
    url: string
    visible: boolean
    // Playback volume (0-100) and mute for the picture's own audio, applied
    // by running JS inside the loaded page itself — there's no volume/mute
    // control on the browser view object, only on whatever <video>/<audio>
    // elements the page happens to render.
    volume: number
    muted: boolean
    // Bumped each time Play/Pause is pressed in the QAM — see State's
    // playPauseSeq for why this is a fire-once counter rather than a
    // boolean.
    playPauseSeq: number
    // Bumped each time the QAM's jump-back/jump-ahead 10s buttons are
    // pressed — same fire-once-counter pattern as playPauseSeq.
    seekBackSeq: number
    seekForwardSeq: number
    // For a channel with an XMLTV guide (Bookmark.epgUrl) and its display
    // name, used to poll the backend for what's currently airing; undefined
    // for a channel with no guide, which simply never polls.
    epgUrl?: string
    channelName?: string
    showNowPlaying: boolean
    onNowPlaying: (nowPlaying: NowPlaying | null) => void
    x: number
    y: number
    width: number
    height: number
}

// Finds and caches the page's playing media element, piercing shadow roots
// (many streaming sites hide their player behind custom elements). Re-scans
// if the cached element has been removed from the page (e.g. a channel
// change inside the same site).
const preludeJs = `
window.__pipMedia = window.__pipMedia || function () {
    var cached = window.__pipMediaEl;
    if (cached && cached.isConnected) { return cached; }
    var found = null;
    var scan = function (root) {
        if (found) { return; }
        var els = root.querySelectorAll('video, audio');
        if (els.length) { found = els[0]; return; }
        var all = root.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            if (all[i].shadowRoot) { scan(all[i].shadowRoot); if (found) { return; } }
        }
    };
    try { scan(document); } catch (e) { }
    window.__pipMediaEl = found;
    return found;
};
`;

// Applies volume/mute now, and arms a self-contained watcher (running
// inside the page, so it keeps working even if our own effects don't fire
// again) that keeps re-applying it to whatever media element currently
// exists — covers players that swap out their <video> element on channel
// change or ad breaks.
//
// This picture is meant to run as quiet background/second-screen audio
// alongside a game, not as the main thing being listened to — so instead of
// scaling the slider up to a full 0-100% of the real player's volume, the
// real volume is capped well below that (VOLUME_CEILING), and the slider's
// 0-100 position is applied against that capped range. [Estimated/tunable]
// A cubic taper was tried first to make the low end quieter, but it
// over-corrected — it suppressed the low end so much that nothing was
// audible until ~20% on the slider. A plain scaled-down linear mapping
// instead keeps the low end proportionally audible (5-7% is now genuinely
// quiet rather than silent or too loud) while every step still raises
// volume gradually, up to the ceiling at 100%. If 5-7% still isn't quite
// right once tested, VOLUME_CEILING is the one number to nudge.
const VOLUME_CEILING = 0.55;

const volumeJs = (volume: number, muted: boolean) => {
    const linear = Math.max(0, Math.min(100, volume)) / 100;
    const eased = linear * VOLUME_CEILING;
    return `
window.__pipVolume = ${eased};
window.__pipMuted = ${!!muted};
window.__pipApplyVolume = window.__pipApplyVolume || function () {
    var m = window.__pipMedia();
    if (m) {
        m.volume = window.__pipVolume;
        m.muted = window.__pipMuted;
    }
};
window.__pipApplyVolume();
if (!window.__pipVolumeWatcher) {
    window.__pipVolumeWatcher = setInterval(window.__pipApplyVolume, 1000);
}
`;
};

// Toggles play/pause on whatever media element is currently found. There's
// no way to read the page's playback state back out into our own React
// state (a `javascript:` URL is fire-and-forget), so this always asks the
// page for its own current .paused value and flips it — correct regardless
// of what our side thinks is happening.
const togglePlayPauseJs = `
var m = window.__pipMedia && window.__pipMedia();
if (m) { m.paused ? m.play() : m.pause(); }
`;

// Jumps the current media element's playback position by a fixed number of
// seconds (negative to jump back). Clamped to [0, duration] when duration
// is a finite number (on-demand video); for a live stream, duration is
// typically Infinity, so only the lower bound applies — seeking within a
// live stream depends entirely on how much backward buffer the stream
// itself exposes, which this has no way to know or control.
const seekJs = (deltaSeconds: number) => `
var m = window.__pipMedia && window.__pipMedia();
if (m) {
    var target = m.currentTime + (${deltaSeconds});
    target = isFinite(m.duration) ? Math.max(0, Math.min(m.duration, target)) : Math.max(0, target);
    m.currentTime = target;
}
`;

// Pushes a fresh now-playing title/subtitle into the wrapper page built by
// buildHlsPageUrl below, which is the only page this plugin renders itself
// (so the only one that can be relied on to have the overlay elements this
// expects). Re-showing on every call, even for the same title, is harmless
// — the picture only calls this when a poll actually returns something, so
// a channel with no schedule data simply never triggers it.
const nowPlayingJs = (nowPlaying: NowPlaying | null) => `
if (window.__pipSetNowPlaying) {
    window.__pipSetNowPlaying(${JSON.stringify(nowPlaying?.title ?? '')}, ${JSON.stringify(nowPlaying?.subtitle ?? '')});
}
`;

// A raw .m3u8 URL (an HLS playlist, not a webpage) can't just be navigated
// to directly. [Inference] Safari plays it because WebKit has native HLS
// support built into its media engine and treats a top-level navigation to
// one as a video to play; Chromium — which is what Steam's embedded browser
// view is built on — has no such native support on desktop, so navigating
// to the raw playlist hits its generic "I don't know how to render this
// content-type" handling, which is what's producing the Open/Save dialog.
// The fix used by browser-based HLS players on Chromium (Twitch, YouTube
// Live, etc.) is the same one applied here: load a tiny wrapper page with a
// real <video> element, and decode the HLS stream in JS via hls.js
// (attached to the video element through the Media Source Extensions API)
// rather than asking the browser to natively understand the .m3u8 file.
const isHlsUrl = (url: string) => /\.m3u8(\?|#|$)/i.test(url);

const buildHlsPageUrl = (streamUrl: string) => {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#000;overflow:hidden">
<video id="pip-video" autoplay playsinline style="width:100vw;height:100vh;object-fit:contain;background:#000"></video>
<div id="now-playing" style="position:absolute;left:16px;right:16px;bottom:16px;padding:8px 14px;background:rgba(0,0,0,0.65);border-radius:8px;color:#fff;font-family:sans-serif;opacity:0;transition:opacity 0.5s;pointer-events:none">
<div id="np-title" style="font-weight:bold;font-size:15px"></div>
<div id="np-subtitle" style="font-size:12px;opacity:0.85;margin-top:2px"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js"></script>
<script>
(function () {
    var video = document.getElementById('pip-video');
    var src = ${JSON.stringify(streamUrl)};
    function play() { video.play().catch(function () {}); }
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        video.addEventListener('loadedmetadata', play);
    } else if (window.Hls && Hls.isSupported()) {
        var hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, play);
    } else {
        document.body.innerHTML = '<div style="color:#fff;font-family:sans-serif;padding:20px">This browser can\\'t play this stream.</div>';
    }

    // Briefly surfaces the current program's title/subtitle over the
    // picture whenever new now-playing data comes in (a channel change, or
    // the program itself changing), then fades it back out — a glanceable
    // "what am I watching" rather than a permanent overlay sitting on top
    // of the video the whole time.
    window.__pipSetNowPlaying = function (title, subtitle) {
        var el = document.getElementById('now-playing');
        var titleEl = document.getElementById('np-title');
        var subEl = document.getElementById('np-subtitle');
        if (!el || !titleEl || !subEl) { return; }
        if (!title) { el.style.opacity = '0'; window.__pipNowPlayingTitle = ''; return; }
        titleEl.textContent = title;
        subEl.textContent = subtitle || '';
        if (window.__pipNowPlayingTitle !== title) {
            el.style.opacity = '1';
            clearTimeout(window.__pipNowPlayingTimer);
            window.__pipNowPlayingTimer = setTimeout(function () { el.style.opacity = '0'; }, 8000);
        }
        window.__pipNowPlayingTitle = title;
    };
})();
</script>
</body></html>`;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
};

const NOW_PLAYING_POLL_MS = 60000;

const Browser = ({ url, visible, volume, muted, playPauseSeq, seekBackSeq, seekForwardSeq, epgUrl, channelName, showNowPlaying, onNowPlaying, x, y, width, height }: BrowserProps) => {
    useUIComposition(UIComposition.Notification);

    const [{ browser, view }] = useState<{ browser: any, view: any }>(() => {
        const root: WindowRouter & any = Router.WindowStore?.GamepadUIMainWindowInstance;
        const view = root.CreateBrowserView("pip");
        const browser = view.GetBrowser();

        window['pip' as any] = view;

        return {
            view,
            browser
        }
    });

    // Runs JS inside the loaded page via a `javascript:` URL (rather than
    // navigating away from it) — the same technique the browser view
    // already uses for normal page loads, just with a script body instead
    // of a real address. Newlines are collapsed since the URL can't carry
    // them.
    const injectJs = (body: string) => {
        try {
            browser.LoadURL('javascript:void(function(){' + body.replace(/\s*\r?\n\s*/g, ' ').trim() + '}())');
        } catch (e) { /* ignore */ }
    };

    const volumeRef = useRef(volume);
    volumeRef.current = volume;
    const mutedRef = useRef(muted);
    mutedRef.current = muted;

    useEffect(() => {
        injectJs(preludeJs + volumeJs(volume, muted));
    }, [volume, muted]);

    // Skip the very first run (playPauseSeq starts at 0 on mount) so
    // opening the picture doesn't immediately pause whatever was playing.
    const playPauseMounted = useRef(false);
    useEffect(() => {
        if (!playPauseMounted.current) {
            playPauseMounted.current = true;
            return;
        }
        injectJs(preludeJs + togglePlayPauseJs);
    }, [playPauseSeq]);

    // Same first-run skip as Play/Pause above, so mounting the picture
    // doesn't itself seek anything.
    const seekBackMounted = useRef(false);
    useEffect(() => {
        if (!seekBackMounted.current) {
            seekBackMounted.current = true;
            return;
        }
        injectJs(preludeJs + seekJs(-10));
    }, [seekBackSeq]);

    const seekForwardMounted = useRef(false);
    useEffect(() => {
        if (!seekForwardMounted.current) {
            seekForwardMounted.current = true;
            return;
        }
        injectJs(preludeJs + seekJs(10));
    }, [seekForwardSeq]);

    useEffect(() => {
        browser.SetVisible(visible);
    }, [visible]);

    useEffect(() => {
        view.LoadURL(isHlsUrl(url) ? buildHlsPageUrl(url) : url);

        // The player's own <video> element usually doesn't exist yet the
        // instant the page starts loading, so keep reapplying for a while
        // after navigation until the in-page watcher above is armed.
        const poll = setInterval(
            () => injectJs(preludeJs + volumeJs(volumeRef.current, mutedRef.current)),
            700);
        const stop = setTimeout(() => clearInterval(poll), 20000);
        return () => { clearInterval(poll); clearTimeout(stop); };
    }, [url]);

    // Polls the backend for what's currently airing on the loaded channel,
    // if it has an EPG at all — a plain website (YouTube, Twitch, a custom
    // URL) has no epgUrl and this simply never runs for it. Runs once
    // immediately on every channel change (so switching channels doesn't
    // sit on stale info from the last one) and then on a fixed interval,
    // since program info only needs to be roughly current, not real-time.
    // Gated on the user's own "show guide data" preference — off means no
    // polling at all (not just hiding the result), so it also stops making
    // requests to the user's DVR server when they've turned it off.
    useEffect(() => {
        onNowPlaying(null);

        if (!epgUrl || !channelName || !showNowPlaying) {
            injectJs(nowPlayingJs(null));
            return;
        }

        let cancelled = false;
        const poll = async () => {
            let result: NowPlaying | null = null;
            try {
                result = await call<[string, string], NowPlaying | null>("get_now_playing", epgUrl, channelName);
            } catch (e) { /* ignore — backend/server hiccup, try again next poll */ }
            if (cancelled) return;
            onNowPlaying(result);
            injectJs(nowPlayingJs(result));
        };

        poll();
        const interval = setInterval(poll, NOW_PLAYING_POLL_MS);
        return () => { cancelled = true; clearInterval(interval); };
    }, [url, epgUrl, channelName, showNowPlaying]);

    useEffect(() => {
        browser.SetBounds(x, y, width, height);
    }, [x, y, width, height]);

    useEffect(() => {
        return () => view.Destroy();
    }, []);

    return null;
}

export const Pip = () => {
    const bounds = usePipBounds();
    const [{ url, visible, volume, muted, playPauseSeq, seekBackSeq, seekForwardSeq, bookmarks, showNowPlaying }, setGlobalState] = useGlobalState();
    const currentBookmark = bookmarks.find(b => b.url === url);

    return <Browser
        url={url}
        visible={visible}
        volume={volume}
        muted={muted}
        playPauseSeq={playPauseSeq}
        seekBackSeq={seekBackSeq}
        seekForwardSeq={seekForwardSeq}
        epgUrl={currentBookmark?.epgUrl}
        channelName={currentBookmark?.name}
        showNowPlaying={showNowPlaying}
        onNowPlaying={nowPlaying => setGlobalState(state => ({ ...state, nowPlaying }))}
        {...bounds} />;
}

export const PipOuter = () => {
    const [{ viewMode }] = useGlobalState();

    if (viewMode == ViewMode.Closed) {
        return null;
    }

    return <Pip />;
}
