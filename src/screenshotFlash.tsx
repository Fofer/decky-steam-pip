import { useEffect, useRef, useState } from "react";

// A lazily-created, module-level AudioContext shared by every shutter
// sound — creating a fresh one per screenshot would leak them, and iOS/
// Chromium-style autoplay rules only need the first one to start inside a
// user gesture (a button click already qualifies) rather than every one
// after it.
let audioCtx: AudioContext | null = null;

const getAudioContext = (): AudioContext | null => {
    try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return null;
        const ctx: AudioContext = audioCtx ?? new Ctx();
        audioCtx = ctx;
        if (ctx.state === 'suspended') {
            // Fire-and-forget — if this rejects (blocked autoplay, etc.),
            // the sound just doesn't play; the screenshot itself never
            // depends on it.
            ctx.resume().catch(() => { });
        }
        return ctx;
    } catch (e) {
        return null;
    }
};

// One short burst of filtered white noise — the building block for the two
// mechanical "clicks" in the shutter sound below. Not a recording of
// anything; a synthesized approximation built from noise + a filter + a
// volume envelope. A tighter bandpass (rather than a plain highpass) reads
// much more like a distinct mechanical "click" than a generic hiss —
// narrowing the band around one frequency is what gives it a pitched,
// snappy character instead of just sounding like static.
const playFilteredBurst = (
    ctx: AudioContext, when: number, durationSec: number, gainPeak: number,
    filterType: BiquadFilterType, filterFreq: number, filterQ: number
) => {
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(gainPeak, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, when + durationSec);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start(when);
    source.stop(when + durationSec + 0.02);
};

// A very brief pitched "ring" layered on top of the first click — the bit
// that actually reads as "camera" rather than just "click", since a plain
// filtered-noise burst alone comes out sounding more like a mouse click
// than a shutter.
const playPing = (ctx: AudioContext, when: number, durationSec: number, gainPeak: number, freq: number) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(gainPeak, when + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.001, when + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(when);
    osc.stop(when + durationSec + 0.02);
};

// [Inference] A synthesized stand-in for a camera/phone shutter sound — not
// a recording of any real camera (which would also raise its own rights
// questions to ship in this plugin). Modeled as two mechanical "blade"
// clicks (aperture open, then close ~80ms later — the same two-click
// cadence a real leaf-shutter or a phone's simulated one makes), each a
// tightly-filtered noise burst rather than a plain click, plus a bright
// high-pitched "ring" on the first click for the metallic snap that a
// generic click sound lacks, and a low thump under the second click for
// some weight/body. Good enough as a recognizable "photo taken" cue
// alongside the on-screen flash; failures here are swallowed — this is a
// nice-to-have, never something that should block or error out the
// screenshot itself.
export const playShutterSound = () => {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        const now = ctx.currentTime;

        // Click 1 ("open") — bright and tight, plus a metallic ring.
        playFilteredBurst(ctx, now, 0.012, 0.6, 'bandpass', 3800, 4);
        playPing(ctx, now, 0.025, 0.2, 5200);

        // Click 2 ("close") — duller and a touch longer, ~80ms later, with
        // a low-frequency thump underneath for body.
        playFilteredBurst(ctx, now + 0.08, 0.018, 0.55, 'bandpass', 1500, 3);
        playFilteredBurst(ctx, now + 0.08, 0.03, 0.4, 'lowpass', 220, 1);
    } catch (e) { /* sound is a nice-to-have — never let it throw */ }
};

// How far outside the picture's own rectangle the flash border sits, and
// how long it takes to fade back out once triggered.
const FLASH_OUTSET = 6;
const FLASH_DURATION_MS = 500;

interface ScreenshotFlashProps {
    x: number
    y: number
    width: number
    height: number
    // Bumped once per screenshot (State.screenshotFlashSeq) — this fires
    // its flash/sound off of a change in that counter, not a boolean, same
    // fire-once-counter pattern as playPauseSeq etc. elsewhere in this
    // plugin, so pressing the button again while a previous flash is still
    // fading restarts it cleanly rather than doing nothing.
    seq: number
}

// A brief white glow around the picture's own edges, plus the shutter
// sound above, fired the instant the screenshot button is pressed —
// independent of whether the backend call it kicks off actually succeeds,
// same as a real camera's shutter fires before the photo is known to have
// come out. Drawn as a border OUTSIDE the picture's own rectangle rather
// than a flash over it, because the picture itself renders through Steam's
// native CreateBrowserView (see pip.tsx/controlBar.tsx's own comments on
// this) — a layer that always paints above ordinary HTML regardless of
// z-index, so nothing drawn here could ever cover the video itself anyway.
// A ring just outside its bounds doesn't fight that layering at all.
export const ScreenshotFlash = ({ x, y, width, height, seq }: ScreenshotFlashProps) => {
    const [opacity, setOpacity] = useState(0);
    const [instant, setInstant] = useState(true);
    const mountedRef = useRef(false);

    useEffect(() => {
        // Skip the initial mount (seq starts at 0) so opening the picture
        // never itself triggers a flash/sound.
        if (!mountedRef.current) {
            mountedRef.current = true;
            return;
        }

        playShutterSound();

        // Snap to fully visible with no transition, then let the browser
        // paint that frame before switching transition back on and
        // dropping to 0 — going straight from 0 to 0-with-a-transition
        // would just silently skip the animation instead of flashing.
        setInstant(true);
        setOpacity(1);
        const raf = requestAnimationFrame(() => {
            setInstant(false);
            setOpacity(0);
        });
        return () => cancelAnimationFrame(raf);
    }, [seq]);

    return (
        <div style={{
            position: 'absolute',
            zIndex: 7002,
            left: x - FLASH_OUTSET,
            top: y - FLASH_OUTSET,
            width: width + FLASH_OUTSET * 2,
            height: height + FLASH_OUTSET * 2,
            borderRadius: 12,
            border: '4px solid white',
            boxShadow: '0 0 24px 6px rgba(255, 255, 255, 0.85)',
            opacity,
            transition: instant ? 'none' : `opacity ${FLASH_DURATION_MS}ms ease-out`,
            pointerEvents: 'none',
        }} />
    );
};
