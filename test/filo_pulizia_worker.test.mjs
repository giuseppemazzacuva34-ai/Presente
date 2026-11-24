// Pulizia dei vocali del Filo 7 giorni dopo la chiusura (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 11b della
// linea «sviluppatore-c». Ogni ora il Worker: elenco dal database (vocali_filo_scaduti) → cancella i file dal
// contenitore privato «vocali_filo» → toglie le righe (togli_vocali_filo). Se i file non si cancellano, le righe
// restano e si riprova al giro dopo. Rete finta: nessun dato reale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pulisciVocaliFilo } from "../worker/filo_pulizia.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const env = (extra = {}) => ({ ACCESSO_APP: "si", SUPABASE_URL: BASE + "/", SUPABASE_SERVICE_ROLE_KEY: "chiave-finta", ...extra });
const P1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/a1.webm";
const P2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/a2.webm";

function supabaseFinto({ elenco = [{ percorso: P1 }, { percorso: P2 }], cancella = 200, togli = 2, elencoStato = 200 } = {}) {
  const viste = [];
  const f = async (url, opz = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new Error("rete assente");
    viste.push({ percorso: u.pathname, metodo: opz.method || "GET", headers: opz.headers || {}, corpo: opz.body ? JSON.parse(opz.body) : null, signal: opz.signal });
    if (u.pathname === "/rest/v1/rpc/vocali_filo_scaduti") return elencoStato === 200 ? Response.json(elenco) : new Response("{}", { status: elencoStato });
    if (u.pathname === "/storage/v1/object/vocali_filo") return cancella === 200 ? Response.json([]) : new Response("{}", { status: cancella });
    if (u.pathname === "/rest/v1/rpc/togli_vocali_filo") return Response.json(togli);
    return new Response("{}", { status: 404 });
  };
  return { f, viste, dove: (p) => viste.filter((v) => v.percorso === p) };
}

test("senza Supabase configurato: spenta, nessuna richiesta", async () => {
  for (const e of [env({ SUPABASE_URL: "" }), env({ SUPABASE_SERVICE_ROLE_KEY: "" }), env({ SUPABASE_URL: "https://altro.example.com" }), null]) {
    const s = supabaseFinto();
    assert.deepEqual(await pulisciVocaliFilo(e, s.f), { esito: "spento" });
    assert.equal(s.viste.length, 0);
  }
});

test("gira anche con l'app spenta: è una cancellazione a tutela dei dati, non mostra nulla a nessuno", async () => {
  const s = supabaseFinto({ elenco: [] });
  assert.deepEqual(await pulisciVocaliFilo(env({ ACCESSO_APP: "no" }), s.f), { esito: "fatto", tolti: 2 });
});

test("ordine: elenco → cancella i file dal contenitore → toglie le righe di quei file", async () => {
  const s = supabaseFinto();
  assert.deepEqual(await pulisciVocaliFilo(env(), s.f), { esito: "fatto", tolti: 2 });
  assert.deepEqual(s.viste.map((v) => v.percorso), ["/rest/v1/rpc/vocali_filo_scaduti", "/storage/v1/object/vocali_filo", "/rest/v1/rpc/togli_vocali_filo"]);
  const [elenco, file, togli] = s.viste;
  assert.ok(!Number.isNaN(Date.parse(elenco.corpo.p_ora)));
  assert.equal(file.metodo, "DELETE");
  assert.deepEqual(file.corpo, { prefixes: [P1, P2] });
  assert.deepEqual(togli.corpo.p_percorsi, [P1, P2]);
  assert.equal(togli.corpo.p_ora, elenco.corpo.p_ora);
  for (const v of s.viste) {
    assert.equal(v.headers.authorization, "Bearer chiave-finta");
    assert.ok(v.signal, "ogni richiesta ha un tempo massimo");
  }
});

test("nessun vocale scaduto: niente cancellazione di file, ma «vista» e «ascoltato» si puliscono lo stesso", async () => {
  const s = supabaseFinto({ elenco: [], togli: 0 });
  assert.deepEqual(await pulisciVocaliFilo(env(), s.f), { esito: "fatto", tolti: 0 });
  assert.equal(s.dove("/storage/v1/object/vocali_filo").length, 0);
  assert.deepEqual(s.dove("/rest/v1/rpc/togli_vocali_filo")[0].corpo.p_percorsi, []);
});

test("file non cancellati: le righe restano (nessun file orfano), si riprova al giro dopo", async () => {
  const s = supabaseFinto({ cancella: 500 });
  assert.deepEqual(await pulisciVocaliFilo(env(), s.f), { esito: "errore" });
  assert.equal(s.dove("/rest/v1/rpc/togli_vocali_filo").length, 0);
});

test("elenco strano o database giù: nessuna eccezione, nessuna cancellazione", async () => {
  for (const opz of [{ elencoStato: 500 }, { elenco: {} }, { elenco: [{ percorso: "../fuori" }] }, { elenco: [{ percorso: 3 }] }]) {
    const s = supabaseFinto(opz);
    assert.deepEqual(await pulisciVocaliFilo(env(), s.f), { esito: "errore" }, JSON.stringify(opz));
    assert.equal(s.dove("/storage/v1/object/vocali_filo").length, 0);
  }
  assert.deepEqual(await pulisciVocaliFilo(env(), async () => { throw new Error("rete"); }), { esito: "errore" });
});

test("nei log solo numeri e codici, mai percorsi o testi; il Worker la chiama ogni ora", async () => {
  const righe = [];
  const prima = [console.log, console.error];
  console.log = (...a) => righe.push(a.join(" "));
  console.error = (...a) => righe.push(a.join(" "));
  try {
    await pulisciVocaliFilo(env(), supabaseFinto().f);
    await pulisciVocaliFilo(env(), supabaseFinto({ cancella: 500 }).f);
  } finally {
    [console.log, console.error] = prima;
  }
  assert.ok(righe.length > 0);
  for (const r of righe) assert.ok(!/aaaaaaaa|webm|chiave/.test(r), r);
  const indice = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  assert.match(indice, /import \{ pulisciVocaliFilo \} from "\.\/filo_pulizia\.js";/);
  assert.match(indice, /const vocaliFilo = pulisciVocaliFilo\(env\);[^\n]*\n    if \(ctx && ctx\.waitUntil\) ctx\.waitUntil\(vocaliFilo\);\n    else await vocaliFilo;\n  \},/);
  // Non sul cron degli avvisi di ogni minuto: sta dopo il ritorno anticipato di CRON_AVVISI.
  assert.ok(indice.indexOf("pulisciVocaliFilo(env)") > indice.indexOf("evento.cron === CRON_AVVISI"));
});
