import { getGamepadNavigationTrees } from "@decky/ui";
import { useEffect, useState } from "react";

// Shared helpers for reading Steam's own UI windows (nav menu, quick access
// menu, virtual keyboard, etc.) via the same gamepad-navigation-tree lookup
// used throughout this plugin.

export const getWindowByTreeId = (id: string): any => {
    const trees = getGamepadNavigationTrees();
    return trees.find((tree: any) => tree?.id === id)?.m_Root?.m_element?.ownerDocument.defaultView ?? null;
}

export const getBounds = (document: any) => {
    return {
        x: document?.defaultView?.screenLeft,
        y: document?.defaultView?.screenTop,
        width: document?.defaultView?.outerWidth,
        height: document?.defaultView?.outerHeight,
    };
}

export const isWindowVisible = (win: any) => !!win && !win.document.hidden;

// True while the Quick Access Menu (the sidebar Decky and Steam's own quick
// settings live in) is open. Polled the same way the rest of this plugin
// polls Steam's UI state, since there's no push/event API exposed for it.
export const useQamVisible = () => {
    const [visible, setVisible] = useState(() => isWindowVisible(getWindowByTreeId('QuickAccess-NA')));

    useEffect(() => {
        const interval = setInterval(() => {
            setVisible(current => {
                const next = isWindowVisible(getWindowByTreeId('QuickAccess-NA'));
                return next === current ? current : next;
            });
        }, 250);

        return () => clearInterval(interval);
    }, []);

    return visible;
}
