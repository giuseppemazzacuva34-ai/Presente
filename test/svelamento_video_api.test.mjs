// Svelamento, passo 7c (issue #65, D48 A; linea «sviluppatore»): richieste video del Worker /app/api/svelamento
// «pubblica», «ricevi», «conferma» e «vista». Valgono SOLO dopo entra_svelamento → «iniziato_video» per la persona del
// token; le sessioni le tiene il Durable Object `Svelamento` (qui il suo gestore vero con un archivio in memoria).
// Nessuna rete vera: Supabase e Cloudflare Realtime sono finti. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { svelamentoApi, PERCORSO_SVELAMENTO } from "../worker/svelamento_api.js";
import { GestoreSvelamento } from "../api/svelamento_do.js";

const BASE = "https://abcdefghijklmnopqrst.supabase.co";
const RTC = "https://rtc.live.cloudflare.com";
const APP = "0123456789abcdef0123456789abcdef";
const IO = "11111111-2222-4333-8444-555555555555";
const LEI = "66666666-7777-4888-9999-000000000000";
const PORTA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SITO = "https://presenteincontri.app";

const TESTA = ["v=0", "o=- 1 2 IN IP4 127.0.0.1", "s=-", "t=0 0", ""].join("\r\n");
const sez = (tipo, mid, dir = "sendonly") => [`m=${tipo} 9 UDP/TLS/RTP/SAVPF ${tipo === "audio" ? 111 : 96}`, `a=mid:${mid}`, `a=${dir}`, ""].join("\r\n");
const OFFERTA = { type: "offer", sdp: TESTA + sez("audio", "0") + sez("video", "1") + "a=x:" + "y".repeat(3000) + "\r\n" };
const RISPOSTA_CF = TESTA + sez("audio", "0", "recvonly") + sez("video", "1", "recvonly");
const SESSIONE_SDP = TESTA + sez("audio", "0") + sez("video", "1") + sez("audio", "2", "recvonly") + sez("video", "3", "recvonly");
const RISPOSTA_TEL = { type: "answer", sdp: SESSIONE_SDP };

function archivio() {
  const dati = new Map();
  return {
    async get(k) { return dati.has(k) ? structuredClone(dati.get(k)) : undefined; },
    async put(k, v) {
      if (typeof k === "object") for (const [a, b] of Object.entries(k)) dati.set(a, structuredClone(b));
      else dati.set(k, structuredClone(v));
    },
    async deleteAll() { dati.clear(); },
    async setAlarm() {},
    async deleteAlarm() {},
  };
}

// Mondo finto: chi è il token, cosa risponde entra_svelamento a ciascuno, Realtime e i Durable Object per porta.
function mondo({ entra = { [IO]: "iniziato_video", [LEI]: "iniziato_video" } } = {}) {
  const viste = [];
  const chiuse = [];
  let n = 0;
  const gestori = new Map();
  const f = async (url, opzioni = {}) => {
    const u = new URL(url);
    const corpo = opzioni.body ? JSON.parse(opzioni.body) : null;
    viste.push({ origine: u.origin, percorso: u.pathname, corpo, auth: opzioni.headers?.authorization });
    if (u.origin === BASE && u.pathname === "/auth/v1/user") {
      const id = opzioni.headers.authorization === "Bearer token-di-lei.prova.firma12345" ? LEI : IO;
      return Response.json({ id });
    }
    if (u.origin === BASE && u.pathname === "/rest/v1/rpc/entra_svelamento") return Response.json(entra[corpo.p_persona]);
    if (u.origin === RTC) {
      if (u.pathname.endsWith("/sessions/new")) return Response.json({ sessionId: `sessioneProva${++n}xx` });
      if (u.pathname.endsWith("/tracks/new") && corpo.sessionDescription) {
        return Response.json({ sessionDescription: { type: "answer", sdp: RISPOSTA_CF }, tracks: [{ mid: "0" }, { mid: "1" }] });
      }
      if (u.pathname.endsWith("/tracks/new")) {
        return Response.json({ sessionDescription: { type: "offer", sdp: SESSIONE_SDP }, tracks: [{ mid: "2" }, { mid: "3" }] });
      }
      if (u.pathname.endsWith("/renegotiate")) return Response.json({});
      if (u.pathname.endsWith("/tracks/close")) return Response.json({ tracks: [] });
    }
    throw new Error("rete assente");
  };
  const SVELAMENTO = {
    idFromName: (nome) => "id:" + nome,
    get: (id) => {
      if (!gestori.has(id)) {
        gestori.set(id, new GestoreSvelamento({
          storage: archivio(),
          chiudiSessione: async (sessione, mids) => { chiuse.push({ sessione, mids }); return { ok: true }; },
        }));
      }
      return gestori.get(id);
    },
  };
  const env = {
    ACCESSO_APP: "si", SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "chiave-server-finta",
    REALTIME_APP_ID: APP, REALTIME_APP_SECRET: "segreto-di-prova-non-reale", SVELAMENTO,
  };
  return {
    env, f, viste, chiuse, gestori,
    rtc: () => viste.filter((v) => v.origine === RTC),
    entra: () => viste.filter((v) => v.percorso === "/rest/v1/rpc/entra_svelamento"),
  };
}

