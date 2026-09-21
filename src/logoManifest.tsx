// Real logo image files for channels — supplied by hand, since a stock
// vector icon (react-icons' Simple Icons set, still used for YouTube, Twitch
// and Tubi in channelIcon.tsx) isn't the network's actual current logo. FOX,
// NBC, CBS and CNN were supplied this round and take priority over their
// old Simple Icons vector stand-ins, which channelIcon.tsx no longer uses.
import abcLogo from "./logos/abc.png";
import msNowLogo from "./logos/msnow.png";
import plutoTvLogo from "./logos/plutotv.png";
import kcalLogo from "./logos/kcal.png";
import ktlaLogo from "./logos/ktla.png";
import channelsDvrLogo from "./logos/channelsdvr.png";
import foxLogo from "./logos/fox.png";
import nbcLogo from "./logos/nbc.png";
import cbsLogo from "./logos/cbs.png";
import cnnLogo from "./logos/cnn.png";

// Keyed by a lowercase keyword to match against EITHER the channel's URL or
// its saved name — a local affiliate (KCAL, KTLA) streamed through a
// personal Channels DVR server has a URL that points at that server, not at
// the network's own domain, so matching by name is what actually works for
// those; a keyword that happens to also appear in a URL (abc.com, pluto.tv)
// matches there too.
//
// channelsdvr's own logo is reserved for an actual "Channels DVR"/"On Now"
// entry — e.g. a bookmark that opens the DVR's own live-channel browser
// rather than one specific network — not used as a generic stand-in for
// anything unrecognized. A channel with no real match anywhere falls back
// to a plain TV glyph instead (see channelIcon.tsx), which is deliberately
// generic/blank-looking so it stays obvious which channels still need their
// real logo added.
export const LOGOS: Record<string, string> = {
    'abc.com': abcLogo,
    'abc': abcLogo,
    'msnow.com': msNowLogo,
    'msnbc.com': msNowLogo,
    'ms now': msNowLogo,
    'msnow': msNowLogo,
    'pluto.tv': plutoTvLogo,
    'plutotv': plutoTvLogo,
    'pluto tv': plutoTvLogo,
    'kcal': kcalLogo,
    'ktla': ktlaLogo,
    'channels dvr': channelsDvrLogo,
    'channelsdvr': channelsDvrLogo,
    'on now': channelsDvrLogo,
    'onnow': channelsDvrLogo,
    'fox.com': foxLogo,
    'foxsports.com': foxLogo,
    'fox': foxLogo,
    'nbc.com': nbcLogo,
    'nbc': nbcLogo,
    'cbs.com': cbsLogo,
    'cbs': cbsLogo,
    'cnn.com': cnnLogo,
    'cnn': cnnLogo,
};
