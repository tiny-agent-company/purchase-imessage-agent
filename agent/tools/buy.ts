import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcardAs, AgentcardError } from "../lib/agentcard";
import { phoneOf, userToken } from "../lib/user";
import { sendLink, sendCard } from "../lib/linq";
import { catalogFor, rememberApproval, rememberCatalog, type Product } from "../lib/store";
import { approvalIdFromUrl, connectUrlFromText } from "../lib/buy-links";

// One turn of Agentcard's Purchase API (POST /buy): an ask builds or refines
// a cart at a real merchant; a confirm places it. Runs as the connected user.

interface Cart {
  merchant: string;
  merchant_name: string;
  items: { name: string; qty: number; priceCents: number; product_id?: string }[];
  serviceFeesCents?: number;
  tipCents?: number;
  totalCents: number;
  hash: string;
}

interface CatalogItem {
  id: string;
  name?: string;
  priceCents?: number;
  image_url?: string;
}

interface BuyResponse {
  conversation_id: string;
  catalog?: { merchant_name?: string; items?: CatalogItem[] } | null;
  status: "needs_input" | "order_placed" | "partially_placed" | "declined";
  reply: string | null;
  // Multi-bubble surfaces (the iMessage relay) also get the turn split into ordered
  // narration segments. A merchant-connect link can ride in one of these rather than
  // the final reply, so the connect-link dispatch scans them too.
  messages?: string[] | null;
  cart: Cart | null;
  carts?: Cart[];
  unmatched?: { requested?: string; reason?: string; detail?: string }[];
  order_id: string | null;
  payment_source: { source: string; brand?: string; last4?: string } | null;
  decline_code: string | null;
  approval_url: string | null;
  charge_status: string | null;
  error_code?: string | null;
}

