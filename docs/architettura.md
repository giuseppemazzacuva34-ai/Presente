# Architettura della Fase 2 (beta)

Versione 1.2 · 29 ottobre 2026 (v1: 28 ottobre) · autore: CTO («sviluppatore»).
Fonti: tab «Struttura dell'app» del business plan, specifiche del CPO nelle issue #2, #3, #4 (v1 del 27 ottobre) e decisioni D14–D20, D23 A, D24 A, D30 B, D31 B, D32 A, D35 A.
Questo documento descrive *come* è costruita l'app; *cosa* fa lo decidono le specifiche del CPO. Se le due cose non coincidono, valgono le specifiche e questo documento va corretto.

## In parole semplici

- L'app è una **web app installabile** (D24 A): si apre da un link, si aggiunge alla schermata Home, niente store.
- **Supabase in Europa** (D23 A) tiene account, profili, stanze, chiavi, crediti e i file privati (voce e foto). Ogni riga e ogni file ha regole di accesso: un utente legge solo ciò che le regole gli permettono, anche se prova a chiamare il server a mano.
- Le **chiamate solo voce** passano da **Cloudflare Realtime** (WebRTC): l'audio va da telefono a telefono attraverso i server di Cloudflare e non viene mai salvato.
- Un piccolo **Worker Cloudflare** fa da «portinaio» per le cose che il browser non deve poter fare da solo: aprire una chiamata, mandare notifiche, eseguire i lavori programmati (lunedì 9:00, domenica 21:00).
- La landing e la lista d'attesa di oggi restano dove sono e non cambiano.

## Componenti

| Componente | Dove gira | Cosa fa | Costo in beta |
| --- | --- | --- | --- |
| Web app (PWA) | Worker `presente` (lo stesso della landing), indirizzo `presenteincontri.app/app/`, file in `landing/app/` | Schermate, registrazione voce, chiamate nel browser, service worker per notifiche e installazione | Gratis |
| Supabase (regione UE, Francoforte) | Supabase | Accesso con link via email, database Postgres con regole per riga (RLS), Storage privato per voce e foto, canali in tempo reale per squilli e stato «disponibile ora», lavori programmati (`pg_cron`) | Piano gratuito (500 MB database, 1 GB file) |
| Worker `presente-api` | Cloudflare Workers | Unico posto con le chiavi segrete: crea le sessioni di chiamata su Realtime, controlla i limiti (3 con la stessa persona, 5 al giorno, fascia di disponibilità, stessa stanza), manda le notifiche push, esegue i lavori del lunedì e della domenica (Cron Triggers) | Gratis (100.000 richieste al giorno) |
| Cloudflare Realtime | Cloudflare | Trasporto dell'audio delle chiamate (e del video sfocato dopo la porta, #6) | 1.000 GB al mese di traffico gratis; una chiamata voce da 15 minuti usa pochi MB |
| Landing e lista d'attesa | Worker `presente` (già online) | Invariata | Gratis |

