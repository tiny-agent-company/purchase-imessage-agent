# purchase-imessage-agent

An iMessage agent that shops at real merchants through [Agentcard's Purchase API](https://docs.agentcard.sh/vault/integrations/ecommerce-apis/purchase-api) and pays with the user's own card from the Agentcard Vault.

Built from [vault-imessage-agent](https://github.com/tiny-agent-company/vault-imessage-agent): same stack, plus the purchase loop.

- **[eve](https://github.com/vercel/eve)** (Vercel's agent framework) runs the agent and hosts it on Vercel.
- **[Linq](https://linqapp.com)** gives the agent a phone number and delivers iMessage/SMS in and out.
- **Agentcard** signs the user up through the Vault link (no code: the linked session is exchanged for the user's tokens), builds the cart at the merchant, and charges the vaulted card after a passkey approval.
- **Upstash Redis** remembers the user's connection and which conversation sent each Vault link.

The step-by-step guide lives at [docs.agentcard.sh → Guides → Integrate the Purchase API into an iMessage agent](https://docs.agentcard.sh/guides/integrate-the-purchase-api-into-an-imessage-agent).

## What is in here

```
agent/
  agent.ts                    model (Vercel AI Gateway id)
  instructions.md             how the agent shops: connect once, ask → cart → confirm
  channels/linq.ts            inbound iMessage/SMS via Linq webhooks
  channels/agentcard.ts       POST /agentcard/webhooks: on vault.session_linked the session is exchanged for the user's tokens; card-stored and checkout-approval events wake the conversation
  lib/agentcard.ts            org token + user-token calls (/buy runs as the user)
  lib/user.ts                 the phone behind the conversation, connection refresh
  lib/linq.ts                 texts a message from the agent's Linq number
  lib/store.ts                Upstash Redis: connections, connect attempts, vault sessions
  tools/connect_user.ts       POST /api/v2/connect/start → Agentcard texts a code
  tools/verify_code.ts        POST /api/v2/connect/verify → the user token buy runs as
  tools/buy.ts                POST /buy: ask, follow up, confirm a cart hash; texts the approval link and remembers the authorization
  tools/create_vault_link.ts  Vault link bound to the connected user, texted as its own message
  tools/check_vault_session.ts GET /api/v2/vault_sessions/:id
```

## Run it

```bash
npm install
cp .env.example .env.local   # fill in Linq + Agentcard credentials, Redis
npm run dev                  # eve terminal UI
npm run deploy               # eve deploy → Vercel
```

The Linq channel needs `LINQ_API_KEY` at build time, so add the Vercel env vars before the first deploy (`npx eve link`, then `vercel env add …`). After the first deploy, create a Linq webhook (`message.received`) and an Agentcard webhook endpoint (`vault.card_stored`, `vault.session_linked`, `checkout_authorization.approved`, `.declined`, `.expired`) pointing at the deployment, store their secrets, and deploy once more.

## Environment

| Variable | From |
| --- | --- |
| `LINQ_API_KEY` | Linq dashboard → Developer Tools → Your API Token |
| `LINQ_WEBHOOK_SECRET` | Returned once when you create the Linq webhook subscription |
| `AGENTCARD_CLIENT_ID` / `AGENTCARD_CLIENT_SECRET` | Shown during Agentcard onboarding; later under Settings → Developers → Credentials |
| `AGENTCARD_MODE` | `sandbox` (default; connect code is always `111111`, confirm ends in `sandbox_mode`) or `production` |
| `AGENTCARD_WEBHOOK_SECRET` | Returned once by `POST /api/v2/webhook_endpoints` for `https://<deployment>/agentcard/webhooks` |

## How the approval comes back

A confirm with `payment_source: "vault"` pauses with an `approval_url`. `buy` texts it as its own message and stores `authorization_id → { conversation, cart hash }` in Redis (`auth:<cauth_id>`, 20 minutes). When the user approves on their phone, Agentcard sends `checkout_authorization.approved` to `/agentcard/webhooks`; the channel looks the authorization up, wakes the paused conversation with an `[Agentcard]` message carrying the hash, and the agent repeats the confirm without the user texting "done". `declined` and `expired` arrive the same way and become one plain sentence to the user.

Agentcard also places the order itself the instant the approval lands, so a confirm that arrives while that placement is still running comes back as an uncoded `status: "error"`. `buy` waits twelve seconds and reads `GET /buy/conversations/{id}` before it reports: an entry in `orders` is reported as placed.
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis (Vercel Marketplace or console.upstash.com) |
| `STORE_PREFIX` | Optional key prefix when several agents share one Redis |

The model runs through the Vercel AI Gateway (`agent/agent.ts`). On Vercel it authenticates with the project's OIDC token; locally, run `npm run dev` and sign in with `/login`.
