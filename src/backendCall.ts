import { call } from "@decky/api";

// Wraps @decky/api's `call` with a hard timeout. Export/Import silently
// doing nothing (after the toast diagnostic added this round confirmed the
// button's click handler DOES fire) and guide data silently never showing
// up both point the same way: a `call` to a backend method that Decky
// Loader's Python process doesn't actually have registered — e.g. because
// that process is still running old code from before this plugin was last
// updated, and only a full Decky Loader restart (not just reinstalling the
// plugin zip) reloads it — doesn't necessarily reject right away. It can
// just hang forever with no error at all, silently blocking whatever the
// UI was waiting on (a modal that never opens, a guide lookup that never
// finishes). This turns that silent, permanent hang into an explicit,
// actionable timeout instead, so at minimum the UI can recover and say
// what's wrong rather than doing nothing forever.
export class BackendTimeoutError extends Error {
    constructor(method: string) {
        super(`"${method}" didn't respond in time. Steam PiP's backend may need Decky Loader restarted (not just the plugin reinstalled) to pick up recent changes.`);
        this.name = "BackendTimeoutError";
    }
}

// Most backend calls here are quick lookups, so 5s is plenty and a longer
// wait would just delay noticing a genuinely-unregistered method. A couple
// of calls do real, possibly-slow work instead — take_screenshot tries up
// to 6 different screenshot tools in turn, each allowed up to 10s, before
// giving up — so those pass a longer timeoutMs explicitly rather than
// tripping this generic one while still legitimately working.
export const backendCall = <A extends unknown[], R>(method: string, ...args: A): Promise<R> =>
    backendCallWithTimeout<A, R>(5000, method, ...args);

export const backendCallWithTimeout = <A extends unknown[], R>(timeoutMs: number, method: string, ...args: A): Promise<R> => {
    return Promise.race([
        call<A, R>(method, ...args),
        new Promise<R>((_, reject) =>
            setTimeout(() => reject(new BackendTimeoutError(method)), timeoutMs)),
    ]);
};
