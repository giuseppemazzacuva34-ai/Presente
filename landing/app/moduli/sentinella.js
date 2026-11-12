// La «sentinella» delle chiamate (issue #4, passo 3c-3b-1): rilegge lo stato della chiamata (GET /app/api/chiamata,
// con creaChiamata().stato di chiamata.js) per sapere di uno squillo in arrivo senza notifiche push.
//
// - Solo con l'app aperta e visibile: in secondo piano non parte nessuna richiesta; tornando visibile si legge subito.
// - Ogni 10 secondi a riposo, ogni secondo durante squillo e chiamata, 60 secondi dopo «troppi tentativi»: così si
//   resta dentro le 100.000 richieste al giorno del piano gratuito dei Workers.
// - Chiamate spente o accesso scaduto: si ferma (nessuna richiesta a vuoto) finché l'app non la riavvia.
// - Mai due letture insieme. Niente salvataggi locali, niente notifiche, niente lavori in background.
// Pagina e timer si passano da fuori, così si prova con node --test.

export const A_RIPOSO_MS = 10000;
export const IN_CHIAMATA_MS = 1000;
export const DOPO_TROPPE_MS = 60000;

// Quanto aspettare dopo una risposta; null = fermarsi.
export function prossimaAttesa(r) {
  if (!r || typeof r !== "object") return A_RIPOSO_MS;
  if (r.ok !== true) {
    if (r.motivo === "spento" || r.motivo === "accesso") return null;
    if (r.motivo === "troppe") return DOPO_TROPPE_MS;
    return A_RIPOSO_MS;
  }
  const fase = r.vista && r.vista.fase;
  return fase === "squilla" || fase === "in_corso" ? IN_CHIAMATA_MS : A_RIPOSO_MS;
}

export function creaSentinella({ leggi, quando, pagina, setTimeout: dopo = globalThis.setTimeout, clearTimeout: annulla = globalThis.clearTimeout }) {
  let attiva = false;
  let inLettura = false;
  let timer = null;
  let giro = 0; // cambia a ogni ferma(): le risposte di prima vengono ignorate

  const visibile = () => !pagina || pagina.visibilityState === "visible";

  function cancella() {
    if (timer !== null) { annulla(timer); timer = null; }
  }

  async function leggiOra() {
    if (!attiva || inLettura || !visibile()) return;
    cancella();
    inLettura = true;
    const questo = giro;
    let r = null;
    try { r = await leggi(); } catch { r = null; }
    inLettura = false;
    if (questo !== giro || !attiva) return;
    try { quando(r); } catch { /* lo schermo non deve fermare la sentinella */ }
    const ms = prossimaAttesa(r);
    if (ms === null || !visibile()) return;
    cancella();
    timer = dopo(leggiOra, ms);
  }

  function cambioVisibilita() {
    if (visibile()) leggiOra();
    else cancella();
  }

  return {
    avvia() {
      if (attiva) return;
      attiva = true;
      pagina?.addEventListener("visibilitychange", cambioVisibilita);
      leggiOra();
    },
    // Dopo un'azione dell'utente (chiama, rispondi, chiudi): leggere ora invece di aspettare il timer.
    subito() { leggiOra(); },
    ferma() {
      attiva = false;
      giro++;
      inLettura = false;
      cancella();
      pagina?.removeEventListener("visibilitychange", cambioVisibilita);
    },
  };
}
