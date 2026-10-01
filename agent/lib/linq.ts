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

/** Send an image (any https URL) to `to` as its own bubble. */
export async function sendMedia(to: string, url: string): Promise<void> {
  await linq("POST", "/chats", {
    from: await senderNumber(),
    to: [to],
    message: { parts: [{ type: "media", url }] },
  });
}
