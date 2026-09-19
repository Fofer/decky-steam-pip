import { Router, WindowRouter } from "@decky/ui";
import isEqual from "lodash/isEqual";
import { useEffect, useState } from "react";

import { getBounds, getWindowByTreeId, isWindowVisible } from "./steamWindows";
import {
    DECK_NATIVE_HEIGHT,
    DECK_NATIVE_WIDTH,
    DECK_SCREEN_HEIGHT,
    DECK_SCREEN_WIDTH,
    FALLBACK_SCREEN_HEIGHT,
    FALLBACK_SCREEN_WIDTH,
} from "./util";

// Heuristic only: both Steam Deck LCD and OLED have a fixed native panel
// resolution of 1280x800, so a device reporting that is treated as a Deck
// and kept on the original, known-good hardcoded placement. Anything else
// (a Steam Machine on a TV, etc.) uses the dynamically-measured path below.
const isLikelySteamDeck = () =>
    window.screen?.width === DECK_NATIVE_WIDTH
    && window.screen?.height === DECK_NATIVE_HEIGHT;

// The nav/qam bounds below are read live from the real windows Steam
// positions on screen (their own outerWidth/outerHeight), not assumed.
// For non-Deck devices, the overall screen needs the same treatment:
// `browser.SetBounds()` positions the PiP browser view inside the
// GamepadUI main window's own canvas, so that window's actual size
// (WindowRouter.BrowserWindow) is the right thing to measure — NOT the
// OS-reported monitor resolution (window.screen), which is a different
// coordinate space entirely and can be much larger.
const getScreenBounds = () => {
    if (isLikelySteamDeck()) {
        return {
            width: DECK_SCREEN_WIDTH,
            height: DECK_SCREEN_HEIGHT,
        };
    }

    const root: WindowRouter & any = Router.WindowStore?.GamepadUIMainWindowInstance;
    const view: Window | undefined = root?.BrowserWindow;

    const width = view?.outerWidth;
    const height = view?.outerHeight;

    return {
        width: width || FALLBACK_SCREEN_WIDTH,
        height: height || FALLBACK_SCREEN_HEIGHT,
    };
}

export const useScreenBounds = () => {
    const [state, setState] = useState(getScreenBounds());

    useEffect(() => {
        const onResize = () => setState(current => {
            const next = getScreenBounds();
            return isEqual(next, current)
                ? current
                : next;
        });

        window.addEventListener('resize', onResize);
        const interval = setInterval(onResize, 1000);

        return () => {
            window.removeEventListener('resize', onResize);
            clearInterval(interval);
        };
    }, []);

    return state;
}

const getDeckComponentBounds = (screenBounds: { width: number, height: number }) => {
    const nav = getWindowByTreeId('MainNavMenuContainer');
    const navBounds = isWindowVisible(nav)
        ? getBounds(nav?.document)
        : null;

    const qam = getWindowByTreeId('QuickAccess-NA');
    const qamBounds = isWindowVisible(qam)
        ? getBounds(qam?.document)
        : null;

    const virtualKeyboard = getWindowByTreeId('virtual keyboard');
    const virtualKeyboardHidden = !virtualKeyboard;
    // this is a guess, gotta figure out how to inspect to keyboard DOM
    const virtualKeyboardBounds = virtualKeyboardHidden
        ? null
        : {
            x: 0,
            y: screenBounds.height - 240,
            width: screenBounds.width,
            height: 240
        };

    return {
        nav: navBounds,
        qam: qamBounds,
        virtualKeyboard: virtualKeyboardBounds,
    }
}

export const useDeckComponentBounds = (screenBounds: { width: number, height: number }) => {
    const [state, setState] = useState(() => getDeckComponentBounds(screenBounds));

    useEffect(() => {
        const interval = setInterval(() => {
            setState(current => {
                const next = getDeckComponentBounds(screenBounds);
                return isEqual(next, current)
                    ? current
                    : next;
            });
        }, 250);

        return () => clearInterval(interval);
    }, [screenBounds.width, screenBounds.height]);

    return state;
}
