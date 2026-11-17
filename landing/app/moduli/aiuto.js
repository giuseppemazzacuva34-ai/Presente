// Pagina Aiuto nella web app (issue #10, spec v1 del CPO del 6/11, parte A; passo 3a della linea «sviluppatore-c»).
// In alto «Sono in difficoltà» (porta alla schermata della #7), poi le domande frequenti con «Cerca» (filtra sul
// telefono, niente invio al server), in fondo «Scrivici» e «I miei messaggi».
// Il corpo non dice mai chi scrive: lo dice solo il token (worker/supporto_api.js). L'email per la risposta è quella
// dell'account, mostrata e non modificabile. Nessun allegato, nessun salvataggio sul telefono.
// Questo modulo non tocca la pagina: riceve fetch e token dall'esterno, così si prova con node --test.
// Le richieste rispondono solo con l'accesso acceso (ACCESSO_APP = «si»).
// I testi sono quelli della spec; le 12 risposte sono del CPO, con il gate_v3 dei «contenuti» (17/11).

const PERCORSO = "/app/api/supporto";
const ATTESA_MS = 8000;
const MASSIMO = 1000;

export const TESTI_AIUTO = Object.freeze({
  titolo: "Aiuto",
  sicurezza: "Hai bisogno di aiuto subito per la tua sicurezza?",
  difficolta: "Sono in difficoltà",
  domande: "Domande frequenti",
  cerca: "Cerca",
  nonTrovato: "Non hai trovato la risposta?",
  scrivici: "Scrivici",
  miei: "I miei messaggi",
});

// Le 12 domande frequenti con le risposte: testi del CPO (bozze/cpo-testi-aiuto-20261106, max 60 parole),
// passati dal gate_v3 di brand dei «contenuti» il 17/11. Forma: [{ domanda, risposta }].
export const DOMANDE_FREQUENTI = Object.freeze([
  ["Come funziona una stanza",
   "Ogni lunedì alle 9 entri in una stanza con 11 persone compatibili con te. Per 7 giorni ascolti le loro voci e fai chiamate solo voce da 15 minuti: fino a 5 al giorno, massimo 3 con la stessa persona. Domenica alle 21 si aprono le porte."],
  ["Quando si apre la mia zona",
   "La tua zona apre le sue stanze quando ha 36 profili completi, con almeno il 40% di donne. In home vedi quante persone mancano. Intanto puoi entrare nella Stanza Italia, se allarghi il raggio. Invitare un'amica aiuta la tua zona ad aprire prima."],
  ["Perché vedo poche persone nella stanza",
   "Mettiamo insieme solo persone compatibili con te e con il raggio che hai scelto. Quando siamo ancora in pochi, una stanza può avere meno di 12 persone. Se siete meno di 6, la stanza non ti costa crediti. Allargare il raggio ti fa conoscere più persone."],
  ["Le mie foto chi le vede",
   "Le foto le carichi all'iscrizione, ma restano nascoste. Non le vede nessuno nella stanza. Le scopre solo la persona con cui si apre una porta, dopo lo svelamento, e tu scopri le sue. Fino ad allora conta solo la voce."],
  ["Come funzionano le chiavi",
   "Ogni settimana hai 2 chiavi. Puoi darle in segreto a chi hai già chiamato nella stanza e riprenderle fino alle 20:59 di domenica. Nessuno sa a chi le hai date. Una porta si apre solo se la chiave è reciproca."],
  ["Cosa succede quando si apre la porta",
   "Domenica alle 21 scopri se si è aperta una porta. Da lì avete 48 ore per lo svelamento: una videochiamata di 10 secondi che parte sfocata, oppure le foto, se uno dei due preferisce. Poi ognuno dice in segreto se vuole incontrare l'altra persona."],
  ["Cos'è la caparra",
   "Dopo la porta bloccate 10 crediti a testa. Se uno dei due dice no o non risponde, i crediti tornano a entrambi. Con il sì di tutti e due restano bloccati fino all'incontro: li perde solo chi dà buca."],
  ["Cosa succede se qualcuno dà buca",
   "Se l'incontro è confermato e una persona non si presenta, i suoi 10 crediti vanno così: 7 a chi ha aspettato, 3 a Presente. Il check-in «Sono qui» dice chi era sul posto. Chi dà buca paga, chi aspetta no."],
  ["Come uso i crediti",
   "Un credito vale 1 €. La prima stanza è in regalo, poi ogni stanza costa 9 crediti. Chiavi e diario sono compresi. I crediti servono anche per la caparra dopo la porta. Durante la prova usi crediti di prova, che non valgono denaro."],
  ["Come cambio provincia o raggio",
   "Da «Il mio profilo». La provincia si cambia una volta ogni 7 giorni e vale dal lunedì dopo. Il raggio (solo la mia zona, anche altre città, anche dall'estero nella mia lingua) vale dalla prossima stanza."],
  ["Come blocco o segnalo qualcuno",
   "Dalla scheda della persona, oppure durante la chiamata con «Chiudi e segnala». Il blocco è immediato e definitivo: non vi vedrete più in nessuna stanza. L'altra persona non saprà chi l'ha bloccata o segnalata. Se sei in pericolo, chiama il 112."],
  ["Come cancello l'account",
   "Da «Il mio profilo» › «Elimina il mio account». Cancelliamo voce, foto, risposte e diario. Le segnalazioni ancora aperte restano solo per il tempo necessario a gestirle. Puoi farlo quando vuoi, anche a metà settimana."],
].map(([domanda, risposta]) => Object.freeze({ domanda, risposta })));

