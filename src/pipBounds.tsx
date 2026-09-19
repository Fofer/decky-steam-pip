import { useGlobalState } from "./globalState";
import { intersectRectangles } from "./geometry";
import { useDeckComponentBounds, useScreenBounds } from "./screen";
import { PICTURE_ASPECT_RATIO, PICTURE_WIDTH_RATIO, Position, ViewMode } from "./util";

// The exact on-screen rectangle {x, y, width, height} the PiP picture
// occupies, in the same "virtual" coordinate space useScreenBounds()
// measures in. Factored out of pip.tsx's Pip() component for clarity.
// The QAM window's own reported bounds (screenLeft/outerWidth) turned out
// to describe its whole backing window, not just the visible sidebar strip
// on the right — on this hardware that meant qam.x measured as 0 and
// qam.width as nearly the full screen, which made every nudge below clamp
// all the way to the left edge instead of just clearing the menu. Since
// the real, visible QAM panel is a fixed-looking fraction of screen width
// docked to the right edge, a known fraction is a far more reliable stand-in
// than trusting that measurement.
const QAM_WIDTH_FRACTION = 0.25;

// The docked width of the "shelf" the picture collapses to when hidden —
// thin enough to read as a tucked-away sliver, not a smaller picture.
const HIDDEN_SHELF_WIDTH = 14;

export const usePipBounds = () => {
    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useScreenBounds();
    const { nav, qam, virtualKeyboard } = useDeckComponentBounds({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
    const [{ viewMode, position, size, hidden, ...settings }] = useGlobalState();

    const pictureWidth = SCREEN_WIDTH * PICTURE_WIDTH_RATIO * size;
    const pictureHeight = pictureWidth * (1.0 / PICTURE_ASPECT_RATIO);

    // The Quick Access Menu is deliberately left out of this base layout
    // (for Picture mode — see below) rather than folded into the same
    // intersection as the nav bar. Treating it like a permanent panel and
    // refitting/recentering the whole layout around a narrower "available"
    // area made the picture jump across the screen any time QAM opened,
    // even when the picture wasn't anywhere near it. Instead, the picture
    // is positioned normally here, and nudged left afterward only if QAM
    // would actually overlap it.
    const availableBounds = [{
        x: 0,
        y: 0,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT
    }];

    if (nav) {
        availableBounds.push({
            x: nav.width,
            y: 0,
            width: SCREEN_WIDTH - nav.width,
            height: SCREEN_HEIGHT
        });
    }

    // In Expand mode the picture intentionally fills the whole available
    // area, so QAM does need to be subtracted here — otherwise it would
    // be drawn underneath the menu instead of alongside it.
    if (qam && viewMode == ViewMode.Expand) {
        availableBounds.push({
            x: 0,
            y: 0,
            width: SCREEN_WIDTH * (1 - QAM_WIDTH_FRACTION),
            height: SCREEN_HEIGHT
        });
    }

    if (virtualKeyboard) {
        availableBounds.push({
            x: 0,
            y: 0,
            width: SCREEN_WIDTH,
            height: SCREEN_HEIGHT - virtualKeyboard.height
        });
    }

    const bounds = intersectRectangles(availableBounds) ?? {
        x: 0,
        y: 0,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT
    };

    const margin = viewMode == ViewMode.Expand
        ? 30
        : settings.margin;

    bounds.x += margin;
    bounds.y += margin;
    bounds.width -= margin * 2;
    bounds.height -= margin * 2;

    switch (viewMode) {
        case ViewMode.Expand: {
            // do nothing, screen is calculated initially to fullscreen
        } break;

        case ViewMode.Picture: {
            switch (position) {
                case Position.Top: {
                    bounds.x += bounds.width / 2 - pictureWidth / 2;
                } break;
                case Position.TopRight: {
                    bounds.x += bounds.width - pictureWidth;
                } break;
                case Position.Right: {
                    bounds.x += bounds.width - pictureWidth;
                    bounds.y += bounds.height / 2 - pictureHeight / 2;
                } break;
                case Position.BottomRight: {
                    bounds.x += bounds.width - pictureWidth;
                    bounds.y += bounds.height - pictureHeight;
                } break;
                case Position.Bottom: {
                    bounds.x += bounds.width / 2 - pictureWidth / 2;
                    bounds.y += bounds.height - pictureHeight;
                } break;
                case Position.BottomLeft: {
                    bounds.y += bounds.height - pictureHeight;
                } break;
                case Position.Left: {
                    bounds.y += bounds.height / 2 - pictureHeight / 2;
                } break;
                case Position.TopLeft: {
                    // do nothing, screen is calculated initially to top left
                } break;
            }

            bounds.width = pictureWidth;
            bounds.height = pictureHeight;
        } break;
    }

    // Collapsing to the hidden "shelf" always docks to the screen's right
    // edge, regardless of whichever position/Expand geometry was just
    // computed above — the point is a single predictable parking spot, not
    // "wherever it happened to be." Vertical placement (and picture height)
    // is left as-is, so it visually shrinks in from the side rather than
    // jumping somewhere new, and un-hiding restores the exact same spot.
    if (hidden) {
        bounds.x = SCREEN_WIDTH - margin - HIDDEN_SHELF_WIDTH;
        bounds.width = HIDDEN_SHELF_WIDTH;
    }

    // Only nudge the picture out of QAM's way when it would actually be
    // covered by it, and only by as much as needed to clear it (QAM is
    // docked to the right edge and spans the full height, so only a
    // horizontal check is needed) — not a full recenter, and not all the
    // way to the left edge, both of which were symptoms of trusting QAM's
    // own (unreliable) measured bounds instead of the fixed fraction above.
    if (qam && (viewMode == ViewMode.Picture || hidden)) {
        const qamLeft = SCREEN_WIDTH * (1 - QAM_WIDTH_FRACTION);
        const overlapsHorizontally = bounds.x + bounds.width > qamLeft;

        // Flush against QAM's edge rather than leaving the picture's own
        // margin setting as a gap here too — a few px keeps it from
        // literally touching the menu, not a whole "Margin" slider's worth.
        const qamClearance = 6;

        if (overlapsHorizontally) {
            const minX = margin;
            const maxX = qamLeft - qamClearance - bounds.width;
            bounds.x = Math.max(minX, Math.min(bounds.x, maxX));
        }
    }

    return bounds;
}
