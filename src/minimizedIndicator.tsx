import { useEffect } from "react";
import { FaTv } from "react-icons/fa";

import { useGlobalState } from "./globalState";
import { useScreenBounds } from "./screen";
import { AudioEqBars, ensureEqKeyframes } from "./audioEqIcon";

const INDICATOR_SIZE = 44;
// How far in from the true screen edge the badge sits — just enough that
// it isn't literally clipped by the edge, while still reading as tucked
// into the corner rather than floating.
const EDGE_PAD = 8;

interface MinimizedIndicatorProps {
    muted: boolean
    audioIndicatorEnabled: boolean
}

// A clearly-a-button badge standing in for this plugin's "hidden" state —
// playback keeps running, the picture itself is just moved fully off-screen
// (see the `hidden` branch in pipBounds.tsx) so there's no live video to
// find or tap through, only this. Idea adapted from ajustinjames's
// decky-portal fork, though the off-screen-picture approach (rather than a
// visible docked sliver) is this fork's own — a prior version kept the
// picture on-screen as a thin 14px strip with this badge floating over it,
// which still showed a sliver of real video peeking out (worse still, only
// partly hidden depending on whether QAM happened to be open) — reverted per
// feedback that it wasn't worth having at all, "too small to be usable."
//
// [Confirmed by Josh, 2026-09-20] Used to plant itself at the picture's own
// rest position (wherever Position/Margin/Size last left it), which could
// land it anywhere on screen, including the middle. Always docks to the
// screen's own bottom-right corner instead — tucked out of the way in the
// same spot every time, whether the QAM is open or not (useScreenBounds()
// reads the real screen/canvas size either way, not whatever room the QAM
// leaves free), rather than needing to be hunted for wherever the picture
// happened to be.
//
// When the picture isn't muted, an optional small set of pulsing bars
// (three, animated via CSS keyframes — see audioEqIcon.tsx's own comment)
// shows next to the TV icon as a "this is still making sound" cue — toggled
// off entirely via State.audioIndicatorEnabled (the panel's View row) for
// anyone who'd rather the badge stay perfectly still.
export const MinimizedIndicator = ({ muted, audioIndicatorEnabled }: MinimizedIndicatorProps) => {
    const [, setGlobalState] = useGlobalState();
    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useScreenBounds();

    const showEq = audioIndicatorEnabled && !muted;

    useEffect(() => {
        if (showEq) ensureEqKeyframes();
    }, [showEq]);

    const restore = () => setGlobalState(state => ({ ...state, hidden: false }));

    const left = SCREEN_WIDTH - INDICATOR_SIZE - EDGE_PAD;
    const top = SCREEN_HEIGHT - INDICATOR_SIZE - EDGE_PAD;

    return (
        <button
            aria-label="Restore"
            onClick={restore}
            style={{
                position: 'absolute',
                zIndex: 7001,
                left,
                top,
                width: INDICATOR_SIZE,
                height: INDICATOR_SIZE,
                borderRadius: INDICATOR_SIZE / 2,
                background: 'rgba(40, 40, 40, 0.85)',
                border: '2px solid rgba(255, 255, 255, 0.6)',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: 0,
                fontSize: 18,
            }}
        >
            <FaTv />
            {showEq && <AudioEqBars height={8} barWidth={2.5} gap={2} color="rgba(255, 255, 255, 0.9)" />}
        </button>
    );
};
