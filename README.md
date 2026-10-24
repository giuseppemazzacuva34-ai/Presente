# Presente

App di incontri gratuita che guadagna solo quando due persone si incontrano davvero: due proposte di appuntamento a settimana, caparra anti-buca, punteggio di affidabilità e modalità Al Buio. Lancio pubblico previsto a Milano sabato 9 gennaio 2027.

## Stato

Fase 0 · Fondamenta (26 ottobre – 1 novembre 2026): landing page della lista d'attesa nella cartella `landing/`. Il codice della web app arriva in Fase 2 (2 novembre – 6 dicembre 2026).

## Automatismi attivi

| Cosa | File | Cosa fa |
| --- | --- | --- |
| Dependabot | `.github/dependabot.yml` | Ogni lunedì controlla le dipendenze e apre una pull request se serve un aggiornamento o una correzione di sicurezza |
| Verifica e pubblicazione | `.github/workflows/ci.yml` | A ogni modifica su `main` installa, testa e costruisce l'app; se Cloudflare è configurato la pubblica su Cloudflare Pages |
| Verifica della landing | `scripts/verifica_landing.py` | Controlla che la landing sia ben fatta, leggera, senza risorse esterne e che il modulo raccolga solo email, zona, maggiore età e consenso |
| Agenda Fase 2 | Issues e milestone | Le attività di sviluppo, settimana per settimana, con scadenza |

## Landing page della lista d'attesa

Cartella `landing/`: pagine statiche (nessuno script, nessuna risorsa esterna), identità «Rivista» (decisione D4).
Le iscrizioni si raccolgono con Netlify Forms, gratuito. La configurazione è in `netlify.toml`.

Per pubblicarla (una volta sola, gratis):

1. Su Netlify: Add new project → Import an existing project → GitHub → `presente`. Le impostazioni si leggono da `netlify.toml`: basta confermare.
2. Su Netlify: Project configuration → Forms → Enable form detection, poi fai ripartire la pubblicazione.
3. Le iscrizioni compaiono in Forms → `lista-attesa`.

L'informativa privacy (`landing/privacy.html`) è una BOZZA: va approvata e completata (decisione D5) prima di raccogliere iscrizioni.

Per provarla sul computer: `python3 -m http.server -d landing 8000` e apri http://localhost:8000.

## Attivare la pubblicazione automatica della web app

1. Crea un account gratuito su Cloudflare.
2. Crea un token API con il permesso "Cloudflare Pages: Edit" e copia l'ID account.
3. Su GitHub: Settings → Secrets and variables → Actions → aggiungi `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.

Finché i secret mancano, la pubblicazione viene saltata senza errori.

## Quando arriva la web app

Nel file `.github/dependabot.yml` togli il commento dal blocco `npm` per far controllare anche le librerie dell'app.
