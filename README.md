# Presente

App di incontri per vedersi davvero, sul modello di «L'amore è cieco»: niente foto visibili né swipe; stanze di 7 giorni con chiamate solo voce, diario privato, decisione reciproca con le chiavi, incontro dal vivo con caparra anti-buca (7 € in crediti a chi aspetta, 3 € a Presente), locali consigliati, check-in «Sono qui» e segnale per riconoscersi. Lancio pubblico previsto a Milano sabato 9 gennaio 2027.

## Stato

Fase 0 · Fondamenta (26 ottobre – 1 novembre 2026): landing page della lista d'attesa nella cartella `landing/`, online con iscrizioni aperte dal 26 ottobre. Il codice della web app arriva in Fase 2 (2 novembre – 6 dicembre 2026). Come sarà costruita (componenti, dati, flusso delle chiamate, scelte aperte): [`docs/architettura.md`](docs/architettura.md).

## Automatismi attivi

| Cosa | File | Cosa fa |
| --- | --- | --- |
| Dependabot | `.github/dependabot.yml` | Ogni lunedì controlla le dipendenze e apre una pull request se serve un aggiornamento o una correzione di sicurezza |
| Verifica | `.github/workflows/ci.yml` | A ogni pull request controlla la landing, i test di sicurezza del Worker e la configurazione (`wrangler deploy --dry-run`) |
| Pubblicazione | Cloudflare Workers Builds | A ogni modifica su `main` pubblica il Worker `presente`; sugli altri rami crea un'anteprima |
| Verifica della landing | `scripts/verifica_landing.py` | Controlla che la landing sia ben fatta, leggera, senza risorse esterne e che il modulo raccolga solo email, zona, invito facoltativo, maggiore età e consenso |
| Agenda Fase 2 | Issues e milestone | Le attività di sviluppo, settimana per settimana, con scadenza |

## Landing page della lista d'attesa

Cartella `landing/`: pagine statiche (nessuno script nel browser, nessuna risorsa esterna), identità «Rivista» (decisione D4).
Ospitata gratis su **Cloudflare Workers** (Worker `presente`, configurazione in `wrangler.jsonc`), pubblicata da Cloudflare Workers Builds a ogni modifica su `main`.
Le pagine statiche sono servite direttamente da Cloudflare; il codice in `worker/` parte solo per pochi indirizzi (la home, per i link d'invito e i link per canale):
`/iscrizione` salva l'iscrizione nel database **Cloudflare D1** `presente-lista` (Europa occidentale), `/conteggio` restituisce solo i totali per la plancia, senza dati personali.
Anche la home `/` passa dal Worker: se l'indirizzo è un link d'invito dei creator (`https://presenteincontri.app/?invito=CODICE`), il Worker scrive il codice nel campo «Chi ti ha invitato?» prima di mandare la pagina (solo lettere e numeri, massimo 20 caratteri, in maiuscolo; la pagina resta senza script). Senza `?invito` la home è identica.

**Link per canale (D26, parte 1).** Da usare nei post e nelle bio: `presenteincontri.app/da/instagram`, `/da/tiktok`, `/da/facebook`, `/da/whatsapp`, `/da/meta` (sponsorizzate), `/da/creator` (si può aggiungere `?invito=CODICE`). Il Worker conta la visita e rimanda alla home con `?da=<canale>`; la home aggiunge al modulo un campo nascosto `canale`. Se la persona si iscrive, il Worker fa +1 per quel canale. Si salvano **solo contatori** (`visite_canale` e `iscrizioni_canale`: canale, giorno, numero): nessun cookie, IP o user agent, e il canale **non** entra nella riga dell'iscritto. Qualunque altro canale risponde 404. I numeri sono in `/conteggio`, voce `per_canale`. L'elenco dei canali è in `worker/canale.js` (e uguale in `scripts/verifica_landing.py`, che controlla che coincidano).

**Contatore delle visite (D43, opzione A).** Il Worker conta ogni apertura della home `/` e della pagina `/grazie` (che si vede dopo un'iscrizione), per giorno, nella tabella D1 `visite_pagina` (pagina, giorno, sorgente, campagna, numero). Se l'indirizzo ha `utm_source`/`utm_campaign` (es. la sponsorizzata Meta `?utm_source=meta&utm_campaign=lista_traffico`), li conta come totali: le sorgenti ammesse sono i canali dei link `/da` più `google`, le campagne sono quelle in `CAMPAGNE_UTM` in `wrangler.jsonc`; tutto il resto diventa «altro». Con `utm_source` uguale a un canale (es. `meta`) il modulo riceve anche il campo nascosto `canale`, così le iscrizioni dalla campagna finiscono in `per_canale`. Nessun IP, cookie, user agent o altro parametro (es. `fbclid`) viene salvato, la pagina resta senza script. I numeri sono in `/conteggio`, voce `visite`: `home`, `grazie`, `per_giorno` e `per_utm` (chiave `sorgente/campagna`). Conversione visita → iscrizione ≈ `grazie / home` (o `per_canale.meta.iscrizioni / per_utm["meta/lista_traffico"].home` per la campagna).
Piano Free: 100.000 richieste al giorno al Worker, 100.000 righe scritte al giorno su D1, 5 GB. Le intestazioni di sicurezza sono in `landing/_headers`.

Le iscrizioni sono aperte (`ISCRIZIONI_APERTE` vale `si` in `wrangler.jsonc`) dopo l'approvazione dell'informativa privacy 1.0 (D5). Le anteprime dei rami (blocco `previews`) non hanno database e tengono le iscrizioni chiuse.

Per vedere gli iscritti: D1 → `presente-lista` → Console, per esempio
`SELECT invito, COUNT(*) AS iscritti FROM iscrizioni GROUP BY invito ORDER BY iscritti DESC;`

Iscritti per codice dei creator (per il CMO): metti i codici assegnati in `CODICI_INVITO` in `wrangler.jsonc`, separati da virgola (es. `"SILVIA,NEVADA"`), con una modifica su `main`. Da quel momento `/conteggio` mostra `per_codice` con un totale per ciascun codice; chi ha scritto il codice a mano in minuscolo o con spazi viene contato lo stesso. Nessuna email e nessun nome scritto liberamente nel campo invito esce da `/conteggio`.

L'informativa privacy (`landing/privacy.html`) è la versione 1.0 approvata con D5.

Per provarla sul computer: `python3 -m http.server -d landing 8000` e apri http://localhost:8000 (il modulo funziona solo su Cloudflare).

## Attivare la pubblicazione automatica della web app

1. Crea un account gratuito su Cloudflare.
2. Crea un token API con il permesso "Cloudflare Pages: Edit" e copia l'ID account.
3. Su GitHub: Settings → Secrets and variables → Actions → aggiungi `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`.

Finché i secret mancano, la pubblicazione viene saltata senza errori.

## Quando arriva la web app

Nel file `.github/dependabot.yml` togli il commento dal blocco `npm` per far controllare anche le librerie dell'app.
