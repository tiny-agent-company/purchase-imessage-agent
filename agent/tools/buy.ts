import { defineTool } from "eve/tools";
import { z } from "zod";
import { agentcardAs, AgentcardError } from "../lib/agentcard";
import { phoneOf, userToken } from "../lib/user";
import { sendText } from "../lib/linq";
import { catalogFor, rememberCatalog, type Product } from "../lib/store";

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
    const phone = phoneOf(ctx);
    const conn = await userToken(phone);
    if (!conn) return { status: "not_connected", next: "Call connect_user, then verify_code with the code the user texts." };

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

    // The approval link goes out from here, alone in its own bubble. Handed to
    // the model it ends up inside a sentence, and a link with words glued to
    // it is a broken link on the phone.
    let approvalLinkSent = false;
    if (r.approval_url) {
      await sendText(phone, r.approval_url);
      approvalLinkSent = true;
    }

    return {
      status: r.status,
      conversation_id: r.conversation_id,
      reply: r.reply,
      cart: r.cart ? summarize(r.cart) : null,
      products,
      approval_link_sent: approvalLinkSent || undefined,
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
