import {
    Router,
    WindowRouter,
} from "@decky/ui";
import { useEffect, useRef, useState } from "react";

import { NowPlaying, useGlobalState } from "./globalState";
import { backendCall } from "./backendCall";
import { usePipBounds } from "./pipBounds";
import { UIComposition, useUIComposition } from "./useUIComposition";
import { getControlBarSides, ViewMode } from "./util";
import { ControlBar } from "./controlBar";
import { MinimizedIndicator } from "./minimizedIndicator";
import { ScreenshotFlash } from "./screenshotFlash";

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
    // Same idea, for the 30-second jump buttons added alongside the
    // original 10-second ones.
    seekBack30Seq: number
    seekForward30Seq: number
    // For a channel with an XMLTV guide (Bookmark.epgUrl) and its display
    // name, used to poll the backend for what's currently airing; undefined
    // for a channel with no guide, which simply never polls.
    epgUrl?: string
    channelName?: string
    showNowPlaying: boolean
    // Fades the picture's own content toward its page background as this
    // drops from 100 — see opacityJs for what this can and can't actually
    // do.
    opacity: number
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

// Fades the loaded page's own content via CSS opacity on <html> — this is
// NOT true window transparency letting the game underneath show through.
// [Unverified] CreateBrowserView is an undocumented internal Steam API with
// no publicly known method for real alpha-compositing against whatever's
// behind it, and no evidence of one turned up anywhere this was checked
// (including other Decky plugins using the same browser view). What this
// actually does is fade the picture toward whatever background color the
// loaded page itself paints (usually black) as the slider drops from 100 —
// a real, useful dimming effect, just not "see-through."
const opacityJs = (opacity: number) => {
    const clamped = Math.max(0, Math.min(100, opacity)) / 100;
    return `
window.__pipOpacity = ${clamped};
window.__pipApplyOpacity = window.__pipApplyOpacity || function () {
    document.documentElement.style.opacity = window.__pipOpacity;
};
window.__pipApplyOpacity();
if (!window.__pipOpacityWatcher) {
    window.__pipOpacityWatcher = setInterval(window.__pipApplyOpacity, 1000);
}
`;
};

const NOW_PLAYING_POLL_MS = 60000;

const Browser = ({ url, visible, volume, muted, opacity, playPauseSeq, seekBackSeq, seekForwardSeq, seekBack30Seq, seekForward30Seq, epgUrl, channelName, showNowPlaying, onNowPlaying, x, y, width, height }: BrowserProps) => {
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
    const opacityRef = useRef(opacity);
    opacityRef.current = opacity;

    useEffect(() => {
        injectJs(preludeJs + volumeJs(volume, muted));
    }, [volume, muted]);

    useEffect(() => {
        injectJs(opacityJs(opacity));
    }, [opacity]);

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

    // Same first-run skip, for the 30-second jump buttons.
    const seekBack30Mounted = useRef(false);
    useEffect(() => {
        if (!seekBack30Mounted.current) {
            seekBack30Mounted.current = true;
            return;
        }
        injectJs(preludeJs + seekJs(-30));
    }, [seekBack30Seq]);

    const seekForward30Mounted = useRef(false);
    useEffect(() => {
        if (!seekForward30Mounted.current) {
            seekForward30Mounted.current = true;
            return;
        }
        injectJs(preludeJs + seekJs(30));
    }, [seekForward30Seq]);

    useEffect(() => {
        browser.SetVisible(visible);
    }, [visible]);

    useEffect(() => {
        view.LoadURL(isHlsUrl(url) ? buildHlsPageUrl(url) : url);

        // The player's own <video> element usually doesn't exist yet the
        // instant the page starts loading, so keep reapplying for a while
        // after navigation until the in-page watcher above is armed.
        const poll = setInterval(
            () => injectJs(preludeJs + volumeJs(volumeRef.current, mutedRef.current) + opacityJs(opacityRef.current)),
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
                result = await backendCall<[string, string], NowPlaying | null>("get_now_playing", epgUrl, channelName);
            } catch (e) {
                // Surfaced to the console rather than swallowed outright —
                // if this is throwing (as opposed to the backend just not
                // finding a match, which returns null instead of throwing),
                // it likely means the plugin backend didn't pick up main.py's
                // get_now_playing method at all (stale install/no restart).
                console.error("SteamPiP: get_now_playing call failed", e);
            }
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
    const [{ url, visible, volume, muted, opacity, playPauseSeq, seekBackSeq, seekForwardSeq, seekBack30Seq, seekForward30Seq, screenshotFlashSeq, bookmarks, showNowPlaying, defaultEpgUrl, viewMode, position, hidden, controlBarEnabled, audioIndicatorEnabled }, setGlobalState] = useGlobalState();
    const currentBookmark = bookmarks.find(b => b.url === url);
    // A channel's own guide URL wins if it has one; otherwise fall back to
    // the single guide URL set for all channels (most people only have one
    // guide source anyway) — unless this bookmark isn't really a live
    // channel at all (YouTube, a website, etc.), which opts out of that
    // fallback entirely (see Bookmark.noGuide's own comment).
    const effectiveEpgUrl = currentBookmark?.noGuide ? undefined : (currentBookmark?.epgUrl || defaultEpgUrl || undefined);

    // The on-screen control bar (see controlBar.tsx) wraps an L around
    // whichever corner of the picture has free space — a side segment and a
    // top-or-bottom segment, each hugging whichever of the picture's edges
    // isn't already flush against a screen boundary (or, on the right,
    // against the QAM panel's own strip). In Expand mode there's no
    // meaningful "free corner" (the picture fills nearly the whole screen),
    // so it keeps the fixed right-side placement its bounds already reserve
    // space for in pipBounds.tsx, same as before this L-shaped redesign.
    const { vertical: verticalSide, horizontal: horizontalSide } = viewMode === ViewMode.Picture
        ? getControlBarSides(position)
        : { vertical: 'right' as const, horizontal: 'bottom' as const };

    return <>
        <Browser
            url={url}
            visible={visible}
            volume={volume}
            muted={muted}
            opacity={opacity}
            playPauseSeq={playPauseSeq}
            seekBackSeq={seekBackSeq}
            seekForwardSeq={seekForwardSeq}
            seekBack30Seq={seekBack30Seq}
            seekForward30Seq={seekForward30Seq}
            epgUrl={effectiveEpgUrl}
            channelName={currentBookmark && (currentBookmark.epgChannelName || currentBookmark.name)}
            showNowPlaying={showNowPlaying}
            onNowPlaying={nowPlaying => setGlobalState(state => ({ ...state, nowPlaying }))}
            {...bounds} />
        <ScreenshotFlash x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} seq={screenshotFlashSeq} />
        {controlBarEnabled && (hidden
            ? <MinimizedIndicator muted={muted} audioIndicatorEnabled={audioIndicatorEnabled} />
            : <ControlBar {...bounds} verticalSide={verticalSide} horizontalSide={horizontalSide} viewMode={viewMode} />)}
    </>;
}

export const PipOuter = () => {
    const [{ viewMode }] = useGlobalState();

    if (viewMode == ViewMode.Closed) {
        return null;
    }

    return <Pip />;
}