function chiedi(m, corpo, chi = "io") {
  const token = chi === "lei" ? "token-di-lei.prova.firma12345" : "token-mio.prova.firma12345";
  const r = new Request(SITO + PERCORSO_SVELAMENTO, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ porta: PORTA, ...corpo }),
  });
  return svelamentoApi(r, m.env, m.f).then(async (x) => ({ stato: x.status, j: await x.json() }));
}

test("pubblica: dopo «iniziato_video» crea la sessione, pubblica voce + video e ridà la risposta di Cloudflare", async () => {
  const m = mondo();
  const { stato, j } = await chiedi(m, { azione: "pubblica", offerta: OFFERTA });
  assert.equal(stato, 200);
  assert.equal(j.ok, true);
  assert.deepEqual(j.descrizione, { type: "answer", sdp: RISPOSTA_CF });
  assert.equal(j.vista.fase, "attesa");
  assert.deepEqual(m.entra()[0].corpo, { p_porta: PORTA, p_persona: IO });
  const nuova = m.rtc().find((v) => v.percorso.endsWith("/tracks/new"));
  assert.deepEqual(nuova.corpo.tracks.map((t) => t.trackName), ["voce", "video"]);
  assert.equal(JSON.stringify(j).includes("sessioneProva"), false); // mai id di sessione al telefono
});

test("prima dell'inizio, con le foto o fuori dalla porta: niente Realtime", async () => {
  const casi = [
    ["in_attesa", 200, "non_iniziato"], ["non_ancora", 200, "non_iniziato"], ["iniziato_foto", 200, "foto"],
    ["non_nella_porta", 404, "non_trovata"], ["porta_chiusa", 200, "porta_chiusa"], [null, 503, "riprova"],
  ];
  for (const [esito, codice, motivo] of casi) {
    for (const azione of ["pubblica", "ricevi", "conferma", "vista"]) {
      const m = mondo({ entra: { [IO]: esito } });
      const { stato, j } = await chiedi(m, { azione, offerta: OFFERTA, risposta: RISPOSTA_TEL });
      assert.equal(stato, codice, `${esito} ${azione}`);
      assert.equal(j.ok, false);
      assert.equal(j.motivo, motivo, `${esito} ${azione}`);
      assert.equal(m.rtc().length, 0);
      assert.equal(m.gestori.size, 0);
    }
  }
});

test("pubblica: un'offerta senza video, con due fotocamere o mancante è rifiutata prima di Realtime", async () => {
  for (const offerta of [
    { type: "offer", sdp: TESTA + sez("audio", "0") },
    { type: "offer", sdp: TESTA + sez("audio", "0") + sez("video", "1") + sez("video", "2") },
    { type: "answer", sdp: OFFERTA.sdp },
    undefined,
  ]) {
    const m = mondo();
    const { stato, j } = await chiedi(m, { azione: "pubblica", offerta });
    assert.equal(stato, 400);
    assert.equal(j.motivo, "svelamento");
    assert.equal(m.rtc().length, 0);
  }
});

