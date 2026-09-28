# vault-imessage-agent

The smallest iMessage agent that can enroll a user's card in the [Agentcard Vault](https://docs.agentcard.sh/vault/quickstart).

- **[eve](https://github.com/vercel/eve)** (Vercel's agent framework) runs the agent and hosts it on Vercel.
- **[Linq](https://linqapp.com)** gives the agent a phone number and delivers iMessage/SMS in and out.
- **Agentcard** issues the Vault link; the user stores a card once and approves each later purchase with Face ID or Touch ID. Its webhook tells the agent the moment the card is stored, and the agent says so in the thread.
- **Upstash Redis** (one click on the Vercel Marketplace) remembers which conversation sent each link, so the webhook can find it.

This repo is a blueprint. Clone it, drop in two sets of credentials, deploy. The step-by-step guide lives at [docs.agentcard.sh → Guides → Create an iMessage agent and connect the Vault](https://docs.agentcard.sh/guides/create-an-imessage-agent-and-connect-the-vault).

## What is in here

```
agent/
  agent.ts                    model (Vercel AI Gateway id)
  instructions.md             how the agent talks and when it enrolls a card
  channels/linq.ts            inbound iMessage/SMS via Linq webhooks
  lib/agentcard.ts            client-credentials token + fetch wrapper
  lib/linq.ts                 texts a message from the agent's Linq number
  lib/store.ts                Upstash Redis: vault session id → eve session id
  channels/agentcard.ts       POST /agentcard/webhooks: verifies the signature, wakes the conversation
  tools/create_vault_link.ts  POST /api/v2/vault_sessions → texts the link as its own message
  tools/check_vault_session.ts GET /api/v2/vault_sessions/:id → pending | linked | expired
```

## Run it

```bash
npm install
cp .env.example .env.local   # fill in Linq + Agentcard credentials
npm run dev                  # eve terminal UI; chat with the agent locally
npm run deploy               # eve deploy → Vercel
```

The Linq channel needs `LINQ_API_KEY` at build time, so add the Vercel env vars before the first deploy (`npx eve link`, then `vercel env add …`). After the first deploy, create a Linq webhook subscription (`message.received`) pointing at `https://<your-deployment>/eve/v1/linq`, store the returned `whsec_` as `LINQ_WEBHOOK_SECRET`, and deploy once more.

## Environment

| Variable | From |
| --- | --- |
| `LINQ_API_KEY` | Linq dashboard → Developer Tools → Your API Token (sandbox: dashboard.linqapp.com/sandbox) |
| `LINQ_WEBHOOK_SECRET` | Returned once when you create the webhook subscription |
| `AGENTCARD_CLIENT_ID` / `AGENTCARD_CLIENT_SECRET` | Shown during Agentcard onboarding; later under Settings → Developers → Credentials |
| `AGENTCARD_WEBHOOK_SECRET` | Returned once by `POST /api/v2/webhook_endpoints` for `https://<deployment>/agentcard/webhooks` |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Set by the Vercel Marketplace when you add Upstash for Redis |

The model runs through the Vercel AI Gateway (`agent/agent.ts`). On Vercel it authenticates with the project's OIDC token; locally, run `npm run dev` and sign in with `/login`.