// Le 7 categorie della spec, con i codici della tabella «supporto».
export const CATEGORIE_SCRIVICI = Object.freeze([
  ["account", "Account e accesso"],
  ["stanza_chiamate", "Stanza e chiamate"],
  ["chiavi_porte", "Chiavi e porte"],
  ["crediti", "Crediti"],
  ["incontro", "Incontro"],
  ["test", "Test"],
  ["altro", "Altro"],
].map(Object.freeze));
const VALORI = new Set(CATEGORIE_SCRIVICI.map(([v]) => v));

const lunghezza = (s) => [...String(s ?? "")].length;
export const contatore = (testo) => `${lunghezza(testo)}/${MASSIMO}`;

export function moduloScrivici(email) {
  return {
    titolo: TESTI_AIUTO.scrivici,
    categorie: CATEGORIE_SCRIVICI,
    email: typeof email === "string" ? email : "",
    emailModificabile: false,
    massimo: MASSIMO,
    invia: "Invia",
  };
}

const ERRORI = Object.freeze({
  vuoto: "Scrivi cosa è successo, anche in due parole",
  troppi: "Hai già scritto 5 volte oggi. Ti rispondiamo su quelle",
  rete: "Sei senza connessione. Riprova tra poco.",
  accesso: "Accedi di nuovo per inviare il messaggio.",
  troppe: "Troppi tentativi. Aspetta un minuto.",
  dati: "Controlla il modulo e riprova.",
});
export const testoErroreAiuto = (motivo) => (Object.hasOwn(ERRORI, motivo) ? ERRORI[motivo] : "Non è andata. Riprova tra poco.");

// scelte = { categoria, testo } → { ok, corpo } | { ok: false, errore }
export function corpoScrivici(scelte = {}) {
  const s = scelte && typeof scelte === "object" ? scelte : {};
  if (!VALORI.has(s.categoria)) return { ok: false, errore: ERRORI.dati };
  const testo = typeof s.testo === "string" ? s.testo : "";
  if (testo.trim() === "") return { ok: false, errore: ERRORI.vuoto };
  if (lunghezza(testo) > MASSIMO) return { ok: false, errore: ERRORI.dati };
  return { ok: true, corpo: { categoria: s.categoria, testo } };
}

// Dopo l'invio; con parole di pericolo (bandiera «sicurezza» dal server) mostra subito «Sono in difficoltà».
export function confermaScrivici({ sicurezza } = {}) {
  return {
    testo: "Ricevuto. Ti rispondiamo per email entro 48 ore (di solito prima)",
    difficolta: sicurezza === true ? TESTI_AIUTO.difficolta : null,
  };
}

export const statoMessaggio = (m) => (m && m.stato === "risposto" ? "Risposto" : "Inviato");

// «Cerca»: filtra domande e risposte sul telefono; maiuscole e accenti non contano.
const semplice = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function filtraDomande(domande, cerca) {
  const elenco = Array.isArray(domande) ? domande : [];
  const q = semplice(cerca).trim();
  if (!q) return elenco;
  return elenco.filter((d) => semplice(d && d.domanda).includes(q) || semplice(d && d.risposta).includes(q));
}

export function creaAiuto({ token, fetch: f = globalThis.fetch, attesa = ATTESA_MS }) {
  async function chiedi(metodo, corpo) {
    const t = await Promise.resolve().then(token).catch(() => null);
    if (!t) return { errore: "accesso" };
    const ferma = new AbortController();
    const timer = setTimeout(() => ferma.abort(), attesa);
    try {
      let r;
      try {
        const headers = { authorization: `Bearer ${t}` };
        if (corpo !== undefined) headers["content-type"] = "application/json";
        r = await f(PERCORSO, { method: metodo, signal: ferma.signal, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      } catch {
        return { errore: "rete" };
      }
      if (r.status === 401) return { errore: "accesso" };
      if (r.status === 429) return { errore: "troppe" };
      if (r.status === 404) return { errore: "spento" };
      try {
        const dati = await r.json();
        return dati && typeof dati === "object" ? { dati } : { errore: "riprova" };
      } catch {
        return { errore: "riprova" };
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async invia(corpo) {
      const { dati, errore } = await chiedi("POST", corpo || {});
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok === true && typeof dati.id === "string") return { ok: true, id: dati.id, sicurezza: dati.sicurezza === true };
      const motivo = typeof dati.motivo === "string" && Object.hasOwn(ERRORI, dati.motivo) ? dati.motivo : "riprova";
      return { ok: false, motivo };
    },
    async miei() {
      const { dati, errore } = await chiedi("GET");
      if (errore) return { ok: false, motivo: errore };
      if (dati.ok !== true || !Array.isArray(dati.messaggi)) return { ok: false, motivo: "riprova" };
      return {
        ok: true,
        email: typeof dati.email === "string" ? dati.email : "",
        messaggi: dati.messaggi.map((m) => ({
          id: m.id, categoria: m.categoria, testo: m.testo, creatoIl: m.creatoIl,
          stato: m.stato === "risposto" ? "risposto" : "inviato", risposta: m.risposta ?? null, rispostoIl: m.rispostoIl ?? null,
        })),
      };
    },
  };
}
