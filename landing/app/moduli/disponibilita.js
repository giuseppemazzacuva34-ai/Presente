// «Il mio profilo › Quando posso ricevere chiamate» (issue #4, spec v1.3 del CPO, 13/11, § 1), passo 3c-5b-1.
// Solo calcoli, niente pagina: la schermata è in flusso.js, il salvataggio in salvataggio.js (salvaDisponibilita).
// Le regole sono le stesse del server (api/chiamate.js e vincolo fascia_v13 del database): il test le confronta su
// tutte le coppie dei selettori, così il telefono non propone mai una fascia che il server rifiuterebbe.

export const FASCIA_DEFAULT = Object.freeze({ da: "09:00", a: "23:00" });

export const TESTI = Object.freeze({
  titolo: "Quando posso ricevere chiamate",
  sottotitolo: "Una sola fascia, uguale per tutti i giorni. Fuori da questa fascia nessuno ti chiama.",
  dalle: "Dalle",
  alle: "Alle",
  pausa: "Oggi non ricevo chiamate",
  notaPausa: "Vale fino alle 23:59 di oggi, poi si spegne da solo.",
  errore: "La fascia deve durare almeno un'ora e finire dopo l'inizio.",
  orarioNonValido: "Scegli un orario valido.",
});

const due = (n) => String(n).padStart(2, "0");
const orario = (minuti) => `${due(Math.floor(minuti / 60))}:${due(minuti % 60)}`;
// Passo di 30 minuti (spec): «Dalle» da 00:00 a 23:30, «Alle» da 00:30 a 24:00.
export const ORARI_DALLE = Object.freeze(Array.from({ length: 48 }, (_, i) => orario(i * 30)));
export const ORARI_ALLE = Object.freeze(Array.from({ length: 48 }, (_, i) => orario((i + 1) * 30)));

const minuti = (hhmm) => {
  const m = /^(?:([01][0-9]|2[0-3]):(00|30)|(24):(00))$/.exec(hhmm || "");
  return m ? Number(m[1] ?? m[3]) * 60 + Number(m[2] ?? m[4]) : null;
};

export function controlla(da, a) {
  const x = minuti(da), y = minuti(a);
  if (x === null || y === null || x === 1440) return { ok: false, errore: TESTI.orarioNonValido };
  if (y - x < 60) return { ok: false, errore: TESTI.errore };
  return { ok: true, fascia: { da, a } };
}

const senzaZero = (hhmm) => hhmm.replace(/^0(\d)/, "$1");
export const testoSalvato = (f) => `Salvato. Da adesso ti chiamano dalle ${senzaZero(f.da)} alle ${senzaZero(f.a)}.`;

// Giorno di Roma (AAAA-MM-GG): il database accetta la pausa solo per oggi secondo quest'ora.
const formatoGiorno = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
export const oggiDiRoma = (adesso = new Date()) => formatoGiorno.format(adesso);

// Valori da mostrare nei selettori: la fascia salvata se è valida, altrimenti il default (come fa il server).
export function daProfilo(p, adesso = new Date()) {
  const valida = p && controlla(p.fascia_da, p.fascia_a).ok;
  return {
    da: valida ? p.fascia_da : FASCIA_DEFAULT.da,
    a: valida ? p.fascia_a : FASCIA_DEFAULT.a,
    pausa: Boolean(p && typeof p.pausa_il === "string" && p.pausa_il === oggiDiRoma(adesso)),
  };
}

// Cosa mandare al database: { ok, campi } oppure { ok: false, errore } (non si salva nulla).
export function campiDaSalvare({ da, a, pausa }, adesso = new Date()) {
  const c = controlla(da, a);
  if (!c.ok) return c;
  return { ok: true, campi: { fascia_da: da, fascia_a: a, pausa_il: pausa ? oggiDiRoma(adesso) : null } };
}
