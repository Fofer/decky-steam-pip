import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen

import decky

EXPORT_FORMAT = "steampip-channels"

# [Confirmed on Josh's own Steam Machine, 2026-09-20] `which` over SSH found
# spectacle and ffmpeg on PATH; grim, gnome-screenshot, scrot, convert,
# import, maim and PIL are all absent. XDG_SESSION_TYPE=wayland,
# WAYLAND_DISPLAY=wayland-0, DISPLAY=:0 in that SSH shell. Tried in order,
# first one that both exists on PATH and actually produces a file wins. Each
# entry is (tool_name, argv_builder(out_path)) so the same loop can build a
# different command line per tool.
_SCREENSHOT_TOOLS = [
    ("spectacle", lambda out: ["spectacle", "-b", "-n", "-f", "-o", out]),
    ("ffmpeg", lambda out: ["ffmpeg", "-y", "-f", "x11grab", "-i", ":0.0", "-frames:v", "1", out]),
    ("grim", lambda out: ["grim", out]),
    ("gnome-screenshot", lambda out: ["gnome-screenshot", "-f", out]),
    ("scrot", lambda out: ["scrot", "-o", out]),
]


def _screenshot_subprocess_env():
    # DISPLAY/WAYLAND_DISPLAY/XDG_RUNTIME_DIR/DBUS_SESSION_BUS_ADDRESS
    # defaults — [Confirmed on Josh's own Steam Machine, 2026-09-20] these
    # env vars WERE already present in the plugin's own process (its log
    # showed DISPLAY=':0' etc before any default was applied), so this round
    # of guessing turned out not to be the actual problem — kept anyway since
    # it's harmless and does nothing when the values are already set.
    env = dict(os.environ)
    uid = "1000"
    try:
        import pwd
        uid = str(pwd.getpwnam("deck").pw_uid)
    except Exception:
        pass
    env.setdefault("DISPLAY", ":0")
    env.setdefault("WAYLAND_DISPLAY", "wayland-0")
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")
    env.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{uid}/bus")

    # [Confirmed on Josh's own Steam Machine, 2026-09-20] The REAL cause,
    # found from his log: spectacle and ffmpeg both failed with
    # "libstdc++.so.6: version `GLIBCXX_3.4.32' not found", and the path in
    # that error — /tmp/_MEI0000.../libstdc++.so.6 — is a PyInstaller
    # extraction directory. Decky Loader's own backend is itself a
    # PyInstaller-frozen executable (see the earlier xml.etree crash, also a
    # symptom of this same bundled-runtime setup), and PyInstaller's Linux
    # bootloader points LD_LIBRARY_PATH at that extraction directory so the
    # frozen app finds ITS OWN bundled shared libraries — including an older
    # libstdc++.so.6 than the real system one. Every subprocess this plugin
    # spawns inherits that LD_LIBRARY_PATH by default, so spectacle/ffmpeg
    # (built against the system's newer libstdc++) end up loading Decky's
    # bundled OLD one instead and fail to find symbols that only exist in
    # the newer version. PyInstaller's own convention is to save the real
    # original value (if any) to LD_LIBRARY_PATH_ORIG specifically so
    # spawned children can restore it — that's exactly what this does,
    # falling back to removing LD_LIBRARY_PATH entirely (rather than leaving
    # Decky's bundled one in place) when there was no original to restore.
    if "LD_LIBRARY_PATH_ORIG" in env:
        orig = env.pop("LD_LIBRARY_PATH_ORIG")
        if orig:
            env["LD_LIBRARY_PATH"] = orig
        else:
            env.pop("LD_LIBRARY_PATH", None)
    else:
        env.pop("LD_LIBRARY_PATH", None)
    return env


