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
 * our URL on tap. A card is the whole message. A recipient without the Linq
 * app sees a static version built from the same copy; an SMS recipient cannot
 * receive one, so the caller falls back to `sendLink` when Linq refuses.
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

/** Send an image (any https URL) to `to` as its own bubble. */
export async function sendMedia(to: string, url: string): Promise<void> {
  await linq("POST", "/chats", {
    from: await senderNumber(),
    to: [to],
    message: { parts: [{ type: "media", url }] },
  });
}
