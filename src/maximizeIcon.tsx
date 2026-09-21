import { FaCompress } from "react-icons/fa";
import { MaximizeStep } from "./util";

// [Confirmed by Josh, 2026-09-20] The Maximize button cycles through five
// steps (S/M/L/XL/Expand — see advanceMaximize in util.tsx) rather than just
// toggling Picture/Expand. For the four size steps, a short bold letter is
// clearer at a glance than trying to find four visually distinct "bigger
// picture" icon glyphs; Expand keeps the pre-existing FaCompress ("tap to
// restore/shrink") icon, since that step still behaves like the old toggle.
export const MaximizeIcon = ({ step }: { step: MaximizeStep }) => {
    if (step === 'Expand') return <FaCompress />;
    return <span style={{ fontSize: '0.85em', fontWeight: 'bold' }}>{step}</span>;
};
