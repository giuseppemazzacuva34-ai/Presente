// Importa nella lista d'attesa (D1 «presente-lista») i contatti del modulo dentro Facebook e Instagram (D53 = A, informativa 1.2; dal 1/11 in vigore la 1.3).
// Fase 1: Giuseppe scarica il file CSV dal Centro contatti di Meta; questo programma lo trasforma in istruzioni SQL
// che aggiungono solo le email nuove (ON CONFLICT DO NOTHING: chi è già in lista, anche dalla landing, non cambia).
//
// Uso:  node scripts/importa_meta.mjs <file.csv> [--maggiorenne-nel-modulo] > /cartella/temporanea/import.sql
//       npx wrangler d1 execute presente-lista --remote --file /cartella/temporanea/import.sql
// Il riepilogo (solo numeri, mai email) esce su stderr. Dopo l'import: cancellare il CSV e l'SQL, poi i contatti da Meta
// entro 7 giorni (informativa 1.3, punto 3). Il CSV e l'SQL contengono dati personali: MAI nel repository.
//
// Regole: email valida; città riconosciuta (altrimenti «altra-citta-italia»); maggiore età confermata da una colonna
// del modulo (o, con --maggiorenne-nel-modulo, da una dichiarazione obbligatoria del modulo); data del consenso = data
// d'invio del modulo; sorgente = "meta_modulo"; versione_informativa = quella in vigore. I contatti di prova di Meta vengono scartati.
import { readFileSync } from "node:fs";
import { SORGENTE, zonaDa, dataConsenso, contatto, trovaColonne } from "../worker/contatti_meta.js";

export { SORGENTE };

// Meta esporta in UTF-16 con tabulazioni; a volte in UTF-8 con virgole. Si riconoscono entrambi.
export function decodifica(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const scambiato = Buffer.from(buffer.subarray(2));
    scambiato.swap16();
    return scambiato.toString("utf16le");
  }
  let testo = buffer.toString("utf8");
  if (testo.charCodeAt(0) === 0xfeff) testo = testo.slice(1);
  return testo;
}

// CSV con virgolette ("" dentro un campo = una virgoletta), separatore scelto dalla prima riga.
export function leggiCsv(testo) {
  const primaRiga = testo.split(/\r?\n/, 1)[0];
  const sep = (primaRiga.match(/\t/g) || []).length >= (primaRiga.match(/,/g) || []).length ? "\t" : ",";
  const righe = [];
  let riga = [], campo = "", virgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (virgolette) {
      if (c === '"' && testo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') virgolette = false;
      else campo += c;
    } else if (c === '"') virgolette = true;
    else if (c === sep) { riga.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && testo[i + 1] === "\n") i++;
      riga.push(campo); campo = "";
      if (riga.some((x) => x.trim() !== "")) righe.push(riga);
      riga = [];
    } else campo += c;
  }
  riga.push(campo);
  if (riga.some((x) => x.trim() !== "")) righe.push(riga);
  if (!righe.length) return [];
  const intestazioni = righe[0].map((h) => h.trim().toLowerCase());
  return righe.slice(1).map((r) => Object.fromEntries(intestazioni.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// Regole comuni con l'import diretto dal webhook (D85 = A): worker/contatti_meta.js.
export { zonaDa, dataConsenso };

// Trasforma le righe del CSV nelle iscrizioni da salvare. Restituisce anche il riepilogo (solo numeri).
export function prepara(righe, { maggiorenneNelModulo = false, adesso = new Date() } = {}) {
  const colonne = trovaColonne(righe.length ? Object.keys(righe[0]) : []);
  if (!colonne.email) throw new Error("Nel file non c'è una colonna email.");
  if (!colonne.eta && !maggiorenneNelModulo) {
    throw new Error("Nel file non c'è la conferma dei 18 anni. Se il modulo la chiedeva come dichiarazione obbligatoria, usa --maggiorenne-nel-modulo.");
  }
  const riepilogo = { righe: righe.length, da_importare: 0, email_non_valida: 0, prova_meta: 0, senza_18: 0, doppione_nel_file: 0 };
  const viste = new Set();
  const iscrizioni = [];
  for (const r of righe) {
    const esito = contatto(r, colonne, { maggiorenneNelModulo, adesso });
    if (esito.scarto) { riepilogo[esito.scarto]++; continue; }
    if (viste.has(esito.iscrizione.email)) { riepilogo.doppione_nel_file++; continue; }
    viste.add(esito.iscrizione.email);
    iscrizioni.push(esito.iscrizione);
  }
  riepilogo.da_importare = iscrizioni.length;
  return { iscrizioni, riepilogo };
}

const testoSql = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function sql(iscrizioni) {
  return iscrizioni.map((i) =>
    "INSERT INTO iscrizioni (email, zona, invito, consenso_il, versione_informativa, sorgente) VALUES ("
    + [i.email, i.zona].map(testoSql).join(", ") + ", NULL, "
    + [i.consenso_il, i.versione_informativa, i.sorgente].map(testoSql).join(", ")
    + ") ON CONFLICT(email) DO NOTHING;").join("\n") + (iscrizioni.length ? "\n" : "");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Uso: node scripts/importa_meta.mjs <file.csv> [--maggiorenne-nel-modulo] > import.sql");
    process.exit(2);
  }
  try {
    const { iscrizioni, riepilogo } = prepara(leggiCsv(decodifica(readFileSync(file))), {
      maggiorenneNelModulo: process.argv.includes("--maggiorenne-nel-modulo"),
    });
    process.stdout.write(sql(iscrizioni));
    console.error("Riepilogo:", JSON.stringify(riepilogo));
  } catch (errore) {
    console.error(errore.message);
    process.exit(1);
  }
}
