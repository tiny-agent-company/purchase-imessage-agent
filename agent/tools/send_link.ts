import { defineTool } from "eve/tools";
import { z } from "zod";
import { sendCard } from "../lib/linq";
import { phoneOf } from "../lib/user";

// A link goes out as a native card (Linq's `link` experience) with the
// product's name and price as our own copy and a button that opens the page.
// The card is the whole message, so nothing can be glued to the URL.

export default defineTool({
  description:
    "Send the user a product page as a native card (name, price, an Open button) in its own bubble. Only for URLs that came back from a tool result (a product url or a cart item url); never a URL you composed yourself.",
  inputSchema: z.object({
    url: z.string().url().describe("The exact url from a buy result"),
    title: z.string().max(64).optional().describe("The product name from the same buy result, shortened to 64 characters"),
    subtitle: z.string().max(120).optional().describe("The price and merchant, e.g. \"$24.99 at Amazon\""),
  }),
  label: { start: ({ url }) => `Send card ${new URL(url).hostname}` },
  async execute({ url, title, subtitle }, ctx) {
    await sendCard(await phoneOf(ctx), { url, title, subtitle, button: "Open" });
    return { sent: true };
  },
});