Linguaggi e strumenti (**cambiati il 29/10**, vedi sotto): JavaScript moderno del browser (moduli ES) **senza framework e senza librerie da installare**; Supabase si usa con le sue API HTTP (accesso, database, file) chiamate con `fetch`, l'audio con le API WebRTC del browser. Test: `node --test` e i controlli in `scripts/` (nessuna dipendenza), più prove con il browser Chromium già disponibile nell'ambiente di sviluppo. Tutto in questo repository: `landing/app/` (web app), `worker/` (Worker `presente`), `api/` (Worker `presente-api`, dalla #4), `supabase/` (schema, regole di accesso, migrazioni). Il controllo «Verifica» esegue i test e il controllo delle regole di accesso a ogni pull request.

**Perché niente SvelteKit (cambio del 29/10).** L'ambiente in cui il CTO lavora non raggiunge il registro dei pacchetti npm: con un framework non potrebbe installare, provare né aggiornare le librerie, e ogni modifica andrebbe alla cieca. Senza dipendenze l'app non ha passaggio di build, è leggerissima sui telefoni economici, non ha librerie di terzi da tenere aggiornate (meno rischi di sicurezza) e ogni file si prova subito. Il prezzo è un po' più di codice scritto a mano per le schermate. Se in futuro serve un framework, si rivaluta.

## Dati

Tutti in Supabase UE, tranne il trasporto delle chiamate (che non salva nulla). Nomi indicativi delle tabelle:

| Tabella / cartella | Contenuto | Chi può leggere |
| --- | --- | --- |
| `profili` | nome, data di nascita, città, mi presento come, disponibilità | Il proprietario; gli altri della stessa stanza vedono solo nome, età (calcolata), città |
| `filtri` | cerco, età cercata, raggio, cosa cerco, figli, fumo + consenso separato con data e versione dell'informativa | Solo il proprietario e il lavoro che compone le stanze |
| `questionario` | 15 risposte e «quanto conta», con la versione del questionario (`v1`) | Solo il proprietario e il lavoro che compone le stanze; mai mostrato a nessuno. Domande, pesi e calcolo dell'affinità in `api/questionario.js` (solo server): ogni tema vale peso × media dei due «quanto conta» ÷ 3, e il totale si riporta su 0–100 rispetto al massimo possibile con quei «quanto conta» (profili identici = 100, tutto diverso e lontano = 0) |
| Storage `voci/` | presentazione da 20 s e 3 risposte da 30 s | Il proprietario; gli altri della stessa stanza tramite link temporaneo (pochi minuti) |
| Storage `foto/` | 3 foto, ridimensionate e senza dati EXIF | Il proprietario; l'altra persona solo dopo porta e patto (#6), tramite link temporaneo |
| `stanze`, `membri_stanza` | composizione settimanale | I membri della stanza |
| `chiamate` | chi, con chi, quando, durata. **Nessun audio, nessuna trascrizione** | I due partecipanti (per i contatori) |
| `richiameresti` | sì/no segreto dopo ogni chiamata | Solo il lavoro dei suggerimenti; mai l'altra persona |
| `diario` | note private | **Solo il proprietario.** Nessun lavoro automatico ha il permesso di leggerlo: è escluso per regola del database, non solo per scelta del codice |
| `chiavi`, `porte`, `patti` | 2 chiavi a settimana, porte reciproche della domenica, patto e incontro | I due interessati |
| `crediti_movimenti` | registro dei crediti (in beta contatore interno, D30 B; Stripe in Fase 4) | Il proprietario |
| `segnalazioni`, `blocchi` | #7 | Chi segnala; la revisione umana |

Regole che valgono per tutto:
- Nessun dato personale verso servizi esterni oltre a Supabase e Cloudflare (già indicati nell'informativa da aggiornare prima della beta).
- Cancellazione dell'account: una sola funzione cancella righe e file in Supabase (D23 A: un solo posto). È `POST /app/api/elimina-account` (worker/elimina.js): Supabase dice chi è l'utente dal suo token, il Worker cancella prima tutti i file in `voci/<id>/` e `foto/<id>/`, controlla che le cartelle siano vuote e solo dopo cancella l'account (le righe collegate spariscono da sole, `on delete cascade`). Se i file non si cancellano l'account resta e si riprova: mai un account cancellato con file rimasti. Spento finché `ACCESSO_APP` non vale «si»; usa il secret del Worker `SUPABASE_SERVICE_ROLE_KEY`; massimo 3 richieste al minuto per connessione (`LIMITE_ELIMINA`).
- Provincia dalla lista d'attesa (#2 v1.3): `GET /app/api/provincia-lista` (worker/provincia_lista.js) restituisce al telefono solo la sigla trovata nella lista per l'email confermata del login; `POST` con la stessa sigla la salva con origine «lista» tramite `public.conferma_provincia_lista` (solo service_role, solo se la provincia è ancora vuota). Lista e app restano due archivi separati: l'app non scrive mai nella lista. Spento finché `ACCESSO_APP` non vale «si»; `LIMITE_PROVINCIA` 10 richieste al minuto.
- Contatore della zona (#3 v1.2): `GET /app/api/zona` (worker/zona.js) restituisce al telefono solo `{ zona, accesa, testo }` della propria area, calcolati dal server con la provincia in vigore del profilo e `public.conteggi_aree()` (solo service_role, solo numeri). Spento finché `ACCESSO_APP` non vale «si».
- File di voce e foto con nomi fissi (`presentazione`, `risposta-1…3`, `foto-1…3`): al massimo 4 voci e 3 foto a persona, controllato dalle regole per riga dello Storage.
- Le chiavi segrete stanno solo nei «secret» di Cloudflare e Supabase, mai nel repository.

### Dove stanno le chiavi (decisione del 29/10)

Giuseppe crea Supabase (progetto «presente», Francoforte) e l'app Cloudflare Realtime, e mette le chiavi **solo** come segreti del repository su GitHub, con questi nomi. Mai in chat, nella plancia o nel codice.

| Segreto GitHub | A cosa serve | Dove arriva |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Indirizzo del progetto e chiave pubblica: da sola non apre nulla, le regole per riga decidono chi vede cosa | Nella web app al momento della build |
| `SUPABASE_SERVICE_ROLE_KEY` | Chiave «amministratore» per i lavori del lunedì e della domenica | Solo nel Worker `presente-api` (secret Cloudflare), mai nel browser |
| `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | Applicare le migrazioni del database (tabelle e regole per riga) dal workflow | Solo nel workflow di pubblicazione |
| `REALTIME_APP_ID`, `REALTIME_APP_SECRET` | Creare le sessioni delle chiamate su Cloudflare Realtime | Solo nel Worker `presente-api` (secret Cloudflare) |

Il workflow legge i segreti solo nel job di pubblicazione su `main` (mai nelle pull request) e li passa al Worker con `wrangler secret put`. Se un segreto manca, la pubblicazione di quella parte si salta con un avviso e «Verifica» resta verde.

**Stato al 29/10: tutti e 8 i segreti ci sono e funzionano.** Si controllano quando si vuole da GitHub → Actions → «Verifica segreti» → Run workflow: il controllo prova ogni chiave con una chiamata di sola lettura e scrive solo nomi ed esiti, mai valori.

Struttura del progetto per la Fase 2 (pronta dal 29/10, si riempie dal 2/11):

| Cartella / file | Contenuto |
|---|---|
| `supabase/config.toml` | Configurazione del progetto per la CLI di Supabase (nessuna chiave: il collegamento usa `SUPABASE_PROJECT_REF` e `SUPABASE_ACCESS_TOKEN` dai segreti) |
| `supabase/migrations/` | Tabelle e regole per riga, una migrazione per issue; si applicano dal workflow su `main` |
| `.env.example` | Solo i **nomi** delle variabili, per sviluppare in locale; il file `.env` vero è escluso da git |
| `landing/app/` (dal 29/10, #1) | Web app installabile: pagina, `manifest.webmanifest`, service worker `sw.js`, icone. Il Worker la serve sotto `/app/` con intestazioni di sicurezza proprie (`worker/app.js`): script solo dal nostro dominio, collegamenti solo a Supabase e Cloudflare Realtime, microfono solo per il nostro sito, fuori da Google. Dalla #2 riceverà `SUPABASE_URL` e `SUPABASE_ANON_KEY` dal Worker (secret Cloudflare del Worker `presente`; la chiave anon è pubblica per natura, le regole per riga decidono chi vede cosa) |
| `api/` (dalla #4) | Worker `presente-api`; riceve come secret Cloudflare `SUPABASE_SERVICE_ROLE_KEY`, `REALTIME_APP_ID`, `REALTIME_APP_SECRET` |
- Test automatico in «Verifica»: con due account di prova, l'account B non riesce a leggere foto, questionario, filtri e diario dell'account A (criterio di accettazione della #2).

## Provincia al passo 5 (#2 v1.3, D84 A)

Primo passo fatto il 3/11: regole nel database (`supabase/migrations/20261103120000_provincia.sql`). Secondo passo fatto il 6/11: menu «Dove vivi?» nell'app (`landing/app/moduli/province.js`, stessi valori di `opzioniMenu()`), si salva solo la sigla e `provincia_origine`; città e regione le scrive il database; i messaggi fissi del database («Puoi cambiarla di nuovo dal GG/MM.») arrivano all'app così come sono, ogni altro errore resta generico; profilo senza provincia → al rientro si torna a «Chi sei». Terzo passo fatto il 6/11 (PR #137): precompilazione lato server (il Worker cerca l'email confermata nella lista D1 e restituisce solo la sigla, entro 2 secondi, altrimenti campo vuoto). Quarto passo fatto il 6/11 sera: cambio da «Il mio profilo» («Cambia provincia» apre solo «Chi sei» e torna al profilo; il telefono scrive quando vale il cambio, il database decide e rifiuta il secondo cambio entro 7 giorni). La v1.3 è completa.

## Accesso con email (#2, pronto dal 29/10 ma spento)

1. L'utente scrive l'email; l'app chiama Supabase Auth (`/auth/v1/otp`) con la sola chiave anon. Supabase crea l'account se non c'è e manda **un'email con link e codice di 6 cifre**.
2. Link: apre `presenteincontri.app/app/#access_token=…`. La parte dopo «#» non arriva a nessun server; l'app la legge e la cancella subito dall'indirizzo e dalla cronologia.
3. Codice: su iPhone la web app nella Home ha una memoria separata da Safari, quindi il link entrerebbe in Safari e non nell'app. Per questo l'app chiede anche il codice (`/auth/v1/verify`).
4. Sul telefono restano solo token, scadenza e id utente (niente email). Il token si rinnova da solo un minuto prima della scadenza; se il rinnovo è rifiutato si rientra con una nuova email.
5. Interruttore: `ACCESSO_APP` in `wrangler.jsonc` (oggi `"no"`, sempre `"no"` nelle anteprime). Con `"no"` l'app resta in anteprima e non chiama Supabase.

Da fare in Supabase prima di accendere (pannello Authentication, lo fa Giuseppe con le istruzioni del CTO): Site URL `https://presenteincontri.app/app/` e solo questo indirizzo tra i Redirect URL; modello dell'email «Magic link» in italiano con link e `{{ .Token }}`; scadenza del codice 1 ora (specifica). Il servizio email incluso basta per le prove interne, non per la beta (vedi «Email di servizio» nelle scelte aperte).

## Salvataggio dell'iscrizione (#2, pronto dal 30/10 ma spento)

1. Il telefono parla direttamente con Supabase (`landing/app/moduli/salvataggio.js`), sempre con il token dell'utente: valgono le regole per riga, nessuna chiave amministratore.
2. Ogni «Continua» salva il passo: `profili` (data di nascita, regole, chi sei, domande a voce scelte, `passo` raggiunto), `filtri` (senza data del consenso: la mette il server), file `voci/<id>/presentazione`, `risposta-1…3`, `foto/<id>/foto-1…3` (sostituiti, mai aggiunti), `questionario` alla fine di ogni tema (una sola riga «della prossima settimana»).
3. Al rientro l'app legge tutto, riscarica voce e foto per riascoltarle e riparte dal passo salvato (il passo salvato non torna mai indietro quando si modifica il profilo).
4. Minorenne: l'account creato con l'email viene cancellato subito con `/app/api/elimina-account`.
5. Chi esce dall'estero senza indicare il paese è salvato con il codice `ZZ` (sconosciuto) finché non arriva la scelta del paese.

## Flusso di una chiamata (#4)

1. A tocca «Chiama». La web app chiede al Worker `presente-api` di aprire la chiamata, con il token di accesso Supabase di A.
2. Il Worker controlla: A e B sono nella stessa stanza aperta, nessun blocco, B è nella sua fascia di disponibilità, meno di 3 chiamate valide tra loro, meno di 5 oggi per entrambi, nessuno dei due è già in chiamata, eventuale permesso di B (D32). Se un controllo fallisce risponde con il testo giusto («Disponibile da 19:00», «Avete già parlato 3 volte…»).
3. Il Worker crea la sessione su Cloudflare Realtime con la chiave segreta, registra in `chiamate` l'inizio e fa squillare B: notifica push (se l'app è installata) + messaggio sul canale in tempo reale di Supabase. Lo squillo dura 30 secondi.
4. B risponde: anche il suo browser riceve dal Worker i dati per collegarsi alla stessa sessione. L'audio viaggia cifrato (WebRTC) attraverso Cloudflare; nessuno lo registra.
5. Il timer di 15:00 è deciso dal server (ora di inizio salvata in `chiamate`): a 14:00 «Ancora un minuto», a 15:00 il Worker chiude la sessione per entrambi, anche se un telefono ha l'orologio sbagliato.
6. Alla chiusura il Worker salva la durata; la chiamata conta nei limiti solo se ≥ 60 secondi. Poi «La richiameresti?» e diario.
7. «Chiudi e segnala»: il Worker chiude la sessione subito, registra il blocco reciproco e apre il modulo di segnalazione.

Connessione persa: 30 secondi per rientrare nella stessa sessione, il timer continua.

**Passi di sviluppo della #4** (un ramo e una PR ciascuno):
1. *Regole* (fatto, `api/chiamate.js` + `test/chiamate.test.mjs`): tutti i controlli del passo 2 in un solo punto, fine e timer decisi dal server (15:00 o chiusura della stanza), durata mai oltre la fine, riga del registro con solo chi / con / inizio / durata / esito, carte della conversazione (spec v1.2: pulsante da 0:10 all'ultimo minuto, 20 s tra due pescate, suggerimento a 0:30 una volta, nessuna ripetizione per la coppia nella settimana). Solo calcoli, nessun accesso a database o Realtime.
2. *Database* (fatto, `supabase/migrations/20261109220000_chiamate.sql`): `chiamate` con solo chi / con / inizio / durata / esito, scritta solo dal server e letta da chi c'era; `carte` con le 30 carte approvate (D58 A, `versione = v1`, testi confrontati uno per uno con `test/carte_v1.json`); `carte_viste` (coppia + stanza, cancellate da `pulisci_carte_viste()` alla chiusura); nel profilo `fascia_da` / `fascia_a` (dal 14/11, spec v1.3: senza fascia = 9:00–23:00; `pausa_il` per «Oggi non ricevo chiamate») e `solo_con_permesso`; tabelle `permessi_chiamata` e `blocchi` (D32 A: definitivi, chi è bloccato non lo vede). Carte e carte viste le legge solo il server.
3. *Server*, in due parti:
   - 3a (fatto, `api/realtime.js` + `test/realtime.test.mjs`): collegamento a Cloudflare Realtime solo dal server. Una sessione per persona, una sola traccia «voce»; ogni offerta o risposta con video, canali dati o più di un microfono viene scartata prima di arrivare a Cloudflare; chiusura forzata delle tracce a fine chiamata; tempo massimo di attesa; mai SDP o chiavi nei log.
   - 3b-1 (fatto, `api/stato_chiamata.js` + `test/stato_chiamata.test.mjs`): lo stato di una chiamata deciso dal server — squillo di 30 s (risponde solo chi è chiamato), in corso fino a 15:00 o alla chiusura della stanza, 30 s per rientrare dopo una caduta con il timer che continua, «Chiudi» / «Chiudi e segnala», carte con «vale il primo tocco». Una riga nel registro solo per le chiamate risposte (squillo senza risposta, rifiutato o annullato: nessuna riga); se la connessione non torna, la durata si ferma al momento della caduta. Il telefono riceve solo una «vista» (timer, carte, suggerimento, stato dell'altra persona), mai gli id delle sessioni Realtime.
   - 3b-2a (fatto, `api/chiamata_do.js` + `worker/chiamata.js` + `api/registro_chiamate.js`, test in `test/chiamata_do.test.mjs`): il Durable Object `Chiamata` (binding `CHIAMATA`, archivio SQLite del piano gratuito), uno per chiamata. Salva prima lo stato e le cose da fare, poi chiude le sessioni Realtime e scrive la riga del registro (una sola, ripetibile senza doppioni); se Realtime o Supabase non rispondono riprova all'allarme ogni 30 s, al massimo 5 volte. L'allarme fa scadere squillo, 15:00 e rientro anche senza telefoni. Un minuto dopo la fine cancella tutto: nel Durable Object non resta nemmeno chi ha chiamato chi. Il Worker parte da `worker/principale.js` (aggiunge la classe a `worker/index.js`, che resta provabile con Node).
   - 3b-2b-1 (fatto, `api/centralino.js` + `worker/centralino.js`, test in `test/centralino.test.mjs`): il Durable Object `Centralino` (binding `CENTRALINO`, SQLite del piano gratuito), uno per stanza. Sa solo chi ha la linea occupata e da quale chiamata: «una chiamata alla volta per persona» («È in un'altra chiamata») deciso in un solo punto, anche se due persone chiamano la stessa nello stesso istante, e chi riceve trova lì la chiamata in arrivo. Niente sessioni, nomi o audio. Una linea dimenticata si libera da sola dopo 17 minuti (squillo + 15:00 + rientro + 1 minuto); un'ora dopo la chiusura della stanza si cancella tutto.
   - 3b-2b-2: apertura, risposta, chiusura e pescata come richieste del Worker (`/app/api/chiamata/…`), con le regole di `api/chiamate.js` e le tabelle del passo 2. Servono `REALTIME_APP_ID` e `REALTIME_APP_SECRET` come secret del Worker `presente` su Cloudflare: inseriti da Giuseppe il 10/11 (quelli su GitHub provati con «Verifica segreti» il 10/11: accettati da Realtime).
4. *Web app*: schermate «Chiama», squillo, chiamata, «Chiudi e segnala»; prova reale su iPhone (web app in Home) e Android.

Avanzamento del 3b-2b: 3b-2b-2a (fatto, `api/apri_chiamata.js` + `api/dati_chiamata.js`, test in `test/apri_chiamata.test.mjs` e `test/dati_chiamata.test.mjs`): apertura di una chiamata e «a che punto è la mia chiamata», ancora senza richieste del Worker. Ordine: offerta solo voce (prima di toccare qualunque cosa) → stanza aperta di chi chiama → letture dal database in parallelo, solo le colonne che servono (membri, chiamate dal giorno prima dell'apertura, blocchi tra i due, fascia e «solo con permesso» di chi riceve, permesso) → regole di `api/chiamate.js` → il Centralino occupa le due linee → sessione Realtime e voce pubblicata → il Durable Object `Chiamata` fa squillare. Se una lettura non va: «riprova», mai regole su dati a metà. Se un passo dopo le linee non riesce si torna indietro (traccia chiusa, linee liberate). Al telefono solo la vista e la risposta SDP, mai l'id della chiamata o le sessioni. Prossimo, 3b-2b-2b: le richieste `/app/api/chiamata/…` del Worker, spente finché `ACCESSO_APP` non vale «si».

3b-2b-2b (fatto, `worker/chiamata_api.js`, test in `test/chiamata_api.test.mjs`): le prime due richieste del Worker. `POST /app/api/chiamata/apri` con `{ verso, offerta }` → `{ ok, descrizione, vista }` oppure `{ ok: false, motivo }`; `GET /app/api/chiamata` → `{ ok, vista }`. Chi chiama lo dice solo il token di Supabase (un «chi» nel corpo non conta); corpo al massimo 32 KB letto a pezzi; codici: 200 per sì e per i «no» delle regole, 400 dati o non solo voce, 401 accesso, 405/404, 413 corpo troppo grande, 429 troppe richieste (LIMITE_PROVINCIA, chiave «chiamata:»), 503 «riprova». Al telefono mai l'id della chiamata o le sessioni. Spente finché `ACCESSO_APP` non vale «si». 

3b-2b-2c-1 (fatto, `api/apri_chiamata.js`, `worker/chiamata_api.js`, `api/chiamata_do.js`, test in `test/apri_chiamata.test.mjs`, `test/chiamata_api.test.mjs`, `test/chiamata_do.test.mjs`): rispondere, rifiutare e chiudere.
- `POST /app/api/chiamata/rispondi` `{ offerta }` → `{ ok, descrizione, vista }`: solo chi riceve; offerta solo voce controllata prima di creare la sessione; se il Durable Object dice no (squillo finito, già risposto) la traccia appena pubblicata si chiude subito.
- `POST /app/api/chiamata/rifiuta` `{}` → `{ ok, vista }`: solo chi riceve, nessuna riga nel registro.
- `POST /app/api/chiamata/chiudi` `{ segnala }` → `{ ok, vista[, segnala] }`: tutti e due («Annulla» durante lo squillo, «Chiudi», «Chiudi e segnala» solo con `segnala: true`).
- La chiamata di una persona la trova sempre il Centralino della sua stanza: il telefono non manda mai un id di chiamata.
- A chiamata finita (anche per squillo scaduto, 15:00 o rientro mancato, decisi dall'allarme) il Durable Object `Chiamata` libera subito le due linee nel Centralino, con gli stessi tentativi delle altre cose da fare; se non ci riesce le linee si liberano da sole dopo 17 minuti.
3b-2b-2c-2a (fatto, `api/stato_chiamata.js`, `api/chiamata_do.js`, `api/apri_chiamata.js`, `worker/chiamata_api.js`, test in `test/ascolta.test.mjs`): ricevere la voce dell'altra persona.
- `POST /app/api/chiamata/ascolta` `{}` → `{ ok, descrizione, vista }`: a chiamata in corso il server chiede a Realtime la traccia «voce» dell'altra persona sulla propria sessione e passa al telefono l'offerta di Cloudflare. Le sessioni le sa solo il Durable Object (`sessioni(per)`, mai al telefono).
- `POST /app/api/chiamata/conferma` `{ risposta }` → `{ ok, vista }`: la risposta del telefono, solo voce (controllata prima di arrivare a Realtime).
- La vista ha `ascolto: "da_fare" | "fatto"`: dopo un rientro dell'altra persona (sessione nuova) torna «da_fare» e il telefono ascolta di nuovo; la traccia ricevuta vecchia si chiude. Durante una riconnessione: «riconnessione», niente da ascoltare.
- A fine chiamata si chiudono anche le tracce ricevute, non solo la propria voce.
3b-2b-2c-2b-1 (fatto, `api/apri_chiamata.js`, `worker/chiamata_api.js`, test in `test/rientro.test.mjs`): connessione persa e «Riconnetti».
- `POST /app/api/chiamata/caduta` `{}` → `{ ok, vista }`: il telefono che ha perso la voce lo dice; il Durable Object fa partire i 30 secondi (il timer dei 15 minuti continua). Se nessuno rientra, l'allarme chiude la chiamata con esito «caduta».
- `POST /app/api/chiamata/rientro` `{ offerta }` → `{ ok, descrizione, vista }`: al tocco su «Riconnetti» una nuova offerta solo voce va su una sessione Realtime nuova; la vecchia la chiude il Durable Object. Se la caduta non era arrivata (rete del tutto assente) il rientro la segna prima. Oltre i 30 secondi: «troppo_tardi» o «non_in_corso», e la traccia appena aperta si chiude.
- L'altra persona vede `altraPersona: "riconnessione"` e, dopo il rientro, `ascolto: "da_fare"`: ascolta di nuovo con `/ascolta`.
3b-2b-2c-2b-2 (fatto, `api/apri_chiamata.js`, `api/dati_chiamata.js`, `worker/chiamata_api.js`, test in `test/pesca_carta.test.mjs`): pescata della carta (spec v1.2).
- `POST /app/api/chiamata/carta` `{}` → `{ ok, vista }` con `vista.carta = { id, testo, daMe }`. Il server legge le carte attive (`v1`) e le carte già viste dalla coppia (coppia sempre `a < b`), il Durable Object applica le regole (da 0:10 a 14:00, 20 s tra due pescate, vale il primo tocco) e sceglie con un numero casuale estratto dal Worker (`crypto.getRandomValues`). Al Durable Object vanno solo id di carta, mai i testi.
- La carta pescata si segna in `carte_viste`; finito il mazzo si azzerano le viste di quella coppia (cancellazione sempre filtrata per stanza e coppia). Se il salvataggio non riesce la carta compare lo stesso.
- `GET /app/api/chiamata`: la vista ora porta il pulsante Carte (quante carte attive: 0 = niente pulsante) e la carta aperta col testo, anche all'altra persona e al rientro dopo una caduta. «Pescata da <nome>»: il nome lo mette l'app (`daMe` vero → «da te»).
- No delle regole al telefono: `nessuna_carta`, `fuori_tempo`, `troppo_presto` (200); database che non risponde: 503 «riprova».

Passo 3c-1 (fatto): `landing/app/moduli/chiamata.js`, il modulo della web app che parla con `/app/api/chiamata` (il corpo non dice mai chi chiama: lo dice il token) e decide cosa mostrare dalla vista del server: squillo in uscita e in arrivo, timer 15:00, banner «Niente numeri, cognomi o social prima della porta» nei primi 10 secondi, pulsante Carte con il conto dell'attesa, suggerimento, «Ancora un minuto», carta aperta con «Pescata da…», riconnessione dell'altra persona. Nessun audio, nessun salvataggio locale (test in `test/chiamata_app.test.mjs`).

Passo 3c-2 (fatto): `landing/app/moduli/voce.js`. Chiede solo il microfono (`video: false`, eco e rumore ridotti dal browser), apre una sola connessione WebRTC con STUN di Cloudflare: prima pubblica la propria voce (sendonly), poi sulla stessa connessione riceve quella dell'altra persona (offerta di Cloudflare, risposta a `/conferma`). Ogni descrizione con video o canali dati è rifiutata prima di toccare la connessione. «failed»/«disconnected» avvisano una volta (l'app chiama `/caduta`); «Riconnetti» apre una connessione nuova con lo stesso microfono (`/rientro`). Chiudere spegne il microfono. Nessuna registrazione e nessun salvataggio: la voce va solo all'altoparlante. `collegaVoce` unisce la voce alle richieste di `chiamata.js`; se il server dice no il microfono si spegne. Test con browser finto in `test/voce_app.test.mjs`.

Passo 3c-3a (fatto): `landing/app/moduli/compagni.js` legge le persone della propria stanza dalla funzione `compagni_di_stanza()` di Supabase (solo nome, età, città, decise dal database con il token dell'utente; righe senza id valido scartate, campi in più ignorati, niente salvataggi locali) e prepara la scheda con «Chiama» (assente mentre si è già in chiamata). La vista del server ora porta `altra`, l'id della persona della stanza con cui si parla, in tutte le fasi: serve per mostrare «Giulia ti sta chiamando» senza mandare nomi dal server (`nomeInChiamata`). Mai id di sessioni o della chiamata. Test in `test/compagni_app.test.mjs` e `test/stato_chiamata.test.mjs`.

Passo 3c-3b-1 (fatto): `landing/app/moduli/sentinella.js`, la «sentinella» che rilegge `GET /app/api/chiamata` per sapere di una chiamata in arrivo senza notifiche push. Solo con l'app aperta e visibile (in secondo piano nessuna richiesta, tornando visibile legge subito); ogni 10 secondi a riposo, ogni secondo durante squillo e chiamata, 60 secondi dopo «troppi tentativi», per restare dentro le 100.000 richieste al giorno del piano gratuito dei Workers. Con chiamate spente o accesso scaduto si ferma. Mai due letture insieme; `subito()` dopo un'azione dell'utente. Niente salvataggi locali, niente `setInterval`. Il service worker ora tiene anche `compagni.js` e `sentinella.js` (versione 14). Test in `test/sentinella_app.test.mjs`.

Passo 3c-3b-2 (fatto): `landing/app/moduli/telefono.js` unisce persone della stanza, sentinella, voce e richieste `/app/api/chiamata` e dice alla home cosa mostrare. Nella home c'è «La tua stanza» (scheda e «Chiama»); lo schermo della chiamata (squillo in arrivo e in uscita, timer, banner dei primi 10 secondi, Carte, Microfono, Chiudi, Chiudi e segnala, «Riconnetti», «Chiamata finita» con «Torna alla stanza») prende tutta la pagina. Un'azione alla volta; il microfono si spegne appena la chiamata finisce in qualunque modo; l'ascolto dell'altra persona parte una volta (nuovo tentativo dopo 3 s) e mai mentre si sta riconnettendo; un buco di rete non chiude lo schermo. La pagina si ridisegna solo se cambia la struttura (firma): timer e conti si aggiornano sul posto, così il fuoco non salta. L'altoparlante è un `<audio>` fuori da `#app`. Service worker versione 15. Test in `test/telefono_app.test.mjs`.

Passo 3c-4a (fatto, spec #4 v1.3 § 3): `api/dopo_chiamata.js` decide cosa si vede a chiamata finita: ≥ 60 s chiusa per tempo o con «Chiudi» → «La richiameresti?» (Sì / No / Salta, «Resta tra te e Presente. <nome> non lo saprà mai.»), poi diario (#5, saltato finché non c'è), poi «Segnala un problema» e «Torna alla stanza»; < 60 s → «La chiamata è durata poco e non conta nei limiti.»; «Chiudi e segnala» → subito il modulo #7 con la persona collegata. Una caduta lunga senza rientro non mostra la domanda né il testo «durata poco» (testo chiesto al CPO). Database (`20261113220000_richiameresti.sql`): tabella `richiameresti` (una risposta per persona e chiamata, nessun testo libero) che legge e scrive solo il server; `salva_richiameresti()` accetta solo chi era nella chiamata, solo chiamate che contano e solo nella stanza aperta, e non cambia una risposta già data; `richiameresti_da_riproporre()` ripropone al rientro, una volta sola, l'ultima chiamata senza risposta; `pulisci_stanze_chiuse()` cancella carte viste e risposte delle stanze chiuse e la chiama il lavoro del lunedì (prima nessuno chiamava `pulisci_carte_viste()`).

Passi 3c-4b-1 e 3c-4b-2 (fatti, PR #176 e #180): richieste `/app/api/chiamata/dopo` e `/richiameresti` e schermate «dopo la chiamata» nella web app.

Passo 3c-5a (fatto, spec #4 v1.3 § 1–2): fascia di disponibilità e testi del pulsante, lato server. `api/chiamate.js`: chi non ha fascia (o ne ha una non valida) vale 9:00–23:00 di Roma, «Alle» escluso (alle 23:00 non squilla); `controllaFascia()` vuole passo di 30 minuti, «Alle» fino a 24:00, almeno 1 ora, fine dopo l'inizio (niente mezzanotte a cavallo) e dà l'errore della spec; «Oggi non ricevo chiamate» è il giorno di Roma in `profili.pausa_il` e si spegne da solo a mezzanotte; fuori fascia o in pausa il testo è «Disponibile da 19:00» / «Disponibile domani dalle 9:00» (la pausa ha lo stesso testo di «dopo la fascia»: non si scopre). I 6 testi del pulsante seguono l'ordine della spec (3 volte → 5 mie → 5 sue «Per oggi non può ricevere altre chiamate. Riprova domani.» → occupato → orario → «Chiedi di parlare»), sempre uno solo. Il Worker fa passare al telefono solo il testo dell'orario, e solo se ha quella forma. Database (`20261114090000_fascia.sql`): default 9:00–23:00 per i profili nuovi, vincolo nuovo sulla fascia (le fasce già salvate non si toccano), colonna `pausa_il` accettata solo per oggi.

Passo 3c-5b-1 (fatto, PR #187): «Il mio profilo › Quando posso ricevere chiamate». `landing/app/moduli/disponibilita.js` (selettori «Dalle» 00:00–23:30 e «Alle» 00:30–24:00 a passo di 30 minuti, default 9:00–23:00, stesso controllo di `api/chiamate.js` provato su tutte le coppie, «Salvato. Da adesso ti chiamano dalle … alle …», pausa = giorno di Roma); `salvaDisponibilita()` in `salvataggio.js` fa PATCH solo sulla propria riga e solo `fascia_da`, `fascia_a`, `pausa_il` (regole per riga, vincolo `fascia_v13` e trigger della pausa nel database). Schermata in `flusso.js` con etichette visibili e interruttore `role=switch`.

Prossimo, 3c-5b-2: i testi sul pulsante «Chiama» della scheda prima del tocco (il server li aggiunge a ogni persona della stanza), poi le schede in sola lettura dopo le 21:00 della domenica fino a lunedì 9:00 (spec #5 passo 9). Le notifiche push dello squillo (spec v1.1) vengono dopo, con D24.

### Audio e video sulla stessa base (D48 A, 29/10)

Le chiamate dalla stanza sono **solo voce**; dopo la porta c'è lo **svelamento**: videochiamata di 10 secondi che parte sfocata. Entrambe usano la stessa sessione Cloudflare Realtime, quindi la #4 si costruisce già pronta per il video:
- una sessione per persona con tracce separate: `audio` sempre, `video` solo se il Worker `presente-api` lo autorizza (porta aperta e patto valido). Nelle chiamate dalla stanza il Worker rifiuta di pubblicare tracce video, anche se il telefono ci prova;
- la sfocatura si applica sul telefono di chi trasmette, su un canvas, prima di creare la traccia: chi riceve non può toglierla;
- il tempo di 10 secondi lo decide il server e parte solo quando **entrambe** le tracce video arrivano a Cloudflare; a 10 s il Worker chiude le tracce video per tutti e due;
- nessuna registrazione: Realtime inoltra e basta, e in `chiamate` si salvano solo inizio, durata e tipo (`voce` / `svelamento`).
I dettagli (quanto sfocato all'inizio, se si schiarisce, cosa succede se uno si scollega) li fissa la specifica del CPO.

Svelamento (#65, spec v1), passo 1 *Regole* (fatto, `api/svelamento.js` + `test/svelamento.test.mjs`): caparra di 10 crediti e «Ti mancano N crediti», avvio solo con le due caparre ed entro 48 ore dalla porta, «Preferisco le foto» di uno vale per entrambi, prima fascia comune da 30 minuti (max 3 a testa), timer di 10 s che parte all'arrivo del secondo video (sfocato che si schiarisce in 3 s), caduta prima dei 10 s → «Riprova» per 2 minuti, max 3 tentativi, sì/no segreto con lo stesso esito per «no» e silenzio, porta scaduta / blocco / «Chiudi e segnala» senza penale, riga di registro senza le singole risposte. Solo calcoli. Prossimi passi: tabelle (porte, caparre, fasce) con regole per riga, poi richieste del Worker sulla base Realtime della #4, poi schermate.

## Lavori programmati

| Quando (ora di Roma) | Cosa |
| --- | --- |
| Lunedì 9:00 | Composizione delle stanze (filtri reciproci rigidi, ≥ 4 compatibili a testa, 6–12 persone, niente ripetizioni nelle ultime 4 settimane) e addebito di 9 crediti solo se la stanza si forma; email e notifiche «La tua stanza è aperta» |
| Ogni giorno 9:00 | Due suggerimenti a testa (affinità del questionario + «richiameresti» reciproci − chi ha già 3 chiamate). Il diario non è tra i dati letti |
| Mercoledì 18:00, domenica 18:00 | Promemoria di servizio |
| Domenica 21:00 | Sera delle chiavi: si aprono le porte solo dove la chiave è reciproca (D14); chiusura delle stanze |

Il cambio d'ora è gestito calcolando gli orari nel fuso `Europe/Rome`, con un test dedicato.

## Scelte aperte

| Tema | Stato | Cosa serve |
| --- | --- | --- |
| D23 · dove conservare voce, questionario e foto | **Decisa A**: tutto su Supabase UE | **Fatto il 29/10**: progetto «presente» a Francoforte (eu-central-1), chiavi nei segreti GitHub e verificate |
| D24 · web app o store | **Decisa A**: web app installabile | Da provare presto (settimana 9–15 novembre) le chiamate su Safari iPhone con la web app in Home e le notifiche push |
| Cloudflare Realtime | **Attivo dal 29/10** | App SFU «presente» creata; ID e chiave nei segreti GitHub e verificati |
| Email di servizio (link di accesso, «la stanza è aperta») | **Da decidere** | Il servizio email incluso in Supabase manda pochissime email all'ora: basta per i test interni, non per la beta. Servirà un fornitore di email (gli indirizzi sono dati personali, quindi lo sceglie Giuseppe con il CFO, e va nell'informativa). Proposta come decisione quando si avvicina il test con 20 persone |
| Video sfocato dopo la porta (#6) | Tecnica scelta | La sfocatura si applica sul telefono di chi trasmette, prima che il video parta: chi riceve non può «togliere» la sfocatura |
| Informativa privacy per l'app | Da preparare (CFO) | Deve nominare Supabase e Cloudflare, i dati particolari (cerco, questionario, voce, foto) e il consenso separato, prima del test con persone reali |

## Rischi principali

- **Safari su iPhone**: chiamate e notifiche funzionano solo con la web app aggiunta alla Home. Mitigazione: guida all'installazione nell'app e prova reale nella seconda settimana.
- **Composizione delle stanze con pochi iscritti**: con meno di 6 compatibili la persona aspetta la settimana dopo senza pagare. Test automatico con 100 profili di prova.
- **Limiti dei piani gratuiti**: 1 GB di file su Supabase basta per circa 1.000 profili (voce compressa, circa 0,3 MB, + 3 foto ridimensionate, circa 0,6 MB). Oltre, si passa a Supabase Pro (25 $/mese) o si spostano i file: decisione di Giuseppe quando ci si avvicina.