def _capture_full_screen(out_path: str):
    env = _screenshot_subprocess_env()
    # Logged once per call (not per tool) so a single failed attempt's log
    # shows exactly what this process saw, rather than guessing again from
    # outside it — compare against what Josh's own SSH shell reported.
    decky.logger.info(
        "SteamPiP: screenshot env DISPLAY=%r WAYLAND_DISPLAY=%r XDG_RUNTIME_DIR=%r "
        "DBUS_SESSION_BUS_ADDRESS=%r (before defaults: DISPLAY=%r WAYLAND_DISPLAY=%r)",
        env.get("DISPLAY"), env.get("WAYLAND_DISPLAY"), env.get("XDG_RUNTIME_DIR"),
        env.get("DBUS_SESSION_BUS_ADDRESS"), os.environ.get("DISPLAY"), os.environ.get("WAYLAND_DISPLAY"))

    for tool_name, build_argv in _SCREENSHOT_TOOLS:
        path = shutil.which(tool_name)
        if path is None:
            decky.logger.info(f"SteamPiP: screenshot tool {tool_name!r} not on PATH, skipping")
            continue
        try:
            argv = build_argv(out_path)
            # 5s per tool, not 10s — up to several tools can be tried in
            # sequence, and the frontend's own wait on this whole call is
            # finite too (see backendCallWithTimeout in backendCall.ts), so a
            # slow or hung tool shouldn't be allowed to eat most of that
            # budget by itself.
            result = subprocess.run(argv, capture_output=True, timeout=5, env=env)
            if result.returncode != 0:
                # [Confirmed by Josh, 2026-09-20] ffmpeg's stderr always
                # starts with a huge multi-line build-configuration banner —
                # slicing the FIRST 500 characters (the old behavior) never
                # actually reached the real error message underneath it, so
                # every failure log for ffmpeg specifically was useless. The
                # tail is where the actual error lives.
                stderr_text = result.stderr.decode('utf-8', errors='replace')
                decky.logger.warning(
                    f"SteamPiP: screenshot tool {tool_name!r} exited {result.returncode}: "
                    f"stderr(tail)={stderr_text[-800:]!r}")
                continue
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                return tool_name
            # Exited 0 but wrote nothing — [Confirmed by Josh, 2026-09-20]
            # this is what spectacle actually did. Its own stdout/stderr
            # weren't being logged at all in this case before, so a silent
            # failure like this (likely spectacle's screenshot portal simply
            # not being available under gamescope, rather than an error it
            # reports loudly) had no diagnostic trail whatsoever.
            decky.logger.warning(
                f"SteamPiP: screenshot tool {tool_name!r} exited 0 but produced no output file — "
                f"stdout={result.stdout.decode('utf-8', errors='replace')[-500:]!r} "
                f"stderr={result.stderr.decode('utf-8', errors='replace')[-500:]!r}")
        except Exception as e:
            decky.logger.warning(f"SteamPiP: screenshot tool {tool_name!r} failed: {e}")
            continue
    return None


def _crop(src_path: str, dest_path: str, x: int, y: int, width: int, height: int):
    # Prefer Pillow when it's importable — one clean in-process crop with no
    # extra subprocess. [Confirmed on Josh's own Steam Machine, 2026-09-20]
    # neither PIL nor ImageMagick's `convert` is present there, but ffmpeg
    # is, so that's the fallback below rather than the last resort.
    try:
        from PIL import Image
        with Image.open(src_path) as img:
            cropped = img.crop((x, y, x + width, y + height))
            cropped.save(dest_path)
        return True
    except ImportError:
        pass
    except Exception as e:
        decky.logger.warning(f"SteamPiP: PIL crop failed: {e}")
        return False

    # Same LD_LIBRARY_PATH leak as the capture step above (Decky's own
    # PyInstaller-frozen backend poisons every subprocess it spawns with its
    # own bundled, outdated libstdc++) — convert/ffmpeg are external binaries
    # just like the capture tools, so they need the same sanitized env or
    # they'd hit the identical GLIBCXX failure right after capture succeeds.
    env = _screenshot_subprocess_env()

    if shutil.which("convert") is not None:
        try:
            geometry = f"{width}x{height}+{x}+{y}"
            subprocess.run(["convert", src_path, "-crop", geometry, "+repage", dest_path],
                            check=True, capture_output=True, timeout=10, env=env)
            return os.path.exists(dest_path) and os.path.getsize(dest_path) > 0
        except Exception as e:
            decky.logger.warning(f"SteamPiP: convert crop failed: {e}")
            return False

    if shutil.which("ffmpeg") is not None:
        try:
            crop_filter = f"crop={width}:{height}:{x}:{y}"
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", src_path, "-vf", crop_filter, dest_path],
                capture_output=True, timeout=10, env=env)
            if result.returncode != 0:
                # Same tail-not-head fix as _capture_full_screen's ffmpeg
                # logging — the first 500 characters are always just
                # ffmpeg's own build-config banner.
                decky.logger.warning(
                    f"SteamPiP: ffmpeg crop exited {result.returncode}: "
                    f"stderr(tail)={result.stderr.decode('utf-8', errors='replace')[-800:]!r}")
                return False
            return os.path.exists(dest_path) and os.path.getsize(dest_path) > 0
        except Exception as e:
            decky.logger.warning(f"SteamPiP: ffmpeg crop failed: {e}")
            return False

    return False


