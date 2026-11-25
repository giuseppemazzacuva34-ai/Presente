// Avvisi al responsabile della sicurezza (Fase 2, issue #7 spec v1.1; D51 A, D139 A; #10 v1.1 per «Scrivici»). Linea «sviluppatore-b».
// Ogni minuto (cron CRON_AVVISI in wrangler.jsonc, gratuito) il Worker:
//  1. chiede al database gli avvisi da ripetere (public.avvisi_da_ripetere: segnalazioni da 1 ora non aperte dopo
//     30 minuti, sospensioni non riviste dopo 48 ore ogni 12 ore) e li mette in coda in public.avvisi_sicurezza;
//  2. legge la coda non ancora spedita e manda UNA email via Brevo (piano gratuito) alla casella della sicurezza;
//  3. solo se Brevo risponde bene, segna gli avvisi come spediti. Se qualcosa va storto restano in coda per il minuto dopo.
// Nel testo solo tipi e numeri: mai nomi, email, racconti o id (D139 A). Nei log solo numeri e codici di stato.
// Spento finché ACCESSO_APP non vale «si» o «tester» o mancano i segreti BREVO_API_KEY (chiave Brevo) ed EMAIL_SICUREZZA
// (casella di destinazione): li inserisce Giuseppe su Cloudflare, mai nel repository.
import { accessoAperto } from "./accesso_tester.js"; // «si» o «tester» (#8, test interno)

export const CRON_AVVISI = "* * * * *";
const ATTESA_MS = 10000;
const MITTENTE = { name: "Presente · sicurezza", email: "ciao@presenteincontri.app" }; // mittente autenticato (docs/email.md)
const PANNELLO = "https://presenteincontri.app/app/pannello.html";
const ID = /^[0-9a-f-]{36}$/i;

const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

// Oggetto e testo dell'email: solo quanti avvisi e di che tipo.
export function testoAvviso(avvisi) {
  const conta = (p) => avvisi.filter((a) => a && a.perche === p).length;
  const nuove = conta("nuova");
  const nonAperte = conta("non_aperta");
  const sospensioni = conta("revisione_scaduta");
  const supporto = conta("supporto"); // messaggi «Scrivici» con bandiera «sicurezza» o «possibile minore» (#10 v1.1)
  const righe = [];
  if (nuove) righe.push(`- ${plurale(nuove, "segnalazione nuova", "segnalazioni nuove")} con priorità 1 ora`);
  if (nonAperte) righe.push(`- ${plurale(nonAperte, "segnalazione non ancora aperta", "segnalazioni non ancora aperte")} dopo 30 minuti`);
  if (sospensioni) righe.push(`- ${plurale(sospensioni, "sospensione da rivedere", "sospensioni da rivedere")} (48 ore passate)`);
  if (supporto) righe.push(`- ${plurale(supporto, "messaggio «Scrivici» da guardare", "messaggi «Scrivici» da guardare")} subito (pericolo o possibile minore)`);
  const totale = nuove + nonAperte + sospensioni + supporto;
  return {
    oggetto: `Presente · avviso di sicurezza (${totale})`,
    testo: [
      "Ci sono avvisi di sicurezza da guardare:",
      ...righe,
      "",
      `Apri il pannello: ${PANNELLO}`,
      "Se qualcuno è in pericolo, il riferimento resta il 112.",
      "",
      "Email automatica di Presente: nessun nome o racconto qui per scelta, i dettagli sono solo nel pannello.",
    ].join("\n"),
  };
}

// Restituisce { esito: "spento" | "niente" | "spedito" | "errore", avvisi? }. Mai eccezioni verso chi la chiama.
export async function spedisciAvvisiSicurezza(env, f = fetch) {
  if (!env || !accessoAperto(env) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.BREVO_API_KEY || !env.EMAIL_SICUREZZA) {
    return { esito: "spento" };
  }
  const base = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/rest/v1`;
  const chiave = env.SUPABASE_SERVICE_ROLE_KEY;
  const intestazioni = { apikey: chiave, authorization: `Bearer ${chiave}`, "content-type": "application/json" };
  const opzioni = (method, body, extra = {}) => ({
    method,
    headers: { ...intestazioni, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(ATTESA_MS),
  });
  try {
    // 1. Avvisi da ripetere → in coda.
    const r1 = await f(`${base}/rpc/avvisi_da_ripetere`, opzioni("POST", {}));
    if (!r1.ok) return errore("ripetere", r1.status);
    const ripetere = (await r1.json()) || [];
    if (Array.isArray(ripetere) && ripetere.length) {
      const righe = ripetere.map((a) => ({ segnalazione_id: a.segnalazione_id ?? null, sospensione_id: a.sospensione_id ?? null, perche: a.perche }));
      const r2 = await f(`${base}/avvisi_sicurezza`, opzioni("POST", righe, { prefer: "return=minimal" }));
      if (!r2.ok) return errore("coda", r2.status);
    }
    // 2. Coda non spedita.
    const r3 = await f(`${base}/avvisi_sicurezza?select=id,perche&inviato_il=is.null&order=creato_il&limit=100`, opzioni("GET"));
    if (!r3.ok) return errore("lettura", r3.status);
    const coda = ((await r3.json()) || []).filter((a) => a && ID.test(String(a.id)));
    if (!coda.length) return { esito: "niente" };
    // 3. Una sola email.
    const { oggetto, testo } = testoAvviso(coda);
    const r4 = await f("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ sender: MITTENTE, to: [{ email: String(env.EMAIL_SICUREZZA).trim() }], subject: oggetto, textContent: testo }),
      signal: AbortSignal.timeout(ATTESA_MS),
    });
    if (!r4.ok) return errore("brevo", r4.status);
    // 4. Segnati come spediti solo quelli letti e spediti.
    const r5 = await f(`${base}/avvisi_sicurezza?id=in.(${coda.map((a) => a.id).join(",")})`,
      opzioni("PATCH", { inviato_il: new Date().toISOString() }, { prefer: "return=minimal" }));
    if (!r5.ok) return errore("segna", r5.status);
    console.log(`avvisi di sicurezza: spediti ${coda.length}`);
    return { esito: "spedito", avvisi: coda.length };
  } catch (e) {
    console.error("avvisi di sicurezza: errore", e && e.name);
    return { esito: "errore" };
  }
}

function errore(passo, stato) {
  console.error(`avvisi di sicurezza: ${passo} risposta ${stato}`);
  return { esito: "errore" };
}
