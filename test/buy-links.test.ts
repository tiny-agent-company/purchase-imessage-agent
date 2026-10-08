import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalIdFromUrl, connectUrlFromText } from "../agent/lib/buy-links.ts";

// Finding C regression: the approval link moved to the short /a/<id>.<secret> form,
// where the authorization id is in the PATH, not the query. The old code read only
// searchParams.get("id") → null → rememberApproval skipped → the approved webhook
// could not wake the conversation. These pin both link shapes.

test("new short /a/cauth_<id>.<secret> link → bare cauth id (matches the webhook authorization_id)", () => {
  assert.equal(
    approvalIdFromUrl(
      "https://app.agentcard.sh/a/cauth_dbd30c233ff223f908294563.2spc2vuB3uPDfVoJKi-v6g?amount=818&merchant=DoorDash",
    ),
    "cauth_dbd30c233ff223f908294563",
  );
});

test("new /a/ link without query params still parses", () => {
  assert.equal(
    approvalIdFromUrl("https://app.agentcard.sh/a/cauth_dbd30c233ff223f908294563.secrettoken"),
    "cauth_dbd30c233ff223f908294563",
  );
});

test("old /authorize?id=cauth_<id> link → query id (unchanged)", () => {
  assert.equal(
    approvalIdFromUrl("https://vault.agentcard.sh/authorize?id=cauth_abc123def456"),
    "cauth_abc123def456",
  );
});

test("a connect link (no authorization id) → null", () => {
  assert.equal(approvalIdFromUrl("https://app.agentcard.sh/connect/mZUlW0pBmqoFaHL_jgycTg"), null);
});

test("a non-URL string → null (no throw)", () => {
  assert.equal(approvalIdFromUrl("not a url"), null);
});

// Finding A: the DoorDash connect link rides only in the buy loop's reply/narration
// prose (no structured field), and the model is told never to relay a URL. These pin
// that buy.ts can still recover it to dispatch its own bubble.

test("connectUrlFromText: pulls the connect link out of the reply prose", () => {
  const reply =
    "You'll need to sign in to DoorDash first. Give the user this one link to connect DoorDash: https://app.agentcard.sh/connect/mZUlW0pBmqoFaHL_jgycTg";
  assert.equal(connectUrlFromText(reply), "https://app.agentcard.sh/connect/mZUlW0pBmqoFaHL_jgycTg");
});

test("connectUrlFromText: finds it across joined narration segments", () => {
  const joined = ["Let me check that store.", "https://app.agentcard.sh/connect/OYZfzI_fbrbCnLqSDm92pg — sign in here."].join("\n");
  assert.equal(connectUrlFromText(joined), "https://app.agentcard.sh/connect/OYZfzI_fbrbCnLqSDm92pg");
});

test("connectUrlFromText: ignores a non-connect agentcard URL (e.g. an approval link)", () => {
  assert.equal(
    connectUrlFromText("Approve here: https://app.agentcard.sh/a/cauth_dbd30c233ff223f908294563.secret"),
    null,
  );
});

test("connectUrlFromText: null/empty prose → null", () => {
  assert.equal(connectUrlFromText(null), null);
  assert.equal(connectUrlFromText(""), null);
  assert.equal(connectUrlFromText("no link here, just words"), null);
});
