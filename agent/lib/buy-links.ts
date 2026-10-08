// Pure URL helpers for the buy tool's link handling. No framework imports, so the
// logic is unit-testable on its own (test/buy-links.test.ts).

/**
 * The authorization id inside an approval link, or null when the link carries none.
 *
 * Two shapes exist:
 *   - old:  https://vault.agentcard.sh/authorize?id=cauth_<id>   (id in the query)
 *   - new:  https://app.agentcard.sh/a/cauth_<id>.<secret>       (id in the path, before the secret)
 *
 * The approved webhook's `authorization_id` is the bare `cauth_<id>` with no secret, so
 * read the query first, then the `/a/` path segment up to its first dot. A link that
 * carries the id only in its path (the new short form) used to return null here, so
 * rememberApproval was skipped and the approved webhook could not wake the conversation.
 */
export function approvalIdFromUrl(approvalUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(approvalUrl);
  } catch {
    return null;
  }
  const fromQuery = u.searchParams.get("id");
  if (fromQuery) return fromQuery;
  if (u.pathname.startsWith("/a/")) {
    const seg = decodeURIComponent(u.pathname.slice(3)).split("/")[0] ?? "";
    const id = seg.split(".")[0];
    return id || null;
  }
  return null;
}

/**
 * The merchant-connect link inside the buy loop's reply/narration prose, or null.
 *
 * When the user must sign in to a merchant (e.g. DoorDash) before an order can be
 * placed, the backend buy loop returns the one-time connect link ONLY inside its
 * reply/messages text ("Give the user this one link to connect <merchant>: <url>");
 * the /buy response carries no structured field for it. The iMessage model is told
 * never to relay a URL, so the link is dropped unless the tool dispatches it itself.
 * This extracts it so buy.ts can send it as its own bubble, the way the approval link
 * already goes out. Matches only an Agentcard /connect/<code> link, so it never picks
 * up an unrelated URL in the prose.
 */
export function connectUrlFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s"'<>]*agentcard\.sh\/connect\/[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}
