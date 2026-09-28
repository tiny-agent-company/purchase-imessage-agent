import { defineTool } from "eve/tools";
import { z } from "zod";
import { sendMedia } from "../lib/linq";
import { phoneOf } from "../lib/user";

export default defineTool({
  description:
    "Send the user an image as its own message, from an https image URL you were given by a tool result. Do not guess image URLs; if you only have a product link, use send_link instead, whose preview shows the product image.",
  inputSchema: z.object({
    image_url: z.string().url().startsWith("https://").describe("Direct https URL of a JPEG, PNG or GIF"),
  }),
  label: { start: () => "Send an image" },
  async execute({ image_url }, ctx) {
    await sendMedia(phoneOf(ctx), image_url);
    return { sent: true };
  },
});
