# Architettura della Fase 2 (beta del 6 dicembre 2026)

Versione 1.1 · 29 ottobre 2026 (v1: 28 ottobre) · autore: CTO («sviluppatore»).
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
- Cancellazione dell'account: una sola funzione cancella righe e file in Supabase (D23 A: un solo posto).
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

## Flusso di una chiamata (#4)

1. A tocca «Chiama». La web app chiede al Worker `presente-api` di aprire la chiamata, con il token di accesso Supabase di A.
2. Il Worker controlla: A e B sono nella stessa stanza aperta, nessun blocco, B è nella sua fascia di disponibilità, meno di 3 chiamate valide tra loro, meno di 5 oggi per entrambi, nessuno dei due è già in chiamata, eventuale permesso di B (D32). Se un controllo fallisce risponde con il testo giusto («Disponibile da 19:00», «Avete già parlato 3 volte…»).
3. Il Worker crea la sessione su Cloudflare Realtime con la chiave segreta, registra in `chiamate` l'inizio e fa squillare B: notifica push (se l'app è installata) + messaggio sul canale in tempo reale di Supabase. Lo squillo dura 30 secondi.
4. B risponde: anche il suo browser riceve dal Worker i dati per collegarsi alla stessa sessione. L'audio viaggia cifrato (WebRTC) attraverso Cloudflare; nessuno lo registra.
5. Il timer di 15:00 è deciso dal server (ora di inizio salvata in `chiamate`): a 14:00 «Ancora un minuto», a 15:00 il Worker chiude la sessione per entrambi, anche se un telefono ha l'orologio sbagliato.
6. Alla chiusura il Worker salva la durata; la chiamata conta nei limiti solo se ≥ 60 secondi. Poi «La richiameresti?» e diario.
7. «Chiudi e segnala»: il Worker chiude la sessione subito, registra il blocco reciproco e apre il modulo di segnalazione.

Connessione persa: 30 secondi per rientrare nella stessa sessione, il timer continua.

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
