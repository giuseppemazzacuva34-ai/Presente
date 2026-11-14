// Chiavi nella stanza (issue #5 spec v1.1, passi 4, 5, 6 e 7; D14 A, D51 A). Linea «sviluppatore-c», passo 8a.
// Tiene lo stato delle chiavi che arriva dal server (/app/api/chiavi, tramite creaChiavi di chiavi.js), apre le
// finestre «Dai una chiave», «Modifica la frase» e «Riprendi la chiave» e manda una richiesta alla volta.
// Le regole (2 chiavi, solo a chi hai chiamato, frase senza contatti, chiuse dalle 20:59) le decide il server: un suo
// rifiuto lascia la finestra aperta con il suo testo. Nessuno scopre un no: qui ci sono solo le chiavi date da te.
// Niente salvataggi locali. Il modulo non tocca la pagina: la vista (flusso.js) legge modello() e scheda(persona).
import { contatoreChiavi, schedaChiave, finestraDai, confermaRiprendi, contoAllaRovescia } from "./chiavi.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function creaChiaviStanza({ chiavi, aggiorna = () => {}, adesso = () => new Date() }) {
  let stato = null;
  let finestra = null;
  let errore = null;
  let inCorso = false;

  const avvisa = () => { try { aggiorna(); } catch { /* la vista non deve fermare le chiavi */ } };
  const data = (a) => (Array.isArray(stato?.date) ? stato.date.find((k) => k && k.a === a) : null);
  const apri = (tipo, a, campi) => {
    if (!UUID.test(String(a || ""))) return;
    finestra = { tipo, a, ...campi };
    errore = null;
    avvisa();
  };

  async function carica() {
    const r = await chiavi.leggi();
    stato = r && r.ok ? r.stato : null;
    avvisa();
  }

  return {
    carica,
    modello: () => ({
      contatore: contatoreChiavi(stato),
      conto: stato && stato.stanza === true ? contoAllaRovescia(stato.chiude_il, adesso()) : null,
      finestra: finestra ? { ...finestra } : null,
      errore,
      inCorso,
    }),
    scheda: (persona) => schedaChiave(stato, persona),
    apriDai: (a, nome) => apri("dai", a, { ...finestraDai(nome), frase: "" }),
    apriFrase: (a, nome) => {
      const d = data(a);
      apri("frase", a, { ...finestraDai(nome), titolo: "Modifica la frase", bottone: "Salva", frase: typeof d?.frase === "string" ? d.frase : "" });
    },
    apriRiprendi: (a, nome) => apri("riprendi", a, { testo: confermaRiprendi(nome), bottone: "Riprendi la chiave" }),
    scrivi(frase) {
      if (finestra && finestra.tipo !== "riprendi") finestra.frase = typeof frase === "string" ? frase : "";
    },
    chiudi() {
      finestra = null;
      errore = null;
      avvisa();
    },
    async conferma() {
      if (!finestra || inCorso) return;
      const f = finestra;
      inCorso = true;
      errore = null;
      avvisa();
      try {
        const r = f.tipo === "dai" ? await chiavi.dai(f.a, f.frase)
          : f.tipo === "frase" ? await chiavi.cambiaFrase(f.a, f.frase)
          : await chiavi.riprendi(f.a);
        if (!r || !r.ok) {
          errore = typeof r?.testo === "string" && r.testo ? r.testo : "Non è andata. Riprova tra poco.";
          return;
        }
        finestra = null;
        if (r.stato && typeof r.stato === "object") stato = r.stato;
        else await carica();
      } finally {
        inCorso = false;
        avvisa();
      }
    },
  };
}
