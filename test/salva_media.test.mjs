// Salva un file multimediale nel ramo media-social partendo da un link (richiesta del coordinatore del 9/11).
// Nessuna rete vera: un finto fetch risponde con byte inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controllaNome, controllaLink, tipoDalContenuto, scarica, salva, MASSIMO } from "../scripts/salva_media.mjs";

const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HTML = new TextEncoder().encode("<!doctype html><html>accedi</html>");

function finto(byte, { status = 200, url = "https://esempio.it/v.mp4", lunghezza } = {}) {
  return async () => ({
    ok: status >= 200 && status < 300, status, url,
    headers: new Headers(lunghezza ? { "content-length": String(lunghezza) } : {}),
    body: new ReadableStream({ start(c) { c.enqueue(byte); c.close(); } }),
  });
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

test("il contenuto deve essere davvero un video o un'immagine", () => {
  assert.equal(tipoDalContenuto(MP4), "mp4");
  assert.equal(tipoDalContenuto(WEBM), "webm");
  assert.equal(tipoDalContenuto(JPG), "jpg");
  assert.equal(tipoDalContenuto(PNG), "png");
  assert.equal(tipoDalContenuto(HTML), null);
});

test("scarica: errore HTTP, file troppo grande o pagina html vengono rifiutati", async () => {
  await assert.rejects(scarica("https://esempio.it/v.mp4", { fetch: finto(MP4, { status: 404 }) }), /404/);
  await assert.rejects(scarica("https://esempio.it/v.mp4", { fetch: finto(MP4, { lunghezza: MASSIMO + 1 }) }), /grande/);
  await assert.rejects(scarica("https://esempio.it/v.mp4", { fetch: finto(MP4), massimo: 4 }), /grande/);
  await assert.rejects(scarica("https://esempio.it/v.mp4", { fetch: finto(MP4, { url: "http://esempio.it/v.mp4" }) }), /link/i);
  const byte = await scarica("https://esempio.it/v.mp4", { fetch: finto(MP4) });
  assert.deepEqual(byte, MP4);
});

test("salva: scrive il file nella cartella del ramo se il tipo corrisponde all'estensione", async () => {
  const cartella = mkdtempSync(join(tmpdir(), "media-"));
  const esito = await salva("https://esempio.it/v.mp4", "reel/prova.mp4", cartella, { fetch: finto(MP4) });
  assert.equal(esito.percorso, "reel/prova.mp4");
  assert.equal(esito.link, "https://raw.githubusercontent.com/giuseppemazzacuva34-ai/presente/media-social/reel/prova.mp4");
  assert.deepEqual(new Uint8Array(readFileSync(join(cartella, "reel/prova.mp4"))), MP4);
});

test("salva: rifiuta tipo diverso dall'estensione, pagine html e file già esistenti", async () => {
  const cartella = mkdtempSync(join(tmpdir(), "media-"));
  await assert.rejects(salva("https://esempio.it/v", "a.png", cartella, { fetch: finto(MP4) }), /tipo/);
  await assert.rejects(salva("https://esempio.it/v", "b.mp4", cartella, { fetch: finto(HTML) }), /tipo/);
  assert.equal(existsSync(join(cartella, "b.mp4")), false);
  writeFileSync(join(cartella, "c.mp4"), "vecchio");
  await assert.rejects(salva("https://esempio.it/v", "c.mp4", cartella, { fetch: finto(MP4) }), /esiste/);
  assert.equal(readFileSync(join(cartella, "c.mp4"), "utf8"), "vecchio");
});
