// Schermata «I tuoi Coin» nella web app (issue #331, spec v1 del CPO, parte B; decisioni_giuseppe_20_11_evoluzione,
// D145 A). Passo 6 della linea «sviluppatore-c».
// In beta i Coin sono di prova: le offerte si vedono ma i pulsanti sono SEMPRE disattivati e nessuna richiesta va a
// servizi di pagamento (pagamenti veri solo con una decisione di Giuseppe). Il saldo lo dà il Worker
// (GET /app/api/regali, saldo_crediti) con il token di chi guarda: al telefono non si calcola nulla.
// Se la schermata è già stata vista lo dice il server (passo successivo): qui nessun salvataggio locale.
// I numeri restano uguali a api/coin.js (1 € = 10 Coin, stanza Al buio 80): lo controlla test/coin_schermata.test.mjs.

export const TESTI_SCHERMATA_COIN = Object.freeze({
  titolo: "I tuoi crediti",
  notaBeta: "Nella beta i crediti sono di prova: li trovi già nel tuo saldo. Non paghi niente.",
  riga: "1 € = 10 crediti. La stanza Al buio costa 80 crediti, la prima è in regalo.",
  continua: "Continua",
});

// Spec B.2: due offerte; la seconda con l'etichetta «50 Coin in più» (500 Coin a 45 € invece di 50 €).
export const OFFERTE = Object.freeze([
  Object.freeze({ id: "coin200", coin: 200, euro: 20, inPiu: 0 }),
  Object.freeze({ id: "coin500", coin: 500, euro: 45, inPiu: 50 }),
]);

const PERCORSO = "/app/api/regali";
const saldoValido = (n) => Number.isInteger(n) && n >= 0;
const coin = (n) => (n === 1 ? "1 credito" : `${n} crediti`); // decisioni_giuseppe_23_11_crediti

// Cosa mostra la schermata. saldo: il numero dato dal server; se manca, null (mai un numero inventato).
export function schermataCoin(saldo) {
  return {
    titolo: TESTI_SCHERMATA_COIN.titolo,
    saldo: saldoValido(saldo) ? coin(saldo) : null,
    offerte: OFFERTE.map((o) => ({
      id: o.id,
      testo: `${coin(o.coin)} · ${o.euro} €`,
      etichetta: o.inPiu > 0 ? `${coin(o.inPiu)} in più` : null,
      attiva: false, // in beta sempre spente (spec B.3)
      descrizione: TESTI_SCHERMATA_COIN.notaBeta,
    })),
    notaBeta: TESTI_SCHERMATA_COIN.notaBeta,
    riga: TESTI_SCHERMATA_COIN.riga,
    continua: TESTI_SCHERMATA_COIN.continua,
  };
}

// Spec B.1 e B.5: da sola solo al primo ingresso dopo il profilo completo; da «Il mio profilo › Coin» sempre.
export function mostraSchermataCoin({ profiloCompleto = false, giaVista = true, dalProfilo = false } = {}) {
  if (dalProfilo === true) return true;
  return profiloCompleto === true && giaVista === false;
}

// Lettura del saldo: { ok: true, saldo } oppure { ok: false, motivo: "accesso" | "rete" | "riprova" }.
export function creaCoin({ token, fetch: f = globalThis.fetch } = {}) {
  return {
    async saldo() {
      const t = await Promise.resolve().then(token).catch(() => null);
      if (!t) return { ok: false, motivo: "accesso" };
      let r;
      try {
        r = await f(PERCORSO, { method: "GET", headers: { authorization: `Bearer ${t}` } });
      } catch {
        return { ok: false, motivo: "rete" };
      }
      if (r.status === 401) return { ok: false, motivo: "accesso" };
      if (!r.ok) return { ok: false, motivo: "riprova" };
      let corpo;
      try { corpo = await r.json(); } catch { return { ok: false, motivo: "riprova" }; }
      if (!corpo || corpo.ok !== true || !saldoValido(corpo.saldo)) return { ok: false, motivo: "riprova" };
      return { ok: true, saldo: corpo.saldo };
    },
  };
}
