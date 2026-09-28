// Minimal Linq Partner API client, used to text a link as its own message.
// The model never handles the URL, so nothing can get glued onto it.

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