# Reads a PNG's width/height straight from its IHDR chunk (bytes 16-24 of
# any valid PNG: 4-byte big-endian width, then 4-byte big-endian height) —
# no PIL/ImageMagick needed, and neither is present on Josh's hardware
# anyway (see _crop's own comment). Used to compare against the frontend's
# own reported screen size, since [Unverified→now being tested] the two may
# not be the same coordinate space at all: the frontend measures the
# GamepadUI browser window's own outerWidth/outerHeight (screen.tsx), which
# is a different thing from the physical pixels a real screen-capture tool
# like spectacle/ffmpeg actually grabs, and a mismatch there (e.g. any kind
# of DPI/compositor scaling) would make every crop land in the wrong place
# — which matches Josh's report of a cropped screenshot that's shifted
# toward the top-left with a black border, rather than showing the PiP
# picture itself.
def _png_dimensions(path: str):
    try:
        with open(path, "rb") as f:
            header = f.read(24)
        if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
            return None
        width = int.from_bytes(header[16:20], "big")
        height = int.from_bytes(header[20:24], "big")
        return (width, height)
    except Exception as e:
        decky.logger.warning(f"SteamPiP: couldn't read PNG dimensions from {path!r}: {e}")
        return None


def _resolve_screenshot_dir(save_dir: str = ""):
    # An explicit save_dir (Screenshot Settings' own custom-folder option,
    # frontend/screenshotSettingsModal.tsx) always wins over the automatic
    # guess below — someone who set one wants their PiP screenshots to go
    # there every time, not wherever the current game happens to keep its
    # own screenshots.
    save_dir = (save_dir or "").strip()
    if save_dir:
        try:
            os.makedirs(save_dir, exist_ok=True)
            return save_dir
        except Exception as e:
            decky.logger.warning(f"SteamPiP: couldn't use custom screenshot folder {save_dir!r}: {e}")
            # Falls through to the automatic guess below rather than failing
            # the whole screenshot outright over a bad custom path.

    # [Confirmed by Josh, 2026-09-20] Deliberately NOT blended into Steam's
    # own per-app userdata screenshot folders anymore — an earlier version of
    # this guessed at which of those folders belonged to "whatever's running"
    # and dropped files there, but Steam's own Screenshot Manager likely
    # tracks its screenshots via a separate manifest file (screenshots.vdf)
    # rather than just scanning the folder, so a file placed there can sit
    # correctly saved but still not show up in Steam's own UI — worse, it's
    # mixed in among real game screenshots with no easy way to tell them
    # apart. This plugin now always uses one dedicated folder of its own
    # unless a custom one is set (Screenshot Settings), and Screenshot
    # Settings' "Open Folder" button is the intended way to actually get to
    # these, not Steam's Media tab.
    fallback = os.path.join(decky.HOME, "Pictures", "SteamPiP-Screenshots")
    os.makedirs(fallback, exist_ok=True)
    return fallback


# [Confirmed by Josh, 2026-09-20] Screenshot filenames used to be just
# "steampip_<timestamp>.png" regardless of what was on screen, which meant
# finding one particular screenshot later in the save folder meant opening
# each one to check. When the frontend knows what's currently playing (guide
# data for a real live TV channel — see NowPlaying in globalState.tsx), it
# passes that show name through as show_title, and it gets folded into the
# filename instead; a channel with no guide data (YouTube, a website, etc.)
# passes an empty show_title and the filename stays exactly as before.
# Whatever's in the title is sanitized down to something safe on any
# filesystem — letters/digits/space/dash/underscore only, everything else
# (colons from a "title: subtitle" combo above all) becomes a space, runs of
# whitespace collapse to one underscore — and truncated so an unusually long
# program name can't produce an unwieldy or overlong path.
MAX_SHOW_TITLE_FILENAME_LEN = 60


def _sanitize_for_filename(show_title: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 _-]+", " ", show_title or "").strip()
    cleaned = re.sub(r"\s+", "_", cleaned)
    return cleaned[:MAX_SHOW_TITLE_FILENAME_LEN].strip("_")


