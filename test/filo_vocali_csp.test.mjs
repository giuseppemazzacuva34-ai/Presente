// Il vocale del Filo si ascolta con un link firmato del contenitore privato di Supabase (schermata 18, «Il vocale del
// Filo» nella stanza, pannello dell'amministratore). Il lettore <audio> è governato da media-src della CSP dell'app:
// senza il dominio di Supabase il browser blocca il vocale (verificato con Chromium: violazione «media-src»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CSP_APP } from "../worker/app.js";

const direttiva = (nome) => (CSP_APP.split("; ").find((d) => d.startsWith(`${nome} `)) || "").split(" ").slice(1);

test("CSP dell'app: media-src ammette i link firmati di Supabase, come connect-src", () => {
  assert.ok(direttiva("media-src").includes("https://*.supabase.co"));
  assert.ok(direttiva("connect-src").includes("https://*.supabase.co"));
});

test("CSP dell'app: media-src non si allarga oltre il necessario", () => {
  assert.deepEqual(direttiva("media-src"), ["'self'", "blob:", "https://*.supabase.co"]);
});
