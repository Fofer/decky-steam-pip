import { Bookmark } from "./globalState";

// This is a public TEMPLATE, checked into git as-is (empty), so a plain
// clone of this repo always builds. It's where one person's own private
// channel presets/guide URL can live locally without ever being committed:
//
//   1. Edit this file on your own machine with your own channels/guide URL.
//   2. Run `git update-index --skip-worktree src/personalBookmarks.tsx`.
//      That tells git to ignore further changes to this file here — it
//      won't show up in `git status` or get swept into a future commit,
//      the same way a gitignored file wouldn't, except it's tracked so a
//      normal clone doesn't fail to build without it.
//
// Whatever's listed here is seeded into the local build's bookmarks once
// (see index.tsx) and from then on behaves like any other bookmark —
// editable, reorderable, deletable, and (once deleted) stays gone, same as
// the curated defaults.

// Optional: a single XMLTV guide feed URL applied to every channel that
// doesn't set its own (see globalState's defaultEpgUrl). Leave empty if you
// don't have one.
export const PERSONAL_DEFAULT_EPG_URL = "";

export const PERSONAL_BOOKMARKS: Bookmark[] = [];