# [Confirmed on Josh's own Steam Machine, 2026-09-19] Decky Loader's bundled
# Python is missing the `xml.etree` submodule entirely
# (ModuleNotFoundError: No module named 'xml.etree') — an unusual gap for
# stdlib, but that's what its own crash log showed, and importing it at all
# (even just at module load time, whether or not it's ever called) crashes
# this ENTIRE plugin's backend on startup, taking every other backend method
# down with it (guide data, export/import, and this session's new
# take_screenshot) — not just whatever function actually used it. So XMLTV
# guide feeds are parsed here with plain regexes over the raw text instead
# of a real XML parser, using only `re` (already imported, definitely
# present) and no `xml.*` or `html` import of any kind, to avoid relying on
# anything else that might be similarly trimmed from this Python build.
# This is deliberately narrow — good enough for XMLTV's own fairly
# predictable, simple tag structure, not a general-purpose XML parser (no
# CDATA, nested-tag-of-the-same-name, or malformed-XML handling).
_CHANNEL_BLOCK_RE = re.compile(r'<channel\s+id="([^"]*)"[^>]*>(.*?)</channel>', re.DOTALL | re.IGNORECASE)
_DISPLAY_NAME_RE = re.compile(r'<display-name[^>]*>(.*?)</display-name>', re.DOTALL | re.IGNORECASE)
_PROGRAMME_BLOCK_RE = re.compile(r'<programme\s+([^>]*)>(.*?)</programme>', re.DOTALL | re.IGNORECASE)
_ATTR_RE = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')
_TITLE_RE = re.compile(r'<title[^>]*>(.*?)</title>', re.DOTALL | re.IGNORECASE)
_SUBTITLE_RE = re.compile(r'<sub-title[^>]*>(.*?)</sub-title>', re.DOTALL | re.IGNORECASE)
_XML_ENTITIES = {"&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'"}
_NUMERIC_ENTITY_RE = re.compile(r'&#(x?[0-9a-fA-F]+);')


def _unescape_xml_text(text):
    if not text:
        return text
    text = text.strip()
    for entity, char in _XML_ENTITIES.items():
        text = text.replace(entity, char)

    def _num_repl(m):
        raw = m.group(1)
        try:
            code = int(raw[1:], 16) if raw[:1].lower() == "x" else int(raw)
            return chr(code)
        except ValueError:
            return m.group(0)

    return _NUMERIC_ENTITY_RE.sub(_num_repl, text)


# Parses just enough of an XMLTV feed's <channel> elements to answer "what
# display names does this channel id have" — a plain dict of
# channel_id -> [display names], mirroring what ET.Element.findall("channel")
# + .get("id") + .findall("display-name") used to give.
def _parse_xmltv_channels(text: str):
    channels = {}
    for channel_id, body in _CHANNEL_BLOCK_RE.findall(text):
        names = [_unescape_xml_text(n) for n in _DISPLAY_NAME_RE.findall(body) if n and n.strip()]
        if names:
            channels[channel_id] = names
    return channels


# Same idea for <programme> elements — a list of dicts with channel/start/
# stop/title/subtitle, mirroring the attributes and child elements the old
# ET-based code read off each <programme>.
def _parse_xmltv_programmes(text: str):
    programmes = []
    for attr_text, body in _PROGRAMME_BLOCK_RE.findall(text):
        attrs = dict(_ATTR_RE.findall(attr_text))
        title_match = _TITLE_RE.search(body)
        subtitle_match = _SUBTITLE_RE.search(body)
        programmes.append({
            "channel": attrs.get("channel", ""),
            "start": _parse_xmltv_time(attrs.get("start", "")),
            "stop": _parse_xmltv_time(attrs.get("stop", "")),
            "title": _unescape_xml_text(title_match.group(1)) if title_match else "",
            "subtitle": _unescape_xml_text(subtitle_match.group(1)) if subtitle_match else "",
        })
    return programmes


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


def _letters_only(text):
    return re.sub(r"[^a-z]", "", (text or "").lower())


# Word tokens (not raw letters) for the mid-tier checks below — splitting on
# any run of non-alphanumeric characters, so "CNN HD" -> {"cnn", "hd"} and
# "CNN International" -> {"cnn", "international"}. A handful of common
# quality/simulcast suffixes are dropped from both sides before comparing,
# since a bookmark named "CNN" has no way to know whether the guide happens
# to tag its entry "HD" or not — that's noise, not a distinguishing word.
_QUALITY_NOISE_TOKENS = {"hd", "sd", "uhd", "4k", "fhd"}


def _tokens(text):
    return set(re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).split()) - _QUALITY_NOISE_TOKENS


