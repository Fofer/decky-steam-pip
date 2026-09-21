import { FaYoutube, FaTwitch, FaTv } from "react-icons/fa";
import { SiTubi } from "react-icons/si";

import { Bookmark } from "./globalState";
import { LOGOS } from "./logoManifest";

const logoImg = (src: string) => <img src={src} style={{ width: '1em', height: '1em', objectFit: 'contain' }} />;

// A recognizable brand icon for each channel — real supplied logo images
// (logoManifest.tsx: ABC, MS NOW, Pluto TV, KCAL, KTLA, Channels DVR, FOX,
// NBC, CBS, CNN) take priority, then a couple of remaining stock vector
// brand icons bundled in react-icons' Simple Icons set (YouTube, Twitch,
// Tubi — no real logo file supplied for these yet), then a plain generic TV
// glyph as the last resort for anything else (a raw .m3u8/DVR URL, a custom
// stream, or any channel that just hasn't had its real logo added yet) —
// deliberately generic-looking, so a channel showing this glyph is an
// obvious "still needs its real logo" marker rather than something that
// could be mistaken for an actual brand.
export const channelIcon = (bookmark: Bookmark) => {
    const url = bookmark.url.toLowerCase();
    // A local affiliate streamed through a personal Channels DVR server has
    // a URL that points at that server, not at the network's own domain —
    // so the channel's saved NAME is checked too, which is what actually
    // matches something like "KCAL 9" or "KTLA 5".
    const name = bookmark.name.toLowerCase();

    for (const [keyword, src] of Object.entries(LOGOS)) {
        if (url.includes(keyword) || name.includes(keyword)) {
            return logoImg(src);
        }
    }

    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return <FaYoutube color="#FF0000" />;
    }
    if (url.includes('twitch.tv')) {
        return <FaTwitch color="#9146FF" />;
    }
    if (url.includes('tubitv.com')) {
        return <SiTubi color="#FA382B" />;
    }
    return <FaTv />;
};
