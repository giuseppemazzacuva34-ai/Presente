# Codici delle presentatrici (D88 = A)

Versione 1.0 · 2 novembre 2026 · autore: CTO («sviluppatore»). Regole complete in plancia: `progetto/gara-presentatrici` (meccanica A).

## In parole semplici

Ogni creator che firma l'accordo (D44 B) riceve un codice maiuscolo senza dati personali, per esempio `ROMA01`.
Le persone si iscrivono con il suo link `https://presenteincontri.app/?invito=ROMA01` oppure scrivendo il codice nel campo
facoltativo «codice» del modulo dentro Facebook/Instagram. In `/conteggio` compaiono solo numeri per codice.

## Cosa fa Giuseppe

1. Quando una creator firma, sceglie il codice (città + numero, es. `ROMA01`) e lo scrive al CTO in plancia.
2. Il CTO lo aggiunge a `CODICI_INVITO` in `wrangler.jsonc` (separati da virgola) con una pull request.
3. Nel modulo Meta: domanda personalizzata a risposta breve, facoltativa, chiamata «codice» (es. «Codice invito (facoltativo)»).

Prima di tutto questo serve che l'informativa copra il campo codice nel modulo Meta (verifica del CFO, entro il 6/11).

## Cosa conta il sito (`/conteggio` → `per_codice_validi`)

Per ogni codice: `validi`, `confermati_7_giorni` (in lista da almeno 7 giorni), `esclusi_usa_e_getta`, `esclusi_gia_in_lista`,
`sospeso`, `ultimo_valido` (giorno, per il pari merito). Il vecchio `per_codice` resta (totale grezzo, senza filtri).

- **Email usa e getta** (mailinator, yopmail, …): escluse. Elenco in `worker/codici.js`.
- **Già in lista**: conta solo la prima iscrizione di una persona; `nome+1@` e, per Gmail, i punti valgono come la stessa email.
- **Picco**: più di 15 iscrizioni con lo stesso codice in un'ora → `sospeso: true`. Il CTO guarda i totali e lo dice a Giuseppe.
- **Cancellazioni**: chi si cancella sparisce dalla lista e quindi dal conteggio.
- Nessun IP, cookie o impronta del browser. Nel campo «codice» del modulo Meta si salva solo un codice dell'elenco o un codice
  personale «porta un'amica»: un nome o un testo qualsiasi non si salva.

Ogni lunedì il CMO comunica a ciascuna creator solo il proprio `validi` (sotto 5: «meno di 5»), mai classifiche.

Codice: `worker/codici.js`, `worker/contatti_meta.js` (`codiceDa`), test in `test/codici.test.mjs`.
