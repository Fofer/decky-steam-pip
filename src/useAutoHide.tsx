import { useCallback, useEffect, useRef, useState } from "react";

// Bumped from 3000 to 5000 per feedback that the bar felt like it was
// hiding itself almost as soon as it appeared.
const DEFAULT_TIMEOUT_MS = 5000;

// The "show controls briefly, then get out of the way" pattern familiar
// from video players — starts expanded, collapses to a thin edge tab after
// a few seconds of no interaction, and re-expands on the next tap/press.
// Used by controlBar.tsx so the on-screen control strip doesn't sit over
// the picture indefinitely while just watching.
export const useAutoHide = (timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const [expanded, setExpanded] = useState(true);
    const timerRef = useRef<number | null>(null);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const startTimer = useCallback(() => {
        clearTimer();
        timerRef.current = window.setTimeout(() => setExpanded(false), timeoutMs);
    }, [clearTimer, timeoutMs]);

    const show = useCallback(() => {
        setExpanded(true);
        startTimer();
    }, [startTimer]);

    const onInteraction = useCallback(() => {
        startTimer();
    }, [startTimer]);

    useEffect(() => {
        startTimer();
        return clearTimer;
    }, [startTimer, clearTimer]);

    return { expanded, show, onInteraction };
};
