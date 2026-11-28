// «Aggiungi al calendario» (issue #6, spec v1 del CPO del 3/11, passo 4 «Confermato»: file .ics senza nome dell'altro;
// criterio «Email e .ics non contengono foto né cognomi»). Linea «sviluppatore-b».
// Il file si costruisce nel telefono con quello che la schermata ha già letto (id della porta, ora e luogo): nessuna
// richiesta in più al server, nessun nome, nessuna foto, niente salvataggi locali, niente log.
// Scelte tecniche: durata di 2 ore (solo per il calendario, non è una regola dell'incontro); UID stabile dalla porta,
// così se si scarica di nuovo dopo «Cambia luogo» il calendario aggiorna lo stesso evento; un promemoria 2 ore prima
// come quello della spec (passo 5). Testi provvisori, da rivedere con «contenuti».

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DUE_ORE = 2 * 60 * 60 * 1000;
export const NOME_FILE_ICS = "presente-incontro.ics";

export const TESTI_CALENDARIO = Object.freeze({
  // Dalla spec (passo 4).
  bottone: "Aggiungi al calendario",
  // Provvisori.
  titolo: "Incontro su Presente",
  descrizione: "Quando arrivi, apri Presente e tocca «Sono qui». Scegliete sempre un posto pubblico e frequentato.",
  promemoria: "Tra 2 ore hai il tuo incontro su Presente.",
  errore: "Non sono riuscito a creare il file. Riprova tra poco.",
});

const dataIcs = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// RFC 5545, 3.3.11: barra, punto e virgola, virgola e a capo vanno protetti.
const proteggi = (t) => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// RFC 5545, 3.1: righe al massimo di 75 byte; la continuazione comincia con uno spazio. Non si spezza un carattere.
function piega(riga) {
  const enc = new TextEncoder();
  const out = [];
  let pezzo = "";
  let byte = 0;
  for (const c of riga) {
    const n = enc.encode(c).length;
    const max = out.length === 0 ? 75 : 74;
    if (byte + n > max) { out.push(pezzo); pezzo = ""; byte = 0; }
    pezzo += c; byte += n;
  }
  out.push(pezzo);
  return out.join("\r\n ");
}

// Il testo del file, o null se l'incontro non ha ancora un'ora futura e un luogo. Si leggono solo porta, orario e
// luogo: qualunque altro campo (nomi compresi) viene ignorato.
export function testoIcs(dati, adesso = new Date()) {
  if (!dati || typeof dati !== "object") return null;
  const { porta, orario, luogo } = dati;
  if (typeof porta !== "string" || !UUID.test(porta)) return null;
  if (typeof luogo !== "string" || !luogo.trim()) return null;
  const inizio = typeof orario === "string" && orario ? new Date(orario) : null;
  if (!inizio || !Number.isFinite(inizio.getTime()) || inizio <= new Date(adesso)) return null;
  const righe = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Presente//Incontro//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:incontro-${porta}@presenteincontri.app`,
    `DTSTAMP:${dataIcs(new Date(adesso))}`,
    `DTSTART:${dataIcs(inizio)}`,
    `DTEND:${dataIcs(new Date(inizio.getTime() + DUE_ORE))}`,
    `SUMMARY:${proteggi(TESTI_CALENDARIO.titolo)}`,
    `LOCATION:${proteggi(luogo.trim())}`,
    `DESCRIPTION:${proteggi(TESTI_CALENDARIO.descrizione)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT2H", `DESCRIPTION:${proteggi(TESTI_CALENDARIO.promemoria)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return righe.map(piega).join("\r\n") + "\r\n";
}

// Scarica il file: link temporaneo con un URL blob, cliccato e tolto subito. true se è partito, false altrimenti.
// L'URL si libera dopo un attimo: su Safari, liberarlo subito dopo il clic può fermare il download.
export function scaricaIcs(testo, { document: doc = globalThis.document, URL: U = globalThis.URL, Blob: B = globalThis.Blob,
  aspetta = (f) => setTimeout(f, 10000) } = {}) {
  if (typeof testo !== "string" || !testo || !doc || !U || !B) return false;
  let url = null;
  try {
    url = U.createObjectURL(new B([testo], { type: "text/calendar;charset=utf-8" }));
    const a = doc.createElement("a");
    a.href = url;
    a.download = NOME_FILE_ICS;
    doc.body.append(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  } finally {
    const libera = url;
    if (libera) aspetta(() => { try { U.revokeObjectURL(libera); } catch { /* niente */ } });
  }
}
