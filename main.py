import asyncio
import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen

import decky

EXPORT_FORMAT = "steampip-channels"


def _parse_xmltv_time(value: str):
    # XMLTV timestamps look like "20260919133000 +0000".
    try:
        value = value.strip()
        dt = datetime.strptime(value[:14], "%Y%m%d%H%M%S")
        offset = value[14:].strip()
        if offset:
            sign = 1 if offset[0] == "+" else -1
            hours = int(offset[1:3])
            minutes = int(offset[3:5])
            dt = dt - sign * timedelta(hours=hours, minutes=minutes)
        return dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _normalize(text):
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _fetch_now_playing(xmltv_url: str, channel_name: str):
    req = Request(xmltv_url, headers={"User-Agent": "SteamPiP"})
    with urlopen(req, timeout=8) as resp:
        data = resp.read()

    root = ET.fromstring(data)
    needle = _normalize(channel_name)
    if not needle:
        return None

    # Matches loosely (substring either direction) against each <channel>'s
    # <display-name>(s), since a DVR server's own channel naming ("KTLA",
    # "KTLA-HD", "5.1 KTLA") won't necessarily match a bookmark's display
    # name ("KTLA 5") exactly.
    matching_channel_ids = set()
    for channel_el in root.findall("channel"):
        channel_id = channel_el.get("id", "")
        for name_el in channel_el.findall("display-name"):
            hay = _normalize(name_el.text)
            if hay and (hay in needle or needle in hay):
                matching_channel_ids.add(channel_id)
                break

    if not matching_channel_ids:
        return None

    now = datetime.now(timezone.utc)
    for programme_el in root.findall("programme"):
        if programme_el.get("channel") not in matching_channel_ids:
            continue
        start = _parse_xmltv_time(programme_el.get("start", ""))
        stop = _parse_xmltv_time(programme_el.get("stop", ""))
        if not start or not stop or not (start <= now <= stop):
            continue
        title_el = programme_el.find("title")
        subtitle_el = programme_el.find("sub-title")
        return {
            "title": title_el.text if title_el is not None else "",
            "subtitle": subtitle_el.text if subtitle_el is not None else "",
        }

    return None


class Plugin:
    # Deliberately generic: takes the XMLTV guide URL and the channel's
    # display name from whichever bookmark the frontend currently has
    # loaded, rather than hardcoding any particular server or channel
    # lineup. Only Josh's own gitignored personalBookmarks.tsx (frontend)
    # knows his DVR server's URL or which of his channels carry an EPG —
    # this file has no personal information in it and stays safe for the
    # public repo.
    async def get_now_playing(self, xmltv_url: str, channel_name: str):
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(None, _fetch_now_playing, xmltv_url, channel_name)
        except Exception as e:
            decky.logger.warning(f"SteamPiP: now-playing lookup failed for {channel_name!r}: {e}")
            return None

    # The frontend's folder/file pickers (Decky's own native browser, the
    # same one used to pick a plugin ZIP to install) need a starting
    # location — the real user's home directory, which only the backend
    # actually knows (decky.HOME, not root's, as long as this plugin
    # doesn't request the "root" flag, which it doesn't).
    async def get_home_dir(self):
        return decky.HOME

    # Writes the channel list to the exact folder and filename the user
    # picked/typed via the frontend's own native folder browser + filename
    # prompt — nothing here assumes Downloads or invents a location.
    # bookmarks_json is the frontend's bookmarks array, already JSON-encoded
    # (kept as a plain string argument since this plugin has no need to
    # interpret it — it just needs to round-trip intact).
    async def export_channels_to(self, bookmarks_json: str, folder_path: str, filename: str):
        try:
            bookmarks = json.loads(bookmarks_json)
        except Exception as e:
            return {"error": f"Invalid channel data: {e}"}

        if not filename.lower().endswith(".json"):
            filename += ".json"

        try:
            path = os.path.join(folder_path, filename)
            payload = {"format": EXPORT_FORMAT, "version": 1, "bookmarks": bookmarks}
            with open(path, "w") as f:
                json.dump(payload, f, indent=2)
            return {"path": path}
        except Exception as e:
            decky.logger.warning(f"SteamPiP: export failed: {e}")
            return {"error": str(e)}

    # Reads back a channel list export from wherever the user picked it via
    # the frontend's own native file browser — an absolute path they chose
    # themselves, not a name resolved against some assumed folder.
    async def import_channels_from_path(self, path: str):
        try:
            with open(path, "r") as f:
                payload = json.load(f)
            bookmarks = payload.get("bookmarks")
            if not isinstance(bookmarks, list):
                return {"error": "That file doesn't look like a Steam PiP channel export"}
            return {"bookmarks": bookmarks}
        except Exception as e:
            decky.logger.warning(f"SteamPiP: import failed: {e}")
            return {"error": str(e)}

    async def _main(self):
        decky.logger.info("SteamPiP backend loaded")

    async def _unload(self):
        pass

    async def _uninstall(self):
        pass
