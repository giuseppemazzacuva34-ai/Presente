# Risposte automatiche ai commenti «BUIO» (Instagram e Facebook)

Versione 1.0 · 29 ottobre 2026 · autore: CTO («sviluppatore»). Richiesta: decisione di Giuseppe del 29/10 (risposta entro 10 minuti).

## In parole semplici

Quando qualcuno scrive **BUIO** sotto un nostro post o un'inserzione (Instagram o Pagina Facebook), Meta avvisa subito il nostro sito.
Il sito, in pochi secondi:

1. manda alla persona **in privato** il link della lista d'attesa (`presenteincontri.app/da/instagram` o `/da/facebook`, così le iscrizioni si contano per canale);
2. risponde **in pubblico** al commento: «Ti abbiamo scritto in privato 🖤».
   Se il messaggio privato non parte (per esempio la persona ha i messaggi chiusi), la risposta pubblica contiene direttamente il link.

Non si salva niente: nessun database, nessun nome, nessun testo. Nei log finiscono solo numeri («commenti BUIO 1, risposte riuscite 1»).
Costo: zero (stesso Worker gratuito della landing, nessun servizio in più).

La «Sentinella commenti» oraria resta come rete di sicurezza finché questo non è acceso e provato.

## Come funziona (tecnica)

- Codice: `worker/meta.js`, collegato in `worker/index.js` all'indirizzo **`https://presenteincontri.app/meta/webhook`**. Test: `test/meta.test.mjs` (eseguiti da «Verifica»).
- **Verifica dell'indirizzo** (GET): Meta manda `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`; il Worker restituisce la sfida solo se la parola coincide con il Secret `META_VERIFY_TOKEN`.
- **Notifiche** (POST): il Worker controlla la firma `X-Hub-Signature-256` (HMAC-SHA256 del corpo con il Secret `META_APP_SECRET`, confronto a tempo costante). Firma sbagliata o assente → 401 e nient'altro.
- Campi ascoltati: oggetto `instagram`, campo `comments`; oggetto `page` (Pagina 1409616645567240), campo `feed` con `item = comment` e `verb = add`.
- «BUIO» va bene come parola in qualunque punto, maiuscole o minuscole, con punteggiatura ed emoji («buio!», «Voglio il BUIO 🖤»); non vale dentro altre parole («abbuiato»).
- Non si risponde mai ai commenti scritti dalla Pagina o dall'account Instagram di Presente (niente risposte a catena).
- Risposta privata: `POST /{id Pagina}/messages` con `recipient.comment_id` (vale per Facebook e Instagram collegato alla Pagina). Risposta pubblica: Instagram `POST /{id commento}/replies`, Facebook `POST /{id commento}/comments`. Versione delle API in `META_GRAPH_VERSIONE` (`wrangler.jsonc`).
- Il Worker risponde subito 200 a Meta e lavora in sottofondo: così Meta non ripete la chiamata e non si risponde due volte.
- I testi si possono cambiare senza toccare il codice, con le variabili `META_TESTO_PRIVATO`, `META_TESTO_PUBBLICO`, `META_TESTO_PUBBLICO_LINK` (`{link}` viene sostituito dal link giusto). Li decidono CMO e social.
- **Interruttore**: `RISPOSTE_META` in `wrangler.jsonc`. Oggi `"no"`: Meta può già verificare l'indirizzo, ma nessuno riceve risposte. Si mette `"si"` dopo la prova descritta sotto.

Limiti di Meta da sapere: il messaggio privato si può mandare **una sola volta per commento** ed **entro 7 giorni**; su Instagram la persona lo trova tra le «richieste di messaggio» se non ci segue. Da verificare nella prova: che arrivino anche i commenti sotto le **inserzioni** (per Facebook sì, per Instagram dipende dal tipo di inserzione).

## Cosa deve fare Giuseppe su Meta (una volta sola)

I segreti si scrivono **solo** su Cloudflare (Workers → `presente` → Impostazioni → Variabili e segreti → «Segreto»), **mai** in chat, in plancia o nel repository.

1. **App Meta**: su developers.facebook.com → «Crea app» → tipo «Business», collegata al Business Manager di Presente. Aggiungi i prodotti «Webhooks», «Messenger» e «Instagram» (API con accesso tramite Facebook).
2. **Segreti su Cloudflare**:
   - `META_APP_SECRET` = «Chiave segreta» dell'app (Impostazioni app → Di base);
   - `META_VERIFY_TOKEN` = una parola lunga inventata da te (almeno 20 caratteri), da scrivere identica anche su Meta al passo 3;
   - `META_PAGE_TOKEN` = token di accesso della Pagina **a lunga durata** (con i permessi del passo 4).
3. **Webhook**: in «Webhooks», per «Page» e per «Instagram» inserisci URL `https://presenteincontri.app/meta/webhook` e la stessa parola di `META_VERIFY_TOKEN`; spunta i campi `feed` (Page) e `comments` (Instagram). Poi collega la Pagina all'app (in Messenger → Impostazioni → «Aggiungi abbonamenti» con `feed`).
4. **Permessi** da chiedere nella «Revisione dell'app» (servono in «Accesso avanzato» per rispondere a persone che non sono amministratori dell'app): `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_engagement`, `pages_messaging`, `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages`. Meta chiede un breve video della funzione: lo prepariamo noi quando serve.
5. **Verifica dell'azienda** (Business Manager → Centro sicurezza): richiesta per l'accesso avanzato; servono i dati dell'attività.
6. Nell'app Instagram: Impostazioni → Messaggi → «Strumenti collegati» → **consenti l'accesso ai messaggi**.
7. **Modalità Live** dell'app (in alto nella dashboard), quando la revisione è approvata.
8. Scrivi al CTO in plancia «Meta pronta» (senza segreti): il CTO fa la prova con un commento di un tester, poi mette `RISPOSTE_META` a `"si"`.

Prima della revisione si può già provare con gli account che sono amministratori o tester dell'app (modalità sviluppo).

## Privacy

Il Worker usa l'id del commento solo per rispondere e non conserva nulla. Il messaggio privato lo consegna Meta, sulla sua piattaforma.
Da confermare con il CFO (Legal & Privacy) se l'informativa social va integrata con una riga sulle risposte automatiche.
