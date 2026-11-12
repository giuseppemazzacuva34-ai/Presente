#!/usr/bin/env node
// Salva un video o un'immagine nel ramo «media-social» partendo da un link pubblico (richiesta del coordinatore, 9/11).
// Lo usa il workflow .github/workflows/salva-media.yml (avvio a mano con 2 dati: link e nome del file).
// Regole: solo link https pubblici, solo .mp4 .webm .jpg .jpeg .png, al massimo 95 MB (GitHub rifiuta oltre 100 MB),
// il contenuto deve essere davvero del tipo dichiarato, mai sovrascrivere un file esistente.
// Nel log scrive solo nome, dimensione e link pubblico del file: niente contenuti, niente segreti.
// Uso: node scripts/salva_media.mjs <link> <nome-file> <cartella-del-ramo>
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { lookup as lookupDns } from "node:dns/promises";

export const MASSIMO = 95 * 1024 * 1024;
const BASE = "https://raw.githubusercontent.com/giuseppemazzacuva34-ai/presente/media-social/";
const PARTE = "[a-z0-9][a-z0-9_-]{0,79}";
const NOME = new RegExp(`^(?:${PARTE}/)?${PARTE}(?:\\.[a-z0-9_-]{1,20})*\\.(mp4|webm|jpe?g|png)$`);

export function controllaNome(nome) {
  const pulito = String(nome ?? "").trim().toLowerCase();
  if (pulito.length > 120 || !NOME.test(pulito)) {
    throw new Error("nome del file non valido: minuscole, cifre, - e _, al massimo una sottocartella, estensione .mp4 .webm .jpg .png");
  }
  return pulito;
}

function ipv4Privato(ottetti) {
  const [a, b] = ottetti.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function indirizzoPrivato(host) {
  const h = host.replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h.includes(":")) return true; // IPv6 scritto a mano: non serve per i link di Canva, Drive o GitHub
  const n = h.split(".");
  if (n.length === 4 && n.every((x) => /^\d{1,3}$/.test(x))) return ipv4Privato(n);
  return false;
}

export function controllaLink(link) {
  let url;
  try { url = new URL(String(link ?? "").trim()); } catch { throw new Error("link non valido"); }
  if (url.protocol !== "https:") throw new Error("link non valido: serve https");
  if (url.username || url.password) throw new Error("link non valido: niente credenziali nel link");
  if (indirizzoPrivato(url.hostname)) throw new Error("link non valido: indirizzo non pubblico");
  return url;
}

// IPv6 restituito dal DNS (12/11): Canva, Drive e GitHub rispondono anche in IPv6, quindi rifiutarlo sempre bloccava
// ogni link vero. È pubblico solo un indirizzo unicast globale (2000::/3), tolti i blocchi che contengono un IPv4
// (6to4 2002::/16, Teredo 2001:0::/32) e la documentazione (2001:db8::/32). Tutto il resto (::1, fe80::, fc00::/7,
// ff00::, ::ffff:x.x.x.x, 64:ff9b::) resta privato.
export function ipv6Pubblico(indirizzo) {
  const testo = String(indirizzo).toLowerCase().split("%")[0];
  if (testo.includes(".")) return false; // forma con IPv4 dentro (::ffff:1.2.3.4): mai accettata
  const lati = testo.split("::");
  if (lati.length > 2) return false;
  const sinistra = lati[0] ? lati[0].split(":") : [];
  const destra = lati.length === 2 && lati[1] ? lati[1].split(":") : [];
  const mancanti = 8 - sinistra.length - destra.length;
  if (lati.length === 1 ? mancanti !== 0 : mancanti < 1) return false;
  const gruppi = [...sinistra, ...Array(lati.length === 2 ? mancanti : 0).fill("0"), ...destra];
  if (!gruppi.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return false;
  const [a, b] = gruppi.map((g) => parseInt(g, 16));
  if ((a & 0xe000) !== 0x2000) return false; // fuori da 2000::/3
  if (a === 0x2002) return false; // 6to4
  if (a === 0x2001 && (b === 0 || b === 0x0db8)) return false; // Teredo, documentazione
  return true;
}

// Il nome del link (es. "esempio.it") può sembrare pubblico e poi risolvere a un indirizzo privato o al servizio
// metadati del cloud (169.254.169.254): CISO 10/11, protezione dagli indirizzi "DNS rebinding". Si controllano
// TUTTI gli indirizzi a cui risponde, non solo il primo. Un IPv6 scritto a mano nel link resta rifiutato
// (controllaLink); un IPv6 dal DNS passa solo se è pubblico (ipv6Pubblico).
export async function controllaDns(hostname, cerca = lookupDns) {
  let indirizzi;
  try {
    indirizzi = await cerca(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("link non valido: indirizzo non risolvibile");
  }
  if (!indirizzi.length) throw new Error("link non valido: indirizzo non risolvibile");
  for (const { address, family } of indirizzi) {
    const privato = family === 4 ? ipv4Privato(String(address).split(".")) : family === 6 ? !ipv6Pubblico(address) : true;
    if (privato) {
      throw new Error("link non valido: indirizzo non pubblico");
    }
  }
}

export function tipoDalContenuto(b) {
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "mp4";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  return null;
}

export async function scarica(link, { fetch: prendi = globalThis.fetch, massimo = MASSIMO, dns = lookupDns } = {}) {
  const url = controllaLink(link);
  await controllaDns(url.hostname, dns);
  const risposta = await prendi(url.href, { redirect: "follow", signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!risposta.ok) throw new Error(`il link risponde ${risposta.status}`);
  const finale = controllaLink(risposta.url || url.href); // anche dopo i reindirizzamenti
  if (finale.hostname !== url.hostname) await controllaDns(finale.hostname, dns);
  const dichiarata = Number(risposta.headers.get("content-length") || 0);
  if (dichiarata > massimo) throw new Error("file troppo grande (massimo 95 MB)");
  const pezzi = [];
  let totale = 0;
  for await (const pezzo of risposta.body) {
    totale += pezzo.length;
    if (totale > massimo) throw new Error("file troppo grande (massimo 95 MB)");
    pezzi.push(pezzo);
  }
  const byte = new Uint8Array(totale);
  let i = 0;
  for (const p of pezzi) { byte.set(p, i); i += p.length; }
  return byte;
}

export async function salva(link, nome, cartella, opzioni = {}) {
  const percorso = controllaNome(nome);
  const destinazione = join(cartella, percorso);
  if (existsSync(destinazione)) throw new Error(`il file ${percorso} esiste già: scegli un nome nuovo (es. -v2)`);
  const byte = await scarica(link, opzioni);
  const atteso = percorso.split(".").pop().replace("jpeg", "jpg");
  const trovato = tipoDalContenuto(byte);
  if (trovato !== atteso) {
    throw new Error(`tipo del contenuto (${trovato ?? "non è un video o un'immagine, forse una pagina web"}) diverso da .${atteso}`);
  }
  mkdirSync(dirname(destinazione), { recursive: true });
  writeFileSync(destinazione, byte);
  return { percorso, byte: byte.length, link: BASE + percorso };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [link, nome, cartella] = process.argv.slice(2);
  try {
    const esito = await salva(link, nome, cartella);
    console.log(`OK ${esito.percorso} (${(esito.byte / 1048576).toFixed(1)} MB)`);
    console.log(`file_pubblico_github: ${esito.link}`);
    if (process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, `percorso=${esito.percorso}\nlink=${esito.link}\n`, { flag: "a" });
    }
  } catch (errore) {
    console.error(`ERRORE: ${errore.message}`);
    process.exit(1);
  }
}
