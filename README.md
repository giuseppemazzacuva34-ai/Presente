# Presente

App di incontri gratuita che guadagna solo quando due persone si incontrano davvero: due proposte di appuntamento a settimana, caparra anti-buca, punteggio di affidabilità e modalità Al Buio. Lancio pubblico previsto a Milano sabato 9 gennaio 2027.

## Stato

Fase 0 · Fondamenta (26 ottobre – 1 novembre 2026): landing page della lista d'attesa nella cartella `landing/`. Il codice della web app arriva in Fase 2 (2 novembre – 6 dicembre 2026).

## Automatismi attivi

| Cosa | File | Cosa fa |
| --- | --- | --- |
| Dependabot | `.github/dependabot.yml` | Ogni lunedì controlla le dipendenze e apre una pull request se serve un aggiornamento o una correzione di sicurezza |
| Verifica e pubblicazione | `.github/workflows/ci.yml` | A ogni modifica su `main` installa, testa e costruisce l'app; se Cloudflare è configurato la pubblica su Cloudflare Pages |
| Verifica della landing | `scripts/verifica_landing.py` | Controlla che la landing sia ben fatta, leggera, senza risorse esterne e che il modulo raccolga solo email, zona, invito facoltativo, maggiore età e consenso |
| Agenda Fase 2 | Issues e milestone | Le attività di sviluppo, settimana per settimana, con scadenza |

## Landing page della lista d'attesa

Cartella `landing/`: pagine statiche (nessuno script nel browser, nessuna risorsa esterna), identità «Rivista» (decisione D4).
Ospitata gratis su **Cloudflare Pages**; le iscrizioni passano dalla funzione `functions/iscrizione.js` e finiscono nel database **Cloudflare D1** (piano Free: pagine statiche illimitate, 100.000 richieste al giorno per le funzioni, 100.000 righe scritte al giorno, 5 GB).
`functions/conteggio.js` restituisce solo i totali (per la plancia), senza dati personali. Le intestazioni di sicurezza sono in `landing/_headers`.

Per pubblicarla (una volta sola, gratis, circa 10 minuti):

1. Crea un account gratuito su dash.cloudflare.com.
2. Storage & Databases → D1 → Create database: nome `presente-lista`, posizione Western Europe.
3. Workers & Pages → Create → Pages → Connect to Git → GitHub → repository `Presente`. Impostazioni di build: Framework preset `None`, Build command vuoto, Build output directory `landing`. Salva e pubblica.
4. Nel progetto Pages: Settings → Bindings → Add → D1 database: nome della variabile `DB`, database `presente-lista`.
5. Solo dopo l'approvazione dell'informativa (D5): Settings → Variables and Secrets → aggiungi `ISCRIZIONI_APERTE` con valore `si`. Finché manca, il modulo risponde «le iscrizioni aprono tra pochissimo» e non salva nulla.
6. Deployments → Retry deployment. L'indirizzo è del tipo `presente-xxx.pages.dev`.

Per vedere gli iscritti: D1 → `presente-lista` → Console, per esempio
`SELECT invito, COUNT(*) AS iscritti FROM iscrizioni GROUP BY invito ORDER BY iscritti DESC;`

L'informativa privacy (`landing/privacy.html`) è una BOZZA: va approvata e completata (decisione D5) prima di raccogliere iscrizioni.

Per provarla sul computer: `python3 -m http.server -d landing 8000` e apri http://localhost:8000 (il modulo funziona solo su Cloudflare).

## Attivare la pubblicazione automatica della web app

1. Crea un account gratuito su Cloudflare.
2. Crea un token API con il permesso "Cloudflare Pages: Edit" e copia l'ID account.
3. Su GitHub: Settings → Secrets and variables → Actions → aggiungi `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.

Finché i secret mancano, la pubblicazione viene saltata senza errori.

## Quando arriva la web app

Nel file `.github/dependabot.yml` togli il commento dal blocco `npm` per far controllare anche le librerie dell'app.
