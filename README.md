# Presente

App di incontri gratuita che guadagna solo quando due persone si incontrano davvero: due proposte di appuntamento a settimana, caparra anti-buca, punteggio di affidabilità e modalità Al Buio. Lancio pubblico previsto a Milano il 14 febbraio 2027.

## Stato

Fase 0 · Fondamenta (26 ottobre – 8 novembre 2026). Il codice della web app arriva in Fase 2, dal 7 dicembre 2026.

## Automatismi attivi

| Cosa | File | Cosa fa |
| --- | --- | --- |
| Dependabot | `.github/dependabot.yml` | Ogni lunedì controlla le dipendenze e apre una pull request se serve un aggiornamento o una correzione di sicurezza |
| Verifica e pubblicazione | `.github/workflows/ci.yml` | A ogni modifica su `main` installa, testa e costruisce l'app; se Cloudflare è configurato la pubblica su Cloudflare Pages |
| Agenda Fase 2 | Issues e milestone | Le attività di sviluppo, settimana per settimana, con scadenza |

## Attivare la pubblicazione automatica

1. Crea un account gratuito su Cloudflare.
2. Crea un token API con il permesso "Cloudflare Pages: Edit" e copia l'ID account.
3. Su GitHub: Settings → Secrets and variables → Actions → aggiungi `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.

Finché i secret mancano, la pubblicazione viene saltata senza errori.

## Quando arriva la web app

Nel file `.github/dependabot.yml` togli il commento dal blocco `npm` per far controllare anche le librerie dell'app.
