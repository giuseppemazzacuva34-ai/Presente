// Stanza viva (issue #380 spec v1 punto 2, passo 3; design v4 D149, schermata 19): cerchio ed elenco divisi tra uomini
// e donne.
// - Uomini nella metà sinistra, donne nella destra: i posti si dividono in proporzione (8 donne e 4 uomini → 8 a destra
//   e 4 a sinistra) e dentro ogni metà sono a distanza uguale.
// - Persone non binarie, che si descrivono o senza risposta: in basso al centro, tra le due metà.
// - Stanza di un solo genere (nessun uomo o nessuna donna): cerchio intero, senza asse né etichette «Uomini · N» /
//   «Donne · N».
// - Chi guarda sta in cima alla sua metà con «tu» e non compare nell'elenco (non si chiama da solo).
// Qui si usano solo id e «mi presento come» già ricevuti dal server: nessuna lettura, nessun salvataggio.
// Le posizioni sono coordinate in un riquadro 190×190: la vista le disegna in SVG (attributi cx/cy), perché la CSP
// dell'app vieta gli stili scritti negli attributi.

export const CERCHIO = Object.freeze({ lato: 190, centro: 95, raggio: 82 });

const GRUPPO = Object.freeze({ uomo: "uomini", donna: "donne" });
const TITOLI = Object.freeze({ uomini: "Uomini", donne: "Donne", altre: "Altre persone" });
const STATI = Object.freeze({ online: "on", in_chiamata: "ch" });
const gruppoDi = (presento) => (Object.hasOwn(GRUPPO, presento) ? GRUPPO[presento] : "altre");

// persone: le altre persone della stanza nell'ordine dei suggerimenti di oggi, [{ id, presento }].
// io: { id, presento } di chi guarda.
// → { diviso, posti: [{ id, gruppo, tu, x, y }], elenco: [{ gruppo, titolo | null, persone }] }
export function disponiStanza(persone = [], io = {}) {
  const visti = new Set([io.id]);
  const altri = [];
  for (const p of Array.isArray(persone) ? persone : []) {
    if (!p || visti.has(p.id)) continue;
    visti.add(p.id);
    altri.push(p);
  }
  const mio = gruppoDi(io.presento);
  const gruppi = { uomini: [], donne: [], altre: [] };
  gruppi[mio].push({ ...io, tu: true });
  for (const p of altri) gruppi[gruppoDi(p.presento)].push({ ...p, tu: false });

  const u = gruppi.uomini.length, d = gruppi.donne.length, a = gruppi.altre.length;
  const n = u + d + a;
  const diviso = u > 0 && d > 0;
  const passo = 360 / n;
  const posti = [];
  const metti = (p, gruppo, gradi) => {
    const r = (gradi * Math.PI) / 180;
    posti.push({ id: p.id, gruppo, tu: p.tu, x: CERCHIO.centro + CERCHIO.raggio * Math.sin(r), y: CERCHIO.centro - CERCHIO.raggio * Math.cos(r) });
  };

  if (diviso) {
    const meta = a * passo / 2; // metà dello spicchio in basso per le altre persone
    const arco = 180 - meta;
    gruppi.donne.forEach((p, i) => metti(p, "donne", ((i + 0.5) * arco) / d));
    gruppi.uomini.forEach((p, i) => metti(p, "uomini", 360 - ((i + 0.5) * arco) / u));
    gruppi.altre.forEach((p, i) => metti(p, "altre", 180 - meta + (i + 0.5) * passo));
  } else {
    // Cerchio intero: prima chi guarda, poi il suo gruppo, poi gli altri gruppi.
    const ordine = [mio, ...["uomini", "donne", "altre"].filter((g) => g !== mio)];
    ordine.flatMap((g) => gruppi[g].map((p) => [p, g])).forEach(([p, g], i) => metti(p, g, (i + 0.5) * passo));
  }

  const elenco = [];
  for (const g of ["uomini", "donne", "altre"]) {
    const lista = altri.filter((p) => gruppoDi(p.presento) === g);
    if (!lista.length) continue;
    const titolo = g === "altre" || diviso ? `${TITOLI[g]} · ${lista.length}` : null;
    elenco.push({ gruppo: g, titolo, persone: lista });
  }
  return { diviso, posti, elenco };
}

// Descrizione a parole del cerchio (lettore di schermo; lo stato non è mai solo un colore).
export function descriviCerchio({ diviso, posti }) {
  const conta = (g) => posti.filter((p) => p.gruppo === g).length;
  const tu = posti.find((p) => p.tu);
  if (!diviso) return `La tua stanza: ${posti.length} persone in cerchio. Il tuo posto è in alto.`;
  const parti = [`${conta("uomini")} uomini a sinistra`, `${conta("donne")} donne a destra`];
  if (conta("altre")) parti.push(`${conta("altre")} altre persone in basso`);
  const dove = !tu ? "" : tu.gruppo === "donne" ? " Il tuo posto è a destra." : tu.gruppo === "uomini" ? " Il tuo posto è a sinistra." : " Il tuo posto è in basso.";
  return `La tua stanza: ${parti.join(", ")}.${dove}`;
}

const c1 = (v) => (Math.round(v * 10) / 10).toString();

// Vista del cerchio. stati: { id: "online" | "in_chiamata" | "non_in_linea" } (facoltativo): diventa la classe del
// posto; gli stati scritti a parole stanno nell'elenco sotto il cerchio.
export function vistaCerchioStanza(h, disposizione, { stati = {} } = {}) {
  const { diviso, posti } = disposizione;
  const { lato, centro } = CERCHIO;
  const classe = (p) => {
    const s = Object.hasOwn(stati, p.id) && Object.hasOwn(STATI, stati[p.id]) ? STATI[stati[p.id]] : null;
    return ["p", p.tu ? "tu" : null, s].filter(Boolean).join(" ");
  };
  return h("div", { classe: "cerchio-stanza", role: "img", "aria-label": descriviCerchio(disposizione) },
    diviso ? h("span", { classe: "et sx", "aria-hidden": "true" }, TITOLI.uomini) : null,
    diviso ? h("span", { classe: "et dx", "aria-hidden": "true" }, TITOLI.donne) : null,
    h("svg", { viewBox: `0 0 ${lato} ${lato}`, "aria-hidden": "true", focusable: "false" },
      diviso ? h("line", { class: "asse", x1: String(centro), y1: "6", x2: String(centro), y2: String(lato - 6) }) : null,
      posti.map((p) => h("circle", { class: classe(p), cx: c1(p.x), cy: c1(p.y), r: p.tu ? "10" : "7.5", "data-id": p.tu ? null : String(p.id) }))));
}
