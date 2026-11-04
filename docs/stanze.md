# Stanze della settimana (issue #3) · calcolo

Versione 0.3 · 4 novembre 2026 · autore: CTO. Specifica: issue #3, v1 e v1.1 del CPO.

## In parole semplici

Ogni lunedì alle 9 (ora di Roma) un lavoro automatico mette le persone con profilo completo in stanze da 6 a 12.
Questo primo pezzo (`api/stanze.js`) contiene solo i calcoli, provati con profili inventati: nessun database, nessun dato reale.
Il lavoro del lunedì che legge Supabase e scrive le stanze arriva nei prossimi passi.

## Regole già pronte e provate (`test/stanze.test.mjs`)

- **Filtri reciproci** (genere cercato, età, raggio): A può chiamare B solo se ognuno rientra nei filtri dell'altro.
- **Chi sta nella stessa stanza**: o due persone compatibili, o due persone che non si cercano a vicenda per genere
  (es. due donne che cercano uomini). Mai qualcuno che ti interessa per genere ma è fuori dalla tua età o dal tuo raggio.
  Mai insieme chi si è bloccato o è stato in stanza insieme nelle ultime 4 settimane.
- **Almeno 4 compatibili a testa**, stanze da 6 a 12; chi non trova posto resta in attesa per lunedì dopo.
- **Stanza Italia**: una città apre le sue stanze a 36 profili completi; chi ha «solo la mia città» non entra mai nella
  Stanza Italia se non tocca lui «Sì, allarga il raggio». Contatore «mancano N persone».
- **Orari**: apre lunedì 9:00, chiude domenica 21:00 ora di Roma, giusto anche nelle settimane del cambio d'ora.
- **Crediti**: prima stanza gratis, poi 9 crediti solo se la stanza si forma.
- **Suggerimenti**: 2 nomi al giorno da affinità + «sì» reciproco a «la richiameresti?»; fuori chi hai già chiamato 3 volte
  o chi hai segnato «no». Il diario non entra in nessuna funzione.

Con 100 profili di prova si formano 6–7 stanze e 23–31 persone restano in attesa (gruppi piccoli e filtri stretti).

## Tabelle (secondo passo, 2 novembre sera)

Migrazione `supabase/migrations/20261102220000_stanze.sql`: tabelle `stanze` (Stanza Italia o città, nome facoltativo,
apertura e chiusura) e `membri_stanza` (chi c'è, prima stanza gratis sì/no). Il telefono legge soltanto: le scrive il
lavoro del lunedì con il ruolo di servizio. Il database rifiuta da solo chi non ha la data di nascita (requisito 2 del
CISO), la tredicesima persona e chi è già in un'altra stanza nella stessa settimana. Dei compagni si vedono solo nome,
età e città, con la funzione `compagni_di_stanza()`; mai data di nascita, filtri, questionario, affinità o foto.
Provato in `supabase/test/regole_per_riga.sql`.

## Terzo passo: dalle righe del database alle stanze (`api/settimana.js`)

Sempre solo calcoli, provati in `test/settimana.test.mjs` con profili inventati. Riceve le righe già lette e
restituisce cosa scrivere in `stanze` e `membri_stanza`, più chi resta fuori e perché:

- entra solo chi ha **confermato entro domenica 23:59** (ora di Roma) e ha il **profilo completo** (passo 11):
  data di nascita (maggiorenne il giorno di apertura), nome, città, «mi presento come», filtri con il consenso su «cerco»,
  questionario completo;
- vale la versione del questionario **in vigore all'apertura**: una modifica della settimana conta dal lunedì dopo;
- le città si confrontano senza maiuscole, accenti e spazi («Forlì» = «forli»);
- mai insieme chi si è **bloccato** o chi è stato nella **stessa stanza nelle ultime 4 settimane**;
- crediti: `gratis` alla prima stanza, poi 9 crediti, solo per chi entra davvero in una stanza;
- motivi di attesa: `non_iscritto`, `profilo_incompleto`, `senza_data_nascita`, `filtri_incompleti`,
  `questionario_incompleto`, `citta_non_aperta` (con «mancano N»), `pochi_compatibili`.

Il passo successivo (conferme) è qui sotto.

## Quarto passo: conferma d'ingresso («Entra nella stanza», 4 novembre)

Migrazione `20261104221000_conferme_stanza.sql`, tabella `conferme_stanza` (una riga per persona e settimana):

- il telefono scrive solo «voglio entrare»: **settimana e ora le mette il server** (il lunedì successivo ancora aperto);
- si conferma **entro domenica 23:59 di Roma**; dopo quell'ora la conferma vale per il lunedì dopo (anche col cambio d'ora);
- prima della scadenza ci si può ripensare (la conferma si cancella), dopo no; nessuno vede o tocca le conferme degli altri;
- qui non si scala nessun credito: li conta il lavoro del lunedì solo se la stanza si forma.

Prossimo passo: pulsante «Entra nella stanza» nella web app e lavoro programmato del lunedì che legge le conferme,
chiama `preparaSettimana` e scrive le stanze: gira come GitHub Action programmata con i segreti Supabase già salvati, costo zero.

## Solo le persone per te (risposta del CPO del 3 novembre)

Nella stessa stanza possono stare due persone che non si cercano (per esempio due donne che cercano uomini), ma
**nessuna delle due vede l'altra**: ognuno vede, chiama, dà la chiave e riceve suggerimenti solo per chi è
reciprocamente compatibile (genere, età, raggio nei due versi; «città» = provincia). Il controllo è in due posti:

- `perTe(io, stanza)` in `api/stanze.js` (calcoli del server, provati con 100 profili inventati: ognuno vede almeno 4 persone);
- `compagni_di_stanza()` nel database (migrazione `20261103220000_solo_compatibili.sql`): anche chiamando l'API
  direttamente, le altre persone non escono. Le funzioni interne del controllo non si chiamano dal telefono.

Il contatore «Nella tua stanza: N persone per te» è il numero di righe di `compagni_di_stanza()`.

## Punti aperti

- «non binario» e «mi descrivo» rientrano solo in chi cerca «tutti»: confermato dal CPO il 3/11.
- Con 1.000 profili il calcolo dura circa 6 secondi: oltre i limiti di CPU del piano gratuito dei Worker. Quando serve,
  il lavoro del lunedì gira come GitHub Action programmata o funzione di Supabase (scelta del CTO, costo zero).
