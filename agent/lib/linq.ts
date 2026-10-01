// Minimal Linq Partner API client. Text, rich link cards and photos each go
// out as their own message part; the model never handles a URL, so nothing
// can get glued onto it.

const LINQ_API = "https://api.linqapp.com/api/partner/v3";

let fromNumber: string | undefined = process.env.LINQ_PHONE_NUMBER;

async function linq<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${LINQ_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.LINQ_API_KEY}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Linq ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** The agent's own Linq number: LINQ_PHONE_NUMBER, or the first number on the account. */
async function senderNumber(): Promise<string> {
  if (fromNumber) return fromNumber;
  const { phone_numbers } = await linq<{ phone_numbers: { phone_number: string }[] }>("GET", "/phone_numbers");
  const first = phone_numbers[0]?.phone_number;
  if (!first) throw new Error("No phone number on this Linq account");
  fromNumber = first;
  return first;
}

/** Text `text` to `to` (E.164) as a standalone message. */
export async function sendText(to: string, text: string): Promise<void> {
  await linq("POST", "/chats", {
    from: await senderNumber(),
    to: [to],
    message: { parts: [{ type: "text", value: text }] },
  });
}

/**
 * Send a URL as a `link` part: Linq renders it as a rich card (title,
 * description and image from the page's OpenGraph tags) instead of a bare URL
 * the phone has to preview itself. A link part must be the only part in its
 * message, which is also why the model never gets to put words around it.
 */
export async function sendLink(to: string, url: string): Promise<void> {
  await linq("POST", "/chats", {
    from: await senderNumber(),
    to: [to],
    message: { parts: [{ type: "link", value: url }] },
  });
}

export interface Card {
  url: string;
  /** Up to 64 characters. */
  title?: string;
  /** Up to 120 characters. */
  subtitle?: string;
  /** The button label, up to 24 characters. */
  button?: string;
}

/**
 * Send a native card: Linq's `link` experience (`action: "open"`), rendered by
 * Linq's iMessage app with the title, subtitle and button we choose, opening
 * our URL on tap, inside the Linq extension's web view. That web view has no
 * WebAuthn, so anything that needs a passkey (the Vault link, the approval)
 * goes as a `link` part instead and opens Safari. A card is the whole
 * message. A recipient without the Linq app sees a static version built from
 * the same copy; an SMS recipient cannot receive one, so the caller falls
 * back to `sendLink` when Linq refuses.
 */
export async function sendCard(to: string, card: Card): Promise<void> {
  const params: Record<string, string> = { url: card.url };
  if (card.title) params.title = card.title.slice(0, 64);
  if (card.subtitle) params.subtitle = card.subtitle.slice(0, 120);
  if (card.button) params.button = card.button.slice(0, 24);
  try {
    await linq("POST", "/chats", {
      from: await senderNumber(),
      to: [to],
      message: { experience: { name: "link", action: "open", params } },
    });
  } catch (e) {
    // iMessage only (Linq errors 2018 / 4005 for SMS and RCS): the rich link
    // card still carries the URL.
    if (/2018|4005|iMessage/i.test(String(e))) return sendLink(to, card.url);
    throw e;
  }
}

export interface VaultBubble {
  /** The Vault link itself (`/v?vs=…` or `/authorize?id=…`). */
  url: string;
  /** The bubble's caption, also used when the recipient has no iMessage app. */
  caption: string;
  subcaption?: string;
}

const IMESSAGE_APP = process.env.AGENTCARD_IMESSAGE_TEAM_ID && process.env.AGENTCARD_IMESSAGE_BUNDLE_ID
  ? {
      name: "Agentcard",
      team_id: process.env.AGENTCARD_IMESSAGE_TEAM_ID,
      bundle_id: process.env.AGENTCARD_IMESSAGE_BUNDLE_ID,
      ...(process.env.AGENTCARD_IMESSAGE_APP_STORE_ID ? { app_store_id: process.env.AGENTCARD_IMESSAGE_APP_STORE_ID } : {}),
    }
  : undefined;

/** Where a recipient without the app gets it: a TestFlight link now, the App Store page once listed. */
const INSTALL_URL = process.env.AGENTCARD_IMESSAGE_INSTALL_URL;

/**
 * What a recipient sees when Messages cannot render the bubble: no app
 * installed and no App Store id to offer. The Vault link still works in
 * Safari, and the install link gets them the bubble next time.
 */
function fallbackText(bubble: VaultBubble): string {
  const lines = [`${bubble.caption}: ${bubble.url}`];
  if (INSTALL_URL) lines.push(`Get Agentcard for Messages to do this without leaving the chat: ${INSTALL_URL}`);
  return lines.join("\n\n");
}

/**
 * Send a Vault link as an Agentcard bubble: an `imessage_app` part naming the
 * Agentcard iMessage app (apps/agentcard-imessage), with the Vault link as
 * its state URL. Tapping it opens the Vault page inside Messages with the
 * passkey served natively, so Face ID works without leaving the thread.
 *
 * A recipient without the app sees Messages' own "Get the app" card when
 * AGENTCARD_IMESSAGE_APP_STORE_ID is set, and otherwise the fallback text:
 * the Vault link (works in Safari) plus the install link when
 * AGENTCARD_IMESSAGE_INSTALL_URL is set. Without AGENTCARD_IMESSAGE_TEAM_ID /
 * _BUNDLE_ID the link goes out as a plain `link` part and opens in Safari.
 */
export async function sendVaultBubble(to: string, bubble: VaultBubble): Promise<void> {
  if (!IMESSAGE_APP) return sendLink(to, bubble.url);
  try {
    await linq("POST", "/chats", {
      from: await senderNumber(),
      to: [to],
      message: {
        parts: [
          {
            type: "imessage_app",
            app: IMESSAGE_APP,
            url: bubble.url,
            fallback_text: fallbackText(bubble),
            interactive: true,
            layout: { caption: bubble.caption, ...(bubble.subcaption ? { subcaption: bubble.subcaption } : {}) },
          },
        ],
      },
    });
  } catch (e) {
    if (/2018|4005|iMessage/i.test(String(e))) return sendLink(to, bubble.url);
    throw e;
  }
}

/** Send an image (any https URL) to `to` as its own bubble. */
export async function sendMedia(to: string, url: string): Promise<void> {
  await linq("POST", "/chats", {
    from: await senderNumber(),
    to: [to],
    message: { parts: [{ type: "media", url }] },
  });
}