test("ricevi: prima che l'altra persona pubblichi «in_attesa»; dopo, l'offerta di Cloudflare con voce e video", async () => {
  const m = mondo();
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA });
  const prima = await chiedi(m, { azione: "ricevi" });
  assert.deepEqual([prima.j.ok, prima.j.motivo], [false, "in_attesa"]);
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA }, "lei");
  const { stato, j } = await chiedi(m, { azione: "ricevi" });
  assert.equal(stato, 200);
  assert.equal(j.ok, true);
  assert.deepEqual(j.descrizione, { type: "offer", sdp: SESSIONE_SDP });
  const remota = m.rtc().filter((v) => v.percorso.endsWith("/tracks/new")).at(-1);
  assert.deepEqual(remota.corpo.tracks.map((t) => [t.location, t.sessionId, t.trackName]), [
    ["remote", "sessioneProva2xx", "voce"], ["remote", "sessioneProva2xx", "video"],
  ]);
  assert.ok(remota.percorso.includes("/sessions/sessioneProva1xx/"));
  assert.equal(JSON.stringify(j).includes("sessioneProva"), false);
});

test("conferma: i 10 secondi partono solo quando tutti e due hanno confermato; «vista» lo dice a chi aspetta", async () => {
  const m = mondo();
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA });
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA }, "lei");
  await chiedi(m, { azione: "ricevi" });
  await chiedi(m, { azione: "ricevi" }, "lei");
  const mia = await chiedi(m, { azione: "conferma", risposta: RISPOSTA_TEL });
  assert.equal(mia.j.ok, true);
  assert.equal(mia.j.vista.fase, "attesa");
  const sua = await chiedi(m, { azione: "conferma", risposta: RISPOSTA_TEL }, "lei");
  assert.equal(sua.j.vista.fase, "in_corso");
  assert.equal(sua.j.vista.fine - sua.j.vista.inizio, 10000);
  const v = await chiedi(m, { azione: "vista" });
  assert.equal(v.j.ok, true);
  assert.equal(v.j.vista.fase, "in_corso");
  const rinegoziate = m.rtc().filter((x) => x.percorso.endsWith("/renegotiate"));
  assert.equal(rinegoziate.length, 2);
});

test("conferma senza aver chiesto di ricevere, o con una risposta non valida: rifiutata", async () => {
  const m = mondo();
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA });
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA }, "lei");
  const senza = await chiedi(m, { azione: "conferma", risposta: RISPOSTA_TEL });
  assert.equal(senza.j.ok, false);
  await chiedi(m, { azione: "ricevi" });
  const cattiva = await chiedi(m, { azione: "conferma", risposta: { type: "answer", sdp: TESTA + sez("audio", "0") } });
  assert.equal(cattiva.stato, 400);
  assert.equal(cattiva.j.motivo, "svelamento");
});

test("pubblica dopo la fine: il Durable Object rifiuta e la sessione appena aperta si chiude subito", async () => {
  const m = mondo();
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA });
  const g = m.env.SVELAMENTO.get(m.env.SVELAMENTO.idFromName(PORTA));
  const stato = await g.storage.get("stato");
  stato.finitoIl = Date.now();
  await g.storage.put("stato", stato);
  const { j } = await chiedi(m, { azione: "pubblica", offerta: OFFERTA });
  assert.deepEqual([j.ok, j.motivo], [false, "finito"]);
  const chiusa = m.rtc().find((v) => v.percorso.endsWith("/tracks/close"));
  assert.ok(chiusa.percorso.includes("/sessions/sessioneProva2xx/"));
  assert.deepEqual(chiusa.corpo.tracks, [{ mid: "0" }, { mid: "1" }]);
});

test("la persona la dice solo il token: una «persona» nel corpo non conta", async () => {
  const m = mondo();
  await chiedi(m, { azione: "pubblica", offerta: OFFERTA, persona: LEI, p_persona: LEI });
  assert.deepEqual(m.entra()[0].corpo, { p_porta: PORTA, p_persona: IO });
});
