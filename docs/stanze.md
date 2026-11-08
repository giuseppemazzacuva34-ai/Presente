# Stanze della settimana (issue #3) · calcolo

Versione 0.4 · 8 novembre 2026 · autore: CTO. Specifica: issue #3, v1 e v1.1 del CPO.

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

## Aree vaste (spec v1.2 del CPO, D121 A, 7 novembre)

Una «città» per le stanze è un'**area vasta**: provincia + province vicine della stessa regione entro circa 60 km.
Tutto in `api/aree.js` (solo calcoli, provati in `test/aree.test.mjs`):

- **mappa fissa** delle 9 aree iniziali (plancia › `progetto/aree-vaste`); ogni provincia sta in una sola area, le
  province non elencate sono un'area da sola con il loro nome; dall'estero nessuna area;
- **l'area la ricava il server dalla provincia** (`persona()` in `api/settimana.js`): un campo «zona» o «area» arrivato
  con la riga non conta;
- **accensione**: almeno 36 profili completi **e** almeno il 40% di donne (calcolo in numeri interi: con 36 profili
  14 donne non bastano, 15 sì); «non binario» e «mi descrivo» contano nei 36 ma non nel 40%;
- **contatore** della home: `testoContatore(area, { totale, donne })` mostra il numero più alto tra persone mancanti e
  donne mancanti, con i testi della spec; `testoZona(sigla)` scrive «La tua zona: Milano e dintorni (Milano, …)»;
- **«Solo la mia zona»** (raggio `citta`): solo persone della stessa area (provato con 100 profili inventati su 3 aree);
- `conteggiPerArea(profili)` dà solo numeri (totale, donne) per i contatori della plancia.

Corretto anche un errore: chi vive all'estero (provincia «EE», città vuota) risultava «profilo incompleto» e non entrava
mai nella Stanza Italia.

**Distanze ricalcolate (7/11)** in linea d'aria tra i comuni capoluogo, con le coordinate dei comuni ISTAT 2018
(elenco pubblico «Comuni-Italiani-2018», solo nomi e coordinate dei comuni, nessun dato di persone). Tutte le province
della mappa stanno entro 60 km tranne **Arezzo (61 km da Firenze)**, al limite. Al limite fuori: Lucca 61 km da
Firenze, Reggio Emilia 61 km da Bologna, Mantova 62 km da Brescia, Biella 62 km da Torino. **Sondrio** (Lombardia) è a
55 km da Bergamo e non è nella mappa. Novara (44 km da Milano) e Matera (56 km da Bari) restano fuori perché di
un'altra regione. Le scelte sono del CPO; cambi della mappa solo con una decisione di Giuseppe.

**Nel database (7/11, migrazione `20261107220000_aree.sql`).** Tabella `aree` (codice, nome) e colonna
`province.area`: ognuna delle 107 province ha esattamente un'area, l'estero nessuna (vincolo nel database). La mappa è
la stessa di `api/aree.js`: `test/aree_database.test.mjs` ferma «Verifica» se le due non coincidono. Le tabelle della
mappa le legge solo il server, come `province`. «Solo la mia zona» nel database (`rientra_nei_filtri`, quindi anche
`compagni_di_stanza()`) confronta le aree delle province in vigore: Milano vede Monza, non Novara né Roma; agli altri
si mostra sempre la provincia. `conteggi_aree()` dà per ogni area solo `totale` e `donne` dei profili completi
(passo 11): la chiama solo il server (service_role), mai il telefono.

Prossimo passo: il lavoro del lunedì usa `conteggi_aree()` per l'accensione; testi «La tua zona» e contatore nella
web app; scelta del raggio «Solo la mia zona · <area>».

## Punti aperti

- «non binario» e «mi descrivo» rientrano solo in chi cerca «tutti»: confermato dal CPO il 3/11.
- Con 1.000 profili il calcolo dura circa 6 secondi: oltre i limiti di CPU del piano gratuito dei Worker. Quando serve,
  il lavoro del lunedì gira come GitHub Action programmata o funzione di Supabase (scelta del CTO, costo zero).