const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//.test(v);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default defineTool({
  description:
    "Shop through Agentcard's Purchase API at real merchants (Amazon, Walmart, Target, Best Buy, DoorDash and more). Send what the user wants as `ask`; keep the same conversation_id for follow-ups. When a cart is shown and the user agrees, send its `confirm` hash instead of an ask. Requires a connected user (connect_user + verify_code); returns not_connected otherwise.",
  inputSchema: z.object({
    ask: z.string().optional().describe("What the user wants, in their words, or their answer to the previous reply"),
    conversation_id: z.string().optional().describe("Continue this purchase conversation; omit to start a new one"),
    confirm: z.string().optional().describe("The cart hash to place, from a previous result; omit ask when confirming"),
  }),
  label: {
    start: ({ ask, confirm }) => (confirm ? "Place the order" : `Shop: ${(ask ?? "").slice(0, 60)}`),
  },
  async execute({ ask, conversation_id, confirm }, ctx) {
    const phone = await phoneOf(ctx);
    const conn = await userToken(phone);
    if (!conn) return { status: "not_connected", next: "New user: call create_vault_link; storing a card through it connects them with no code. Only when a webhook said their account already existed: connect_user, then verify_code." };

    const body: Record<string, unknown> = {};
    if (conversation_id) body.conversation_id = conversation_id;
    if (confirm) {
      body.confirm = confirm;
      body.payment_source = "vault"; // the user's own card, approved with their passkey
    } else {
      body.ask = ask;
    }

    let r: BuyResponse;
    try {
      r = await agentcardAs<BuyResponse>(conn.access_token, "POST", "/buy", body);
    } catch (e) {
      // A confirm whose price or address moved comes back 409 with a fresh
      // cart; hand that to the model like any other turn.
      if (e instanceof AgentcardError && e.status === 409 && typeof e.body === "object" && e.body) {
        const b = e.body as Partial<BuyResponse> & { code?: string; error?: string };
        return {
          status: "cart_changed",
          code: b.code ?? b.error,
          conversation_id: b.conversation_id,
          cart: b.cart ? summarize(b.cart) : null,
        };
      }
      throw e;
    }

    // Product ids are the merchant's own links (for Amazon, the /dp URL) and
    // image_url is the product photo. They are the ONLY links and images the
    // agent may send; it must never make one up. A turn that does not search
    // again returns no catalog, so the last search is kept per conversation.
    let products: Product[] | undefined;
    if (r.catalog?.items?.length) {
      products = r.catalog.items.slice(0, 8).map((i) => ({
        name: i.name,
        price: i.priceCents != null ? money(i.priceCents) : undefined,
        ...(isUrl(i.id) ? { url: i.id } : { id: i.id }),
        ...(isUrl(i.image_url) ? { image_url: i.image_url } : {}),
      }));
      await rememberCatalog(r.conversation_id, products);
    } else {
      products = (await catalogFor(r.conversation_id)) ?? undefined;
    }

    // Agentcard places a vault order itself the instant the approval lands, and
    // a confirm that arrives while that placement is still running is turned
    // away with decline_code `in_progress` (older deployments: an uncoded
    // status error) rather than placed twice. Give it a moment and read the
    // conversation back before telling the user anything. The order that
    // belongs to THIS checkout is last_checkout's; orders[] lists every order
    // of the conversation oldest first, so its first entry can be an earlier
    // purchase.
    const inProgress = r.decline_code === "in_progress" || ((r.status as string) === "error" && !r.decline_code);
    if (confirm && inProgress) {
      await new Promise((res) => setTimeout(res, 12_000));
      const conv = await agentcardAs<{
        orders?: { order_id?: string | null; status?: string; merchant_name?: string }[];
        last_checkout?: (Partial<BuyResponse> & { order_id?: string | null }) | null;
      }>(conn.access_token, "GET", `/buy/conversations/${encodeURIComponent(r.conversation_id)}`);
      const orderId =
        conv.last_checkout?.order_id ??
        conv.orders?.filter((o) => o.status !== "failed" && o.status !== "cancelled").at(-1)?.order_id ??
        undefined;
      if (orderId) {
        return { status: "order_placed", conversation_id: r.conversation_id, order_id: orderId, cart: r.cart ? summarize(r.cart) : null, note: "Placed by Agentcard when the approval landed." };
      }
      if (conv.last_checkout && (conv.last_checkout.status as string) !== "error") r = { ...r, ...conv.last_checkout } as BuyResponse;
    }

    // The approval link goes out from here, alone in its own bubble. Handed
    // to the model it ends up inside a sentence, and a link with words glued
    // to it is a broken link on the phone.
    let approvalLinkSent = false;
    if (r.approval_url) {
      // Send the approval as a Linq rich-link CARD (sendCard) — the only form Linq forwards
      // to the line. Verified live: a sendLink link-part AND a plain-text URL both get DROPPED
      // Linq->AgentPhone (cart-update texts arrive, but a URL does not unless it rides a card).
      // A link-part card is built by Linq fetching the URL for OG tags, which fails for the
      // app.agentcard.sh/a/<token> short link (no renderable page, unlike /connect); sendCard
      // builds the card from OUR explicit title/subtitle/button, so it delivers no matter what
      // the short link renders. This is how the approval delivered before #5152. amount +
      // merchant stay on the URL for the approve page.
      const cents = r.cart?.totalCents;
      const merchant = r.cart?.merchant_name;
      const approvalUrl = new URL(r.approval_url);
      if (typeof cents === "number") approvalUrl.searchParams.set("amount", String(cents));
      if (merchant) approvalUrl.searchParams.set("merchant", merchant);
      await sendCard(phone, {
        url: approvalUrl.toString(),
        title: typeof cents === "number" ? `Approve ${money(cents)}${merchant ? ` at ${merchant}` : ""}` : "Approve this purchase",
        subtitle: "Approve with Face ID or Touch ID.",
        button: "Approve",
      });
      approvalLinkSent = true;
      // When Agentcard's webhook says this authorization was approved, the
      // conversation resumes on its own with the same confirm. The id sits in
      // the query on the old approval link and in the path on the new short one
      // (/a/cauth_<id>.<secret>); approvalIdFromUrl reads both, so the approved
      // webhook can find this pending confirm and wake the conversation.
      const id = approvalIdFromUrl(r.approval_url);
      if (id && confirm) await rememberApproval(id, { eveSessionId: ctx.session.id, conversationId: r.conversation_id, hash: confirm });
    }

    // A merchant-connect link (e.g. DoorDash sign-in) comes back ONLY inside the
    // reply/narration prose — the /buy response has no structured field for it — and
    // the model is told never to relay a URL, so it would be dropped and the user left
    // stuck. Dispatch it as its own link bubble (opens in Safari; the connect page needs
    // no passkey, unlike the Vault/approval bubble) whenever a turn carries one.
    let connectLinkSent = false;
    const connectUrl = connectUrlFromText([r.reply, ...(r.messages ?? [])].filter(Boolean).join("\n"));
    if (connectUrl) {
      await sendLink(phone, connectUrl);
      connectLinkSent = true;
    }

    return {
      status: r.status,
      conversation_id: r.conversation_id,
      reply: r.reply,
      cart: r.cart ? summarize(r.cart) : null,
      products,
      approval_link_sent: approvalLinkSent || undefined,
      connect_link_sent: connectLinkSent || undefined,
      unmatched: r.unmatched?.length ? r.unmatched : undefined,
      decline_code: r.decline_code ?? undefined,
      order_id: r.order_id ?? undefined,
      charge_status: r.charge_status ?? undefined,
      payment_source: r.payment_source ?? undefined,
      error_code: r.error_code ?? undefined,
    };
  },
});

function summarize(c: Cart) {
  return {
    merchant: c.merchant_name,
    items: c.items.map((i) => ({ line: `${i.qty} × ${i.name} (${money(i.priceCents)})`, ...(isUrl(i.product_id) ? { url: i.product_id } : {}) })),
    fees: c.serviceFeesCents ? money(c.serviceFeesCents) : undefined,
    total: money(c.totalCents),
    hash: c.hash,
  };
}
