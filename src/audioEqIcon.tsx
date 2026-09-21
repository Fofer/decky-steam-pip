import { CSSProperties } from "react";

const EQ_STYLE_ID = "steam-pip-eq-keyframes";

// Shared by MinimizedIndicator's own hidden-badge equalizer and the QAM
// panel's combined Hide/Audio-Badge icon (settings.tsx) — one <style> tag
// with the @keyframes, injected once into the document head the first time
// either place ever renders it, and left there (cheap, and removing/
// re-adding on every hide/show would just flash the animation restarting).
export const ensureEqKeyframes = () => {
    if (document.getElementById(EQ_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = EQ_STYLE_ID;
    style.textContent = `
@keyframes steam-pip-eq-bar {
    0%, 100% { transform: scaleY(0.35); }
    50% { transform: scaleY(1); }
}`;
    document.head.appendChild(style);
};

interface AudioEqBarsProps {
    barCount?: number
    height?: number
    barWidth?: number
    gap?: number
    color?: string
}

// A small set of pulsing vertical bars — a plain equalizer, not synced to
// actual audio levels (there's no way to read those back from the loaded
// page), just enough continuous motion to read as "sound is happening
// here" rather than a static, inert glyph. Caller must have already called
// ensureEqKeyframes() once (typically in a useEffect) before this ever
// renders, so the animation actually has its @keyframes to run.
export const AudioEqBars = ({ barCount = 3, height = 8, barWidth = 2.5, gap = 2, color = 'currentColor' }: AudioEqBarsProps) => {
    const style: CSSProperties = { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap, height };
    return (
        <div style={style}>
            {Array.from({ length: barCount }).map((_, i) => (
                <div key={i} style={{
                    width: barWidth,
                    height: '100%',
                    background: color,
                    borderRadius: barWidth / 2,
                    transformOrigin: 'bottom',
                    animation: `steam-pip-eq-bar ${0.6 + i * 0.15}s ease-in-out infinite`,
                    animationDelay: `${i * 0.12}s`,
                }} />
            ))}
        </div>
    );
};
