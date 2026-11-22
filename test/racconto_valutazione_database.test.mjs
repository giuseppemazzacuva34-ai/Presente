// «Sì, racconto» dopo «No» alla sicurezza nella valutazione (issue #6 spec v1 punto 4 «Valutazione (D20)» e #7 spec
// v1.1 «Priorità»; passo 3g della linea «sviluppatore-b»). Il racconto si aggiunge alla segnalazione da 1 ora già
// partita (passo 16b), senza crearne un'altra. Si legge solo il testo della migrazione; il comportamento vero lo prova
// supabase/test/prova_racconto_valutazione.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => /^\d{14}_racconto_valutazione\.sql$/.test(n));
const sql = file ? readFileSync(new URL(file, cartella), "utf8") : "";
const codice = sql.replace(/--.*$/gm, "");

test("la migrazione del racconto esiste", () => assert.ok(file, "manca supabase/migrations/*_racconto_valutazione.sql"));

test("una sola funzione nuova, nessun SQL distruttivo", () => {
  assert.match(codice, /create function public\.racconta_valutazione\(p_porta uuid, p_persona uuid, p_testo text\) returns text/);
  assert.doesNotMatch(codice, /\bdrop\s+(table|function|column)\b|\btruncate\b|\bdelete\s+from\b|\balter table\b|\binsert into\b/i);
});

test("aggiorna solo la segnalazione «non al sicuro» della valutazione, ancora aperta e senza racconto", () => {
  assert.match(codice, /motivo = 'non_al_sicuro'/);
  assert.match(codice, /origine = 'valutazione'/);
  assert.match(codice, /esito is null/);
  assert.match(codice, /update public\.segnalazioni set testo/);
});

test("racconto di 1000 caratteri al massimo, come il modulo di segnalazione", () => assert.match(codice, /> 1000/));

test("funzione chiusa al telefono, solo il server", () => {
  assert.match(codice, /revoke all on function public\.racconta_valutazione\(uuid, uuid, text\) from public, anon, authenticated/);
  assert.match(codice, /grant execute on function public\.racconta_valutazione\(uuid, uuid, text\) to service_role/);
  assert.doesNotMatch(codice, /grant [^;]* to (anon|authenticated)/);
});
