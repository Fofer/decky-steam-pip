import { useGlobalState } from "./globalState";
import { intersectRectangles } from "./geometry";
import { useDeckComponentBounds, useScreenBounds } from "./screen";
import { CONTROL_BAR_WIDTH, PICTURE_ASPECT_RATIO, PICTURE_WIDTH_RATIO, Position, SIZE_MAX, SIZE_MIN, ViewMode } from "./util";

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

// The native browser view's width while hidden — kept small (rather than
// zero) since a fully zero-sized view risked breaking video/audio playback
// on some pages, but it no longer needs to be big enough to read as a
// visible "shelf": the whole rectangle is now parked entirely past the
// screen's right edge (see the `hidden` branch below), so none of this
// strip is actually on-screen. What used to be a deliberately-visible 14px
// sliver of live video (with minimizedIndicator.tsx's badge floating over
// it, masking it as best it could) is now fully off-canvas instead — the
// badge is the only thing shown, drawn independently of these bounds.
const HIDDEN_VIEW_WIDTH = 14;

export const usePipBounds = () => {
    const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useScreenBounds();
    const { nav, qam, virtualKeyboard } = useDeckComponentBounds({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
    const [{ viewMode, position, size, hidden, ...settings }] = useGlobalState();

    // Clamped to the Size slider's current own range — guards against a
    // persisted value from before that range last changed (the slider only
    // clamps what it displays, not the stored value underneath it).
    const clampedSize = Math.max(SIZE_MIN, Math.min(SIZE_MAX, size));
    const pictureWidth = SCREEN_WIDTH * PICTURE_WIDTH_RATIO * clampedSize;
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
            // Reserves room on the right for the on-screen control bar
            // (controlBar.tsx) — Expand mode otherwise fills the whole
            // available area, which would leave the bar drawn right over
            // the picture instead of beside it. Not needed while hidden,
            // since the bar doesn't show then either.
            if (!hidden && settings.controlBarEnabled) {
                bounds.width -= CONTROL_BAR_WIDTH;
            }
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

    // Captured here — after the position layout above, before the `hidden`
    // override below overwrites bounds.x/width for the native view — so
    // this always reflects where the picture actually rests (or would
    // rest) regardless of hidden. minimizedIndicator.tsx uses this to plant
    // its badge exactly where the picture was last positioned/sized, rather
    // than some fixed spot the user'd have to go hunting for.
    const restRect = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };

    // Only nudge the picture out of QAM's way when it would actually be
    // covered by it, and only by as much as needed to clear it (QAM is
    // docked to the right edge and spans the full height, so only a
    // horizontal check is needed) — not a full recenter, and not all the
    // way to the left edge, both of which were symptoms of trusting QAM's
    // own (unreliable) measured bounds instead of the fixed fraction above.
    // Applied to restRect unconditionally (not just while actually visible)
    // so the resting position used for the hidden badge already accounts
    // for QAM, rather than drifting once the picture's un-hidden and this
    // runs again.
    if (qam && viewMode == ViewMode.Picture) {
        const qamLeft = SCREEN_WIDTH * (1 - QAM_WIDTH_FRACTION);
        const overlapsHorizontally = restRect.x + restRect.width > qamLeft;

        // Flush against QAM's edge rather than leaving the picture's own
        // margin setting as a gap here too — a few px keeps it from
        // literally touching the menu, not a whole "Margin" slider's worth.
        const qamClearance = 6;

        // Subtracting margin here (not just in the position formulas above)
        // was the missing piece for every right-docked position (Right,
        // TopRight, BottomRight): QAM's own safe distance from the screen's
        // right edge is far bigger than the margin slider's whole range, so
        // without this the clamp below always won outright and pinned the
        // picture to one fixed spot no matter what margin was set to — the
        // picture would visibly move on the left side (nothing here
        // clamps it) but sit frozen (or only move on one axis, for the
        // corners) on the right. Folding margin into the boundary itself
        // means increasing margin keeps pushing the picture further from
        // QAM too, instead of the two fighting each other.
        if (overlapsHorizontally) {
            const minX = margin;
            const maxX = qamLeft - qamClearance - restRect.width - margin;
            restRect.x = Math.max(minX, Math.min(restRect.x, maxX));
        }
    }

    // Hidden parks the native browser view entirely past the screen's right
    // edge — not docked to it as a visible sliver anymore (see
    // HIDDEN_VIEW_WIDTH above) — so there's no live video on-screen at all
    // while hidden, just minimizedIndicator.tsx's own badge (planted at
    // restRect's center, above) floating independently of these bounds.
    // Otherwise (not hidden), bounds is simply restRect, QAM nudge and all.
    const finalBounds = hidden
        ? { ...restRect, x: SCREEN_WIDTH, width: HIDDEN_VIEW_WIDTH }
        : restRect;

    return { ...finalBounds, restCenterX: restRect.x + restRect.width / 2, restCenterY: restRect.y + restRect.height / 2 };
}