# Loose substring matching alone turned out not to actually catch realistic
# DVR/guide naming variants against a plain bookmark name — verified against
# real examples: "KTLA 5" vs "KTLA-HD", "KTLA 5" vs "5.1 KTLA", and "CBS 2"
# vs "CBS Los Angeles" all fail a substring check on the alphanumeric
# normalization alone, since the digits sit in different places (or are
# absent) in each name. Falling back to a letters-only comparison (numbers
# stripped from both sides entirely) catches all of those, since "ktla" and
# "cbs" end up as a clean substring of the other name's letters regardless
# of where any channel number appears. This still can't bridge a bookmark
# named after a network's brand when the guide uses different call letters
# entirely (e.g. "FOX 11" vs its real call sign "KTTV") — no shared text
# exists between those at all — which is what Bookmark.epgChannelName (an
# explicit per-channel override) is for.
#
# [Confirmed by Josh, 2026-09-20] A plain "is one a substring of the other"
# check is too loose on its own: "CNN" is a genuine substring of "CNNI",
# "CNN International", and even "NBCNN" (its own "NBC News Now" call sign,
# letters c-n-n sitting right at the end) — so a bookmark named "CNN" could
# tie with several unrelated channels at the same score, with whichever
# happened to come first in the guide feed's own channel order silently
# winning. That's exactly why the previous exact-match fix (CNN == CNN)
# didn't stick: Josh's own DVR never actually calls the real channel just
# "CNN" — its display names are "CNNHD" and "CNN HD" (confirmed from his own
# plugin log, 2026-09-20), so the bookmark's plain "CNN" never hit that
# 100-point exact-string tier at all, and fell straight through to the same
# tied 50-point substring score as CNN International and NBC News Now.
# Comparing whole words instead of raw letters/substrings fixes this: "CNN
# HD" tokenizes to {"cnn", "hd"}, and dropping the "hd" quality-suffix noise
# leaves {"cnn"} — an exact token-set match against the bookmark's own {"cnn"}
# tokens, which now outscores "CNN International"'s {"cnn", "international"}
# (only a subset match, not exact) and "NBC News Now"/"NBCNN" (no shared
# token at all — "cnn" is never a whole word in either, only letters that
# happen to sit next to each other inside "nbcnn", which the token tiers
# don't credit).
def _match_score(hay, needle):
    hay_norm, needle_norm = _normalize(hay), _normalize(needle)
    if not hay_norm or not needle_norm:
        return 0
    if hay_norm == needle_norm:
        return 100
    hay_letters, needle_letters = _letters_only(hay), _letters_only(needle)
    if hay_letters and needle_letters and hay_letters == needle_letters:
        return 95
    hay_tokens, needle_tokens = _tokens(hay), _tokens(needle)
    if hay_tokens and needle_tokens:
        if hay_tokens == needle_tokens:
            return 90
        if needle_tokens.issubset(hay_tokens):
            return 70
        if hay_tokens.issubset(needle_tokens):
            return 65
    if hay_norm in needle_norm or needle_norm in hay_norm:
        return 50
    if hay_letters and needle_letters and (hay_letters in needle_letters or needle_letters in hay_letters):
        return 40
    return 0


def _names_match(hay, needle):
    return _match_score(hay, needle) > 0


def _fetch_now_playing_map(xmltv_url: str, channel_names: list):
    # Same guide-parsing/matching logic as _fetch_now_playing, but fetches
    # and parses the XMLTV feed exactly once and answers for every requested
    # channel name in that one pass — used to annotate the whole Channel
    # dropdown with what's currently airing, which would otherwise mean one
    # full guide fetch per channel (usually the exact same URL, repeated).
    req = Request(xmltv_url, headers={"User-Agent": "SteamPiP"})
    with urlopen(req, timeout=8) as resp:
        data = resp.read()
    text = data.decode("utf-8", errors="replace")

    channel_display_names = _parse_xmltv_channels(text)
    programmes = _parse_xmltv_programmes(text)

    now = datetime.now(timezone.utc)
    current_by_channel_id = {}
    for p in programmes:
        cid = p["channel"]
        if cid in current_by_channel_id:
            continue
        start, stop = p["start"], p["stop"]
        if not start or not stop or not (start <= now <= stop):
            continue
        current_by_channel_id[cid] = {"title": p["title"], "subtitle": p["subtitle"]}

    result = {}
    for channel_name in channel_names:
        best_score = 0
        best_cid = None
        # Scored against every channel the guide knows about — not just the
        # ones that happen to have a "currently airing" entry — so a
        # diagnostic log below can tell the difference between "no exact
        # match exists" and "the exact match exists but has no current
        # programme for some other reason (its own id not matching the
        # <programme channel=...> attribute, a gap in the feed's coverage,
        # etc.)", which the previous version couldn't distinguish since it
        # filtered by current-programme presence before scoring at all.
        all_scores = []
        for cid, names in channel_display_names.items():
            score = max((_match_score(n, channel_name) for n in names), default=0)
            if score > 0:
                all_scores.append((score, cid, names, cid in current_by_channel_id))
            if score > 0 and cid in current_by_channel_id and score > best_score:
                best_score = score
                best_cid = cid
        result[channel_name] = current_by_channel_id[best_cid] if best_cid else None

        # [Diagnostic, 2026-09-20] Logged for every lookup while a real-world
        # mismatch (CNN vs CNN International) is still being tracked down —
        # shows every scored candidate and whether each one had a current
        # programme, so a wrong pick's actual cause shows up in the log
        # instead of needing another guess. Safe to remove once resolved.
        if all_scores:
            all_scores.sort(key=lambda t: t[0], reverse=True)
            decky.logger.info(
                f"SteamPiP: now-playing-batch {channel_name!r} -> "
                f"chose cid={best_cid!r} score={best_score} "
                f"result={result[channel_name]!r} | candidates="
                f"{[(s, cid, names, has_current) for s, cid, names, has_current in all_scores[:6]]}"
            )
    return result


