// Regalo ricevuto durante la chiamata (issue #349, design v4 schermata 27, linea «sviluppatore-b»).
// Mentre la chiamata è in corso chiede al server i regali da vedere (regali.avvisi() → GET /app/api/regali),
// mostra sopra la chiamata solo quelli della persona con cui si parla, uno alla volta (mostra = mostraAvvisoRegalo
// di regali.js, che sparisce da solo), e li segna visti (regali.visti). I regali di altre persone restano da vedere.
// Una domanda ogni 15 secondi: il Worker accetta 10 richieste al minuto sui regali, così resta spazio per mandarne.
// Finita la chiamata (conChi() → null) smette da solo. Niente salvataggi locali, niente log.
import { DURATA_AVVISO_MS } from "./regali.js";

export const OGNI_MS = 15000;
const PAUSA_MS = DURATA_AVVISO_MS + 400; // il secondo regalo compare quando il primo è sparito
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REGALI = new Set(["rosa", "spumante", "fiori"]);

const valido = (a, da) => a && typeof a === "object" && UUID.test(String(a.id || "")) && a.da === da
  && REGALI.has(a.regalo) && typeof a.testo === "string" && a.testo.trim() !== "";

export function creaRegaloRicevuto({ regali, mostra, orologio = globalThis } = {}) {
  const dopo = (fn, ms) => orologio.setTimeout(fn, ms);
  let conChi = () => null;
  let giro = null; // timer della prossima domanda; null = fermo
  let attivo = false;
  const giaMostrati = new Set();
  const coda = [];
  let mostrando = false;

  function prossimo() {
    const a = coda.shift();
    if (!a) { mostrando = false; return; }
    mostrando = true;
    try { mostra(a); } catch { /* l'avviso non deve fermare la chiamata */ }
    Promise.resolve().then(() => regali.visti([a.id])).catch(() => {});
    dopo(prossimo, PAUSA_MS);
  }

  async function chiedi() {
    giro = null;
    const persona = conChi();
    if (!persona) { attivo = false; return; }
    let r = null;
    try { r = await regali.avvisi(); } catch { r = null; }
    if (r && r.ok === true && Array.isArray(r.avvisi) && conChi() === persona) {
      for (const a of r.avvisi) {
        if (!valido(a, persona) || giaMostrati.has(a.id)) continue;
        giaMostrati.add(a.id);
        coda.push({ id: a.id, da: a.da, regalo: a.regalo, testo: a.testo });
      }
      if (!mostrando) prossimo();
    }
    giro = dopo(chiedi, OGNI_MS);
  }

  return {
    // Si chiama a ogni disegno dello schermo «in corso»: parte una volta sola.
    avvia(chi) {
      if (typeof chi === "function") conChi = chi;
      if (attivo) return;
      attivo = true;
      chiedi();
    },
  };
}