**Nella web app (7/11 sera).** La mappa ora sta in un solo file, `landing/app/moduli/aree.js`: la usa il telefono per
scrivere i testi e il server (`api/aree.js` la importa) per i calcoli, così non possono mai dire due zone diverse.
Il telefono la usa solo per scrivere: l'area per le stanze la ricava sempre il server dalla provincia.
- In «Il mio profilo», sotto nome, età e provincia: «La tua zona: Milano e dintorni (Milano, Monza e Brianza, …)»;
  niente per chi vive all'estero. Gli altri della stanza continuano a vedere solo la provincia.
- Nel passo «Chi cerchi» il raggio è «Solo la mia zona · Milano e dintorni» / «Anche altre città» / «Anche dall'estero,
  nella mia lingua» (il valore salvato resta `citta`, `italia`, `estero`).
- Prove: `test/zona_app.test.mjs` e nel browser `scripts/prova_app.py`.

**Contatore nella home (7/11 notte).** `GET /app/api/zona` (`worker/zona.js`): il Worker riconosce la persona dal token,
legge la provincia **in vigore** del suo profilo (un cambio vale dal lunedì dopo), ricava l'area e prende i numeri da
`conteggi_aree()` (solo chiave del server). Al telefono arriva solo `{ zona, accesa, testo }` della propria zona:
«Milano e dintorni: mancano 7 persone per aprire le stanze della tua zona. Intanto entri nella Stanza Italia.» oppure
«…ci siete quasi. Servono ancora 4 donne…». Mai numeri di altre aree, nomi o email; parametri della richiesta ignorati.
Estero o provincia mancante: niente zona. Numeri non disponibili: solo il nome, mai un numero inventato. Area accesa:
nessun contatore. La home (`landing/app/moduli/zona.js`) aspetta al massimo 2 secondi e non blocca mai. Spento finché
`ACCESSO_APP` non vale «si»; limite di frequenza `LIMITE_PROVINCIA` (chiave a parte). Prove: `test/contatore_zona.test.mjs`.

## Lavoro del lunedì (8/11)

Ogni lunedì alle 9 di Roma la GitHub Action **«Stanze»** (`.github/workflows/stanze.yml`, costo zero) esegue
`scripts/lavoro_lunedi.mjs`:

1. `righe_settimana(apre)` (solo server): legge **solo chi ha confermato** per quel lunedì e solo i campi dei calcoli
   (mai email, foto, voce, diario, «mi descrivo»), con la provincia **in vigore all'apertura**; più il numero di stanze
   già fatte (per «prima stanza gratis») e le stanze delle ultime 4 settimane (per non rimettere insieme le stesse persone);
2. `conteggi_aree()`: quali aree sono accese (36 profili completi e 40% donne);
3. `preparaSettimana()` (già provata) forma le stanze;
4. `scrivi_settimana()` (solo server) scrive **tutto o niente** in una sola transazione; rifiuta chi non ha confermato e
   un'apertura che non è lunedì alle 9 di Roma; **se le stanze di quel lunedì ci sono già non scrive nulla**.

La Action parte alle 7:05 e alle 8:05 UTC: una delle due cade sempre alle 9 di Roma (estate e inverno), l'altra si
ferma da sola. A mano: Actions → «Stanze» → «prova» calcola la prossima apertura e scrive nel log **solo numeri**
(stanze, persone, motivi di attesa). **Spento finché `ACCESSO_APP` non vale «si».** Mancano ancora: il blocco (#7, oggi
nessuna coppia bloccata) e il conteggio dei crediti (contatore interno, dopo la #6). Prove: `test/lavoro_lunedi.test.mjs`
e i controlli «lunedì:» in `supabase/test/regole_per_riga.sql`.

