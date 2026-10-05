/**
 * Telling "there is nothing" apart from "we could not find out".
 *
 * The recurring bug in this app has been the same shape in nine places: a
 * request fails, a `catch` turns the failure into an empty array, and something
 * downstream renders that empty array as a confident statement. A 500 on
 * `GET /tasks` became a full-looking task list. A 401 on the reminder fetch
 * became "No reminder yet, will remind at scheduled time". The `catch` was not
 * lying on purpose, it simply had no way to express the difference it was
 * sitting on, so every call site had to decide for itself, and five of them
 * decided wrong.
 *
 * `Loaded` is that missing vocabulary. `empty` and `failed` are separate cases,
 * so collapsing them into each other stops being something you can write by
 * accident. A caller is handed the difference instead of inferring it from a
 * caught exception.
 *
 * This is deliberately a union rather than an exception hierarchy. Throwing is
 * what made the mistake invisible: the information was available on the
 * exception object but nothing forced anyone to look at it, and `catch {}` with
 * an empty body is a perfectly valid-looking statement that discards it.
 */
export type Loaded<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** The request succeeded and there is genuinely nothing to show. */
  | { readonly kind: "empty" }
  /**
   * The request did not succeed. `status` is the HTTP code when there was one,
   * and null for a network failure or an aborted request.
   *
   * `authExpired` is separated out because a 401 or 403 is not a generic
   * failure: it means the session is no good and the user has to sign in again.
   * Folding it into `failed` is how an expired token came to look like a
   * working app serving cached data.
   *
   * `stale` marks the one case where real data is being shown anyway: the
   * request failed at the network level and cached data is standing in. It is
   * deliberately visible rather than silent, because a screen showing saved data
   * should say so instead of looking current.
   */
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly status: number | null;
      readonly authExpired: boolean;
      readonly stale?: boolean;
    };

export function loaded<T>(value: T): Loaded<T> {
  return { kind: "ok", value };
}

/**
 * Success that might be empty.
 *
 * Empty collections are a legitimate success, not a failure, and they render
 * differently: "you have no tasks" is good news, "we could not load your tasks"
 * is an error banner. Only the caller knows which screen it is on, so this
 * distinction is made once here and applied there.
 */
export function loadedOrEmpty<T>(value: T[]): Loaded<T[]> {
  return value.length === 0 ? { kind: "empty" } : { kind: "ok", value };
}

export function failed(reason: string, status: number | null): Loaded<never> {
  return {
    kind: "failed",
    reason,
    status,
    authExpired: status === 401 || status === 403,
  };
}

/**
 * The error message to show, or null when there is nothing to report.
 *
 * Lets a component ask "should I show an error banner" without inspecting the
 * union by hand at every call site.
 */
export function failureMessage<T>(result: Loaded<T>): string | null {
  if (result.kind !== "failed") return null;
  if (result.authExpired) return "Your session has expired. Sign in again.";
  return result.reason;
}

/** Whether the user must sign in again before anything else will work. */
export function needsSignIn<T>(result: Loaded<T>): boolean {
  return result.kind === "failed" && result.authExpired;
}

/**
 * The value on success, `fallback` on anything else.
 *
 * For the cases where showing stale or partial data is genuinely better than
 * showing nothing. Prefer this over touching `.value` directly, because it
 * makes "we fell back" explicit at the call site instead of letting `[]` slip
 * through looking like real data. If a caller needs to know it fell back, match
 * on `kind` first.
 */
export function valueOr<T>(result: Loaded<T>, fallback: T): T {
  return result.kind === "ok" ? result.value : fallback;
}