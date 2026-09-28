import { defineTool } from "eve/tools";
import { z } from "zod";
import { sendText } from "../lib/linq";
import { phoneOf } from "../lib/user";

// A link sent alone is a link iMessage previews: title, image, domain. Text
// glued to it becomes part of the link, so it always goes as its own bubble.

export default defineTool({
  description:
    "Send the user a link as its own message, so their phone shows a preview with the product image. Only for URLs that came back from a tool result (a product url or a cart item url); never a URL you composed yourself.",
  inputSchema: z.object({
    url: z.string().url().describe("The exact url from a buy result"),
  }),
  label: { start: ({ url }) => `Send link ${new URL(url).hostname}` },
  async execute({ url }, ctx) {
    await sendText(phoneOf(ctx), url);
    return { sent: true };
  },
});
