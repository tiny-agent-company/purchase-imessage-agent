import { defineTool } from "eve/tools";
import { z } from "zod";
import { sendLink } from "../lib/linq";
import { phoneOf } from "../lib/user";

// A link goes out as a Linq `link` part: a rich card with the page's title,
// image and domain, built by Linq from the page's OpenGraph tags. A link part
// is always the only part in its message, so nothing can be glued to the URL.

export default defineTool({
  description:
    "Send the user a link as a rich card (title, product image, domain) in its own bubble. Only for URLs that came back from a tool result (a product url or a cart item url); never a URL you composed yourself.",
  inputSchema: z.object({
    url: z.string().url().describe("The exact url from a buy result"),
  }),
  label: { start: ({ url }) => `Send link ${new URL(url).hostname}` },
  async execute({ url }, ctx) {
    await sendLink(await phoneOf(ctx), url);
    return { sent: true };
  },
});