def _fetch_now_playing(xmltv_url: str, channel_name: str):
    req = Request(xmltv_url, headers={"User-Agent": "SteamPiP"})
    with urlopen(req, timeout=8) as resp:
        data = resp.read()
    text = data.decode("utf-8", errors="replace")

    channel_display_names = _parse_xmltv_channels(text)
    programmes = _parse_xmltv_programmes(text)
    all_channel_count = len(channel_display_names)
    all_programme_count = len(programmes)
    if not _normalize(channel_name):
        return None

    # See _match_score for why this picks the single best-scoring channel
    # rather than every channel that loosely matches at all (that's what let
    # "CNN" silently match "CNN International" ahead of the real "CNN"
    # entry, whichever the guide happened to list first).
    best_score = 0
    matching_channel_ids = set()
    all_display_names = []
    for channel_id, names in channel_display_names.items():
        channel_best = 0
        for name in names:
            all_display_names.append(name)
            channel_best = max(channel_best, _match_score(name, channel_name))
        if channel_best == 0:
            continue
        if channel_best > best_score:
            best_score = channel_best
            matching_channel_ids = {channel_id}
        elif channel_best == best_score:
            matching_channel_ids.add(channel_id)

    if not matching_channel_ids:
        # Logged at warning level (not just debug) since a channel-name
        # mismatch between the bookmark and the DVR's own XMLTV feed is a
        # likely, easy-to-miss cause of "guide data never shows up" — this
        # is meant to be found in the plugin's log without needing to add
        # print statements to debug it live.
        decky.logger.warning(
            f"SteamPiP: now-playing found no channel matching {channel_name!r} "
            f"among {all_channel_count} channels in the guide. Guide's own "
            f"display-names include: {all_display_names[:20]}"
        )
        return None

    now = datetime.now(timezone.utc)
    programmes_for_channel = 0
    for p in programmes:
        if p["channel"] not in matching_channel_ids:
            continue
        programmes_for_channel += 1
        start, stop = p["start"], p["stop"]
        if not start or not stop or not (start <= now <= stop):
            continue
        return {"title": p["title"], "subtitle": p["subtitle"]}

    decky.logger.warning(
        f"SteamPiP: matched channel(s) {matching_channel_ids} for {channel_name!r}, "
        f"but none of {programmes_for_channel} programme(s) for it (of "
        f"{all_programme_count} total in the guide) cover the current time "
        f"({now.isoformat()}) — the guide feed may not cover this window, "
        f"or its <programme start>/<stop> times may parse differently than "
        f"expected."
    )
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
            decky.logger.warning(f"SteamPiP: now-playing lookup failed for {channel_name!r}: {e}", exc_info=True)
            return None

    # Same lookup as get_now_playing, but for every channel name at once,
    # fetching the guide feed only once instead of once per channel — used
    # to annotate the whole Channel dropdown with what's currently airing on
    # each one, not just whichever channel is loaded right now.
    async def get_now_playing_batch(self, xmltv_url: str, channel_names: list):
        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(None, _fetch_now_playing_map, xmltv_url, channel_names)
        except Exception as e:
            decky.logger.warning(f"SteamPiP: batch now-playing lookup failed: {e}", exc_info=True)
            return {name: None for name in channel_names}

    # The frontend's own in-panel folder/file browser needs a starting
    # location — the real user's home directory, which only the backend
    # actually knows (decky.HOME, not root's, as long as this plugin
    # doesn't request the "root" flag, which it doesn't).
    async def get_home_dir(self):
        return decky.HOME

    # Lets the frontend show (and offer to open) the actual folder
    # screenshots will save to right now, without having to duplicate
    # _resolve_screenshot_dir's own logic client-side or wait for a
    # screenshot to actually be taken first.
    async def get_screenshot_dir(self, save_dir: str = ""):
        return _resolve_screenshot_dir(save_dir)

    # Opens a folder in the desktop file manager, for Screenshot Settings'
    # "Open Folder" button. [Unverified] this only makes sense in Desktop
    # Mode — there's no file manager to open in Gaming Mode, and xdg-open
    # would either do nothing there or (worse) try to switch into Desktop
    # Mode on its own, neither of which has been tested on real hardware. Not
    # awaited on the result beyond whether the command itself launched, since
    # a file manager window is a separate, long-running process this plugin
    # has no reason to track or wait on.
    async def open_folder(self, path: str):
        try:
            path = (path or "").strip()
            if not path or not os.path.isdir(path):
                return {"error": f"Not a folder: {path!r}"}
            env = _screenshot_subprocess_env()
            result = subprocess.run(["xdg-open", path], capture_output=True, timeout=5, env=env)
            if result.returncode != 0:
                stderr = result.stderr.decode("utf-8", errors="replace")[:300]
                decky.logger.warning(f"SteamPiP: xdg-open {path!r} exited {result.returncode}: {stderr!r}")
                return {"error": f"Couldn't open folder (exit {result.returncode}): {stderr or 'unknown error'}"}
            return {"ok": True}
        except FileNotFoundError:
            return {"error": "xdg-open isn't available — this likely only works in Desktop Mode"}
        except subprocess.TimeoutExpired:
            # [Confirmed by Josh, 2026-09-20] this is exactly what happens in
            # Gaming Mode: xdg-open just hangs rather than failing fast,
            # presumably because there's no desktop session/file manager
            # running to hand the request off to.
            decky.logger.warning(f"SteamPiP: xdg-open {path!r} timed out (likely no Desktop Mode session running)")
            return {"error": "Timed out opening the folder — this only works in Desktop Mode"}
        except Exception as e:
            decky.logger.warning(f"SteamPiP: open_folder failed: {e}")
            return {"error": str(e)}

    # Lists one directory's contents for the frontend's own in-panel
    # folder/file browser (channelBackupModal.tsx). Decky's native
    # openFilePicker modal turned out not to actually render/respond when
    # opened from this plugin's Quick Access Menu panel — it silently did
    # nothing on both export and import — so export/import browse their own
    # lightweight list here instead, the same way this plugin's other
    # modals (Add/Edit Channel, Reorder, Restore Defaults) already do and
    # already work. extensions, when given, filters which FILES are shown
    # (directories always show, so navigation still works); pass None/empty
    # to show all files.
    async def list_directory(self, path: str, extensions: list | None = None):
        try:
            target = path or decky.HOME
            entries = []
            with os.scandir(target) as it:
                for entry in it:
                    try:
                        is_dir = entry.is_dir()
                    except OSError:
                        continue
                    if entry.name.startswith("."):
                        continue
                    if not is_dir and extensions:
                        lowered = entry.name.lower()
                        if not any(lowered.endswith("." + ext.lower().lstrip(".")) for ext in extensions):
                            continue
                    entries.append({"name": entry.name, "is_dir": is_dir})
            entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
            return {"path": os.path.abspath(target), "entries": entries}
        except Exception as e:
            decky.logger.warning(f"SteamPiP: list_directory failed for {path!r}: {e}")
            return {"path": path, "entries": [], "error": str(e)}

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

    # Grabs a freeze-frame of the picture as it currently looks and saves it
    # next to (or in a fallback near) wherever Steam's own screenshots for
    # the current game would land. x/y/width/height are the picture's own
    # on-screen rectangle, in the frontend's coordinate space (see
    # pipBounds.tsx).
    #
    # [Confirmed by Josh, 2026-09-20] Capture and folder placement both work
    # now, but the crop was landing in the wrong place — a black-bordered
    # corner instead of the actual picture — which is the coordinate-space
    # mismatch this docstring used to flag as [Unverified]. screen_width/
    # screen_height (the frontend's own useScreenBounds() reading, passed
    # through separately from x/y/width/height) let this method detect that
    # mismatch directly by comparing them to the real captured image's own
    # pixel dimensions, and rescale the crop rectangle to match — see the
    # scale_x/scale_y block below. [Unverified] whether this specific fix is
    # correct hasn't been confirmed on hardware yet; the diagnostic log line
    # right before the crop will show the mismatch (if any) either way.
    async def take_screenshot(self, x: int, y: int, width: int, height: int, save_dir: str = "",
                               screen_width: int = 0, screen_height: int = 0, show_title: str = ""):
        loop = asyncio.get_event_loop()

        def _do():
            with tempfile.TemporaryDirectory() as tmp:
                full_path = os.path.join(tmp, "full.png")
                tool = _capture_full_screen(full_path)
                if not tool:
                    return {"error": "No screenshot tool available on this system"}

                out_dir = _resolve_screenshot_dir(save_dir)
                sanitized_title = _sanitize_for_filename(show_title)
                filename = (
                    f"steampip_{sanitized_title}_{time.strftime('%Y%m%d_%H%M%S')}.png"
                    if sanitized_title
                    else f"steampip_{time.strftime('%Y%m%d_%H%M%S')}.png"
                )
                dest_path = os.path.join(out_dir, filename)
                # Logged clearly and separately from the return value so the
                # exact resolved folder is always in the log even if a toast
                # or frontend field gets cut off or missed. [Confirmed by
                # Josh, 2026-09-20] the full path in the toast alone wasn't
                # enough to read.
                decky.logger.info(
                    f"SteamPiP: screenshot will save to {dest_path!r} "
                    f"(requested save_dir={save_dir!r}, resolved out_dir={out_dir!r})")

                # [Confirmed by Josh, 2026-09-20 — cropped screenshots showed
                # only a black-bordered corner, not the actual picture] x/y/
                # width/height come from the frontend's own coordinate space
                # (pipBounds.tsx), which on a Steam Machine is measured from
                # the GamepadUI browser window's outerWidth/outerHeight
                # (screen.tsx) — NOT necessarily the same pixel grid a real
                # capture tool like spectacle/ffmpeg grabs. If the actual
                # captured image doesn't match the screen size the frontend
                # thought it had, every coordinate is scaled here to compensate
                # before cropping, rather than trusting them as literal pixels.
                crop_x, crop_y, crop_w, crop_h = x, y, width, height
                dims = _png_dimensions(full_path)
                if dims:
                    real_width, real_height = dims
                    decky.logger.info(
                        f"SteamPiP: captured image is {real_width}x{real_height}; "
                        f"frontend reported screen as {screen_width}x{screen_height}, "
                        f"requested crop=({x},{y},{width},{height})")
                    if screen_width > 0 and screen_height > 0 and (real_width != screen_width or real_height != screen_height):
                        scale_x = real_width / screen_width
                        scale_y = real_height / screen_height
                        crop_x = round(x * scale_x)
                        crop_y = round(y * scale_y)
                        crop_w = round(width * scale_x)
                        crop_h = round(height * scale_y)
                        decky.logger.info(
                            f"SteamPiP: screen-size mismatch detected (scale={scale_x:.4f}x{scale_y:.4f}) "
                            f"— adjusted crop to ({crop_x},{crop_y},{crop_w},{crop_h})")
                else:
                    decky.logger.warning(f"SteamPiP: couldn't read dimensions of captured screenshot {full_path!r}")

                cropped = False
                if crop_w > 0 and crop_h > 0:
                    cropped = _crop(full_path, dest_path, crop_x, crop_y, crop_w, crop_h)

                if not cropped:
                    # Cropping wasn't possible (no PIL/ImageMagick, or bad
                    # bounds) — fall back to saving the full, uncropped
                    # screenshot rather than losing the capture entirely.
                    try:
                        shutil.copyfile(full_path, dest_path)
                    except Exception as e:
                        return {"error": f"Captured but couldn't save: {e}"}

                return {"path": dest_path, "cropped": cropped, "tool": tool}

        try:
            return await loop.run_in_executor(None, _do)
        except Exception as e:
            decky.logger.warning(f"SteamPiP: screenshot failed: {e}", exc_info=True)
            return {"error": str(e)}

    async def _main(self):
        decky.logger.info("SteamPiP backend loaded")

    async def _unload(self):
        pass

    async def _uninstall(self):
        pass
