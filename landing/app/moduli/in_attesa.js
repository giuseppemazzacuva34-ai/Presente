// Segnalazione e blocco senza connessione (issue #7, spec v1.1, «Casi limite» › Offline: «il blocco e la segnalazione
// si inviano al rientro della connessione; "Chiama il 112" funziona sempre perché usa il telefono»). Passo 15b della
// linea «sviluppatore-b».
// conAttesa(servizio, metodo, { finestra, inAttesa }) restituisce lo stesso servizio con `metodo` che, se manca la rete
// (motivo «rete» o errore lanciato), tiene l'invio nella memoria della pagina e lo rimanda da solo all'evento «online».
// Niente salvataggi sul telefono: il racconto e la persona restano solo in memoria (se si chiude l'app, l'invio si perde
// e lo si rifà; meglio che lasciare una segnalazione sul telefono). Al massimo 20 invii; lo stesso invio vale uno.

const MASSIMO = 20;

export function conAttesa(servizio, metodo, { finestra = globalThis, inAttesa = { ok: false, motivo: "in_attesa" } } = {}) {
  const originale = servizio[metodo].bind(servizio);
  const coda = [];
  let ascolta = false;
  let invio = false;

  const prova = async (argomenti) => {
    try {
      return await originale(...argomenti);
    } catch {
      return { ok: false, motivo: "rete" };
    }
  };

  const smetti = () => {
    if (ascolta && typeof finestra?.removeEventListener === "function") finestra.removeEventListener("online", svuota);
    ascolta = false;
  };

  async function svuota() {
    if (invio) return;
    invio = true;
    try {
      for (const voce of [...coda]) {
        const r = await prova(voce.argomenti);
        if (r && r.motivo === "rete") continue;
        coda.splice(coda.indexOf(voce), 1);
      }
    } finally {
      invio = false;
    }
    if (!coda.length) smetti();
  }

  const accoda = (argomenti) => {
    const chiave = JSON.stringify(argomenti);
    if (!coda.some((v) => v.chiave === chiave) && coda.length < MASSIMO) coda.push({ chiave, argomenti });
    if (!ascolta && typeof finestra?.addEventListener === "function") {
      finestra.addEventListener("online", svuota);
      ascolta = true;
    }
  };

  return Object.assign(Object.create(servizio), {
    async [metodo](...argomenti) {
      const r = await prova(argomenti);
      if (r && r.motivo === "rete") {
        accoda(argomenti);
        return { ...inAttesa };
      }
      return r;
    },
    inAttesa: () => coda.length,
  });
}
