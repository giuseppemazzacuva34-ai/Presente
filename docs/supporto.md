# Pagina Aiuto e «Scrivici» (issue #10, parte A) · guida per chi risponde

Versione 1 · 17 novembre 2026 · autore: Sviluppatore C. Specifica: issue #10, v1 del CPO (6/11), parte A.

## In parole semplici

Nell'app c'è la pagina **Aiuto**: in alto «Sono in difficoltà», poi le domande frequenti con «Cerca», in fondo
«Scrivici» e «I miei messaggi». Chi scrive manda un messaggio (categoria + testo, massimo 1.000 caratteri, massimo 5
al giorno). Chi ha il ruolo **«supporto»** (in beta solo Giuseppe) legge i messaggi in `/app/supporto.html` e risponde;
l'utente ritrova la risposta in «I miei messaggi». Tutto è spento finché `ACCESSO_APP` non vale «si».

## Come diventi «supporto» (una volta sola, prima della beta)

1. Entra nell'app (`/app/`) con la tua email, come un utente qualunque: così esiste il tuo account.
2. Apri il pannello di Supabase › **Authentication › Users**, cerca la tua email e copia il tuo **User UID**.
3. Supabase › **Table Editor › operatori_supporto** › **Insert row**: in `persona` incolla il tuo User UID, salva.
   (`aggiunto_il` si riempie da solo.)
4. Apri `/app/supporto.html`: vedi la coda dei messaggi. Chi non è nell'elenco riceve «non autorizzato».

Per togliere il ruolo a qualcuno: cancella la sua riga da `operatori_supporto`. Nessun dato reale va nel repository.

## Cosa vedi e cosa non vedi

- Vedi: email dell'account, categoria, testo, data, stato (Inviato / Risposto) e la bandiera **«sicurezza»**.
- Non vedi mai: voce, foto, questionario, diario, chiavi, valutazioni (provato dai test del database).
- Ordine della coda: prima i messaggi senza risposta e, tra questi, in cima quelli con parole di pericolo («paura»,
  «minacc», «aggred», «mi segue», «ricatt»…), in rosso con il promemoria «Sono in difficoltà»; poi dal più vecchio.
  I messaggi già risposti stanno in fondo.

## Come rispondi

1. Scrivi la risposta sotto il messaggio e premi invia: si salva e lo stato diventa «Risposto».
2. L'email della risposta: **da decidere (D140)**. Finché non è decisa, l'invio per email non parte dal Worker.

## Regole che valgono sempre

- Il testo dei messaggi non finisce mai nei log, nella plancia, nelle issue o nei report.
- Nessuna risposta automatica scritta da un'IA (la parte B è separata e non è in questa guida).
- Nessun rimborso automatico: ogni rimborso lo decide una persona.
- Account cancellato: i suoi messaggi si cancellano con l'account. Utente sospeso: può comunque scrivere.

## Dove sta il codice

| Pezzo | File |
|---|---|
| Tabella e regole per riga | `supabase/migrations/20261116105646_supporto.sql` |
| Ruolo «supporto» | `supabase/migrations/20261116205504_operatori_supporto.sql` |
| Richieste del Worker | `worker/supporto_api.js`, `worker/supporto_operatore_api.js` |
| Regole | `api/supporto.js`, `api/supporto_operatore.js` |
| Schermate | `landing/app/moduli/aiuto.js`, `landing/app/supporto.html` |
| Test | `test/supporto_*.test.mjs`, `test/aiuto_*.test.mjs`, `supabase/test/prova_*supporto.sql` |
