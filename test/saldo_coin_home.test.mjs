// Coin e saldo del design v4 (issue #349), passo 2 della linea «sviluppatore-b»: il saldo dei Coin compare nella
// testata appena l'app si apre e si rilegge quando si torna sull'app. Il numero lo dà sempre il server; in beta i Coin
// sono un contatore interno (nessun pagamento). Pagina finta, saldo finto, nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collegaSaldo } from "../landing/app/moduli/saldo_coin.js";

function paginaFinta(stato = "visible") {
  const ascolti = {};
  return {
    visibilityState: stato,
    addEventListener(nome, f) { (ascolti[nome] ||= []).push(f); },
    lancia(nome) { (ascolti[nome] || []).forEach((f) => f()); },
    ascolti,
  };
}
function saldoFinto() {
  const s = { volte: 0, async aggiorna() { s.volte += 1; return { ok: true, saldo: 120 }; } };
  return s;
}

test("legge il saldo subito all'avvio", async () => {
  const saldo = saldoFinto();
  await collegaSaldo({ saldo, pagina: paginaFinta() });
  assert.equal(saldo.volte, 1);
});

test("rilegge quando si torna sull'app, non quando la si lascia", async () => {
  const saldo = saldoFinto();
  const pagina = paginaFinta();
  await collegaSaldo({ saldo, pagina });
  pagina.visibilityState = "hidden";
  pagina.lancia("visibilitychange");
  await new Promise((r) => setImmediate(r));
  assert.equal(saldo.volte, 1);
  pagina.visibilityState = "visible";
  pagina.lancia("visibilitychange");
  await new Promise((r) => setImmediate(r));
  assert.equal(saldo.volte, 2);
});

test("un errore di lettura non ferma l'app", async () => {
  const saldo = { async aggiorna() { throw new Error("rete"); } };
  const r = await collegaSaldo({ saldo, pagina: paginaFinta() });
  assert.equal(r.ok, false);
});

test("senza saldo o pagina non fa niente", async () => {
  assert.equal((await collegaSaldo({})).ok, false);
  assert.equal((await collegaSaldo()).ok, false);
});

test("avvio: il saldo si collega con creaCoin e aggiornaTestata, solo dopo l'accesso", () => {
  const avvio = readFileSync(new URL("../landing/app/avvio.js", import.meta.url), "utf8");
  assert.match(avvio, /import \{ creaSaldo, collegaSaldo \} from "\/app\/moduli\/saldo_coin\.js";/);
  assert.match(avvio, /import \{ aggiornaTestata \} from "\/app\/moduli\/testata\.js";/);
  assert.match(avvio, /collegaSaldo\(\{ saldo: creaSaldo\(\{ coin: creaCoin\(\{ token: \(\) => accesso\.token\(\)/);
  assert.match(avvio, /testata: \(dati\) => aggiornaTestata\(document, dati\)/);
  // dentro preparaAccesso, dopo il controllo di ACCESSO_APP: prima del «return {}» dell'anteprima non c'è
  const i = avvio.indexOf("collegaSaldo({");
  assert.ok(i > avvio.indexOf("config.accesso !== true"));
  assert.ok(i < avvio.indexOf("return { aiuto, accesso"));
});
