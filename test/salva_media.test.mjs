// Salva un file multimediale nel ramo media-social partendo da un link (richiesta del coordinatore del 9/11).
// Nessuna rete vera: un finto fetch risponde con byte inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controllaNome, controllaLink, controllaDns, tipoDalContenuto, scarica, salva, MASSIMO } from "../scripts/salva_media.mjs";

const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML = new TextEncoder().encode("<!doctype html><html>accedi</html>");

// Niente rete vera, nemmeno per il DNS: nei test «esempio.it» risolve sempre a un indirizzo pubblico inventato.
const dnsPubblico = async () => [{ address: "93.184.216.34", family: 4 }];

function finto(byte, { status = 200, url = "https://esempio.it/v.mp4", lunghezza, dns = dnsPubblico } = {}) {
  const f = async () => ({
    ok: status >= 200 && status < 300, status, url,
    headers: new Headers(lunghezza ? { "content-length": String(lunghezza) } : {}),
    body: new ReadableStream({ start(c) { c.enqueue(byte); c.close(); } }),
  });
  return { fetch: f, dns };
}

test("nomi validi: minuscole, cifre, trattini, una sottocartella al massimo", () => {
  assert.equal(controllaNome("reel-01.mp4"), "reel-01.mp4");
  assert.equal(controllaNome("tiktok/vera_conto-v3.mp4"), "tiktok/vera_conto-v3.mp4");
  assert.equal(controllaNome("copertina.JPG"), "copertina.jpg");
});

test("nomi rifiutati: percorsi strani, estensioni non ammesse, spazi", () => {
  for (const nome of ["../main.mp4", "/assoluto.mp4", "a/b/c.mp4", "video.exe", "video", "con spazio.mp4",
    ".nascosto.mp4", "a/../b.mp4", "", "x".repeat(130) + ".mp4", ".github/workflows/x.mp4"]) {
    assert.throws(() => controllaNome(nome), /nome/i, nome);
  }
});

test("link: solo https pubblico, senza credenziali", () => {
  assert.equal(controllaLink("https://esempio.it/v.mp4?x=1").hostname, "esempio.it");
  for (const link of ["http://esempio.it/v.mp4", "file:///etc/passwd", "https://utente:pw@esempio.it/v.mp4",
    "https://localhost/v.mp4", "https://127.0.0.1/v.mp4", "https://10.0.0.5/v.mp4", "https://192.168.1.2/v.mp4",
    "https://169.254.169.254/latest", "https://[::1]/v.mp4", "non un link"]) {
    assert.throws(() => controllaLink(link), /link/i, link);
  }
});

test("dns: un nome che risolve a un indirizzo pubblico va bene, uno privato o il metadati del cloud no", async () => {
  await controllaDns("esempio.it", async () => [{ address: "93.184.216.34", family: 4 }]);
  for (const indirizzi of [
    [{ address: "169.254.169.254", family: 4 }], // metadati del cloud: esattamente il caso del CISO 10/11
    [{ address: "10.0.0.5", family: 4 }],
    [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }], // basta un indirizzo privato tra tanti
    [{ address: "::1", family: 6 }],
    [],
  ]) {
    await assert.rejects(controllaDns("finto.it", async () => indirizzi), /non pubblico|risolvibile/);
  }
  await assert.rejects(controllaDns("non-esiste.invalid", async () => { throw new Error("ENOTFOUND"); }), /risolvibile/);
});

test("dns: i siti veri rispondono anche in IPv6 pubblico (Canva, Drive, GitHub) e vanno accettati", async () => {
  await controllaDns("export-download.canva.com", async () => [
    { address: "104.16.103.112", family: 4 },
    { address: "2606:4700::6810:6770", family: 6 },
  ]);
  await controllaDns("drive.usercontent.google.com", async () => [{ address: "2a00:1450:4002:410::2001", family: 6 }]);
  for (const privato of [
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", // locale, link-local, privato, multicast
    "::ffff:169.254.169.254", "::ffff:10.0.0.5", "64:ff9b::a9fe:a9fe", // IPv4 travestito da IPv6
    "2002:a9fe:a9fe::1", "2001:0:4136:e378::1", "2001:db8::1", // 6to4, Teredo, documentazione
  ]) {
    await assert.rejects(controllaDns("finto.it", async () => [{ address: privato, family: 6 }]), /non pubblico/, privato);
  }
});

test("scarica: rifiuta un dominio che sembra pubblico ma risolve a un indirizzo privato (DNS rebinding)", async () => {
  const { fetch: f } = finto(MP4);
  await assert.rejects(
    scarica("https://esempio.it/v.mp4", { fetch: f, dns: async () => [{ address: "169.254.169.254", family: 4 }] }),
    /non pubblico/,
  );
});

test("scarica: controlla anche l'indirizzo del dominio dopo un reindirizzamento", async () => {
  const dns = async (host) => (host === "esempio.it" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
  const { fetch: f } = finto(MP4, { url: "https://interno.evil.test/v.mp4" });
  await assert.rejects(scarica("https://esempio.it/v.mp4", { fetch: f, dns }), /non pubblico/);
});

test("il contenuto deve essere davvero un video o un'immagine", () => {
  assert.equal(tipoDalContenuto(MP4), "mp4");
  assert.equal(tipoDalContenuto(WEBM), "webm");
  assert.equal(tipoDalContenuto(JPG), "jpg");
  assert.equal(tipoDalContenuto(PNG), "png");
  assert.equal(tipoDalContenuto(HTML), null);
});

test("scarica: errore HTTP, file troppo grande o pagina html vengono rifiutati", async () => {
  await assert.rejects(scarica("https://esempio.it/v.mp4", finto(MP4, { status: 404 })), /404/);
  await assert.rejects(scarica("https://esempio.it/v.mp4", finto(MP4, { lunghezza: MASSIMO + 1 })), /grande/);
  await assert.rejects(scarica("https://esempio.it/v.mp4", { ...finto(MP4), massimo: 4 }), /grande/);
  await assert.rejects(scarica("https://esempio.it/v.mp4", finto(MP4, { url: "http://esempio.it/v.mp4" })), /link/i);
  const byte = await scarica("https://esempio.it/v.mp4", finto(MP4));
  assert.deepEqual(byte, MP4);
});

test("salva: scrive il file nella cartella del ramo se il tipo corrisponde all'estensione", async () => {
  const cartella = mkdtempSync(join(tmpdir(), "media-"));
  const esito = await salva("https://esempio.it/v.mp4", "reel/prova.mp4", cartella, finto(MP4));
  assert.equal(esito.percorso, "reel/prova.mp4");
  assert.equal(esito.link, "https://raw.githubusercontent.com/giuseppemazzacuva34-ai/presente/media-social/reel/prova.mp4");
  assert.deepEqual(new Uint8Array(readFileSync(join(cartella, "reel/prova.mp4"))), MP4);
});

test("salva: rifiuta tipo diverso dall'estensione, pagine html e file già esistenti", async () => {
  const cartella = mkdtempSync(join(tmpdir(), "media-"));
  await assert.rejects(salva("https://esempio.it/v", "a.png", cartella, finto(MP4)), /tipo/);
  await assert.rejects(salva("https://esempio.it/v", "b.mp4", cartella, finto(HTML)), /tipo/);
  assert.equal(existsSync(join(cartella, "b.mp4")), false);
  writeFileSync(join(cartella, "c.mp4"), "vecchio");
  await assert.rejects(salva("https://esempio.it/v", "c.mp4", cartella, finto(MP4)), /esiste/);
  assert.equal(readFileSync(join(cartella, "c.mp4"), "utf8"), "vecchio");
});
