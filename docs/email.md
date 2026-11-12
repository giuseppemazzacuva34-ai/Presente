# Email agli iscritti (D98 A, D97 A)

Piano tecnico del CTO, 3 novembre 2026. Nessuna email parte e nessun account viene creato dal CTO: l'account lo crea Giuseppe (azione `az-brevo-202611031205`).

skill_usate: presente-contesto-marketing, signup, cro · tecnica: signup › un solo passo per completare il profilo (link personale monouso); cro › una sola CTA per email.

## Servizio scelto: Brevo, piano Free

- 0 €, fino a 300 email al giorno: i 56 iscritti di oggi ci stanno in un giorno, e anche 500 si mandano in 2 giorni.
- Brevo SAS, Parigi (Francia), server nell'UE. Ragione sociale presa dalle condizioni d'uso di Brevo (versione 1° ottobre 2025, letta il 3/11/2026).
- Alternative valutate dal CFO: MailerLite Free (limite 250 iscritti), Cloudflare Email Sending (richiede Workers a pagamento). Scartate.
- **Come è andata davvero (3/11, Coordinatore):** account Brevo Free collegato a Composio; dominio `presenteincontri.app` autenticato (brevo-code, DKIM brevo1/brevo2, DMARC `p=none`), mittente «Presente <ciao@presenteincontri.app>», risposte a reply-to della casella di Presente. L'invio lo fa il Coordinatore con una campagna Brevo e il link per cancellarsi di Brevo: **nessuna chiave Brevo nel Worker**, nessun endpoint di invio nel nostro codice.
- Quindi per questa email gli indirizzi e i link personali vengono caricati come contatti in Brevo (D98 A). Restano in D1 la lista vera e i codici; a Brevo vanno solo email e link personale, niente provincia, risposte o altri campi. Tracciamento di aperture e clic: da spegnere nelle impostazioni di Brevo.

## Cosa resta a Giuseppe

- Accettare l'accordo sul trattamento dei dati (DPA) di Brevo, se il Coordinatore non l'ha già fatto con il suo account.
- Dare il via all'invio dopo la prova su un indirizzo interno.

## Record DNS per Brevo (Cloudflare › DNS di presenteincontri.app)

I valori tra parentesi quadre li dà Brevo quando si aggiunge il dominio. Tutti «solo DNS» (nuvola grigia), TTL automatico.

| # | Tipo | Nome | Valore | Note |
|---|---|---|---|---|
| 1 | TXT | `@` | `brevo-code:[codice di Brevo]` | verifica del dominio |
| 2 | CNAME | `brevo1._domainkey` | `b1.[valore di Brevo].dkim.brevo.com` | DKIM |
| 3 | CNAME | `brevo2._domainkey` | `b2.[valore di Brevo].dkim.brevo.com` | DKIM |
| 4 | TXT | `@` | `v=spf1 include:spf.brevo.com ~all` | SPF: se esiste già un record `v=spf1`, **non crearne un secondo**: aggiungi `include:spf.brevo.com` prima di `~all` |
| 5 | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | se esiste già un `_dmarc`, aggiungi solo l'indirizzo `rua` |

Dopo l'inserimento: in Brevo «Authenticate» (la propagazione può richiedere fino a qualche ora). Mittente consigliato: `ciao@presenteincontri.app`; per ricevere le risposte serve l'inoltro email di Cloudflare (Email Routing, gratuito) verso la casella di Presente.

Fonti: guida di Brevo «Authenticate your domain with Brevo (Brevo code, DKIM, DMARC)» e guida alwaysdata su Brevo, lette il 3/11/2026.

## Cosa fa il CTO (1-2 giorni dopo l'account)

| Passo | Dove | Stato |
|---|---|---|
| Informativa 1.4.1 con Brevo al punto 8 | `landing/privacy.html` | PR #123 |
| Link personale «porta un'amica» anche per i 52 del modulo Meta (codice invito per chi non ce l'ha) | `worker/codici_mancanti.js`, cron ogni ora al minuto 23 | fatto (PR del 3/11) |
| Informativa 1.5.1: Anthropic anche per preparare gli invii (D107 C); va online **prima** della query dei link personali | `landing/privacy.html`, `worker/iscrizione.js` | PR del 4/11, la unisce Giuseppe |
| Link per cancellarsi e invio | Brevo (campagna del Coordinatore) | non serve codice nostro |
| Informativa 1.5 con la seconda casella non spuntata per gli aggiornamenti ogni 2 settimane (D97 A) | landing + `worker/iscrizione.js` | dopo l'invio |

## Link personali per l'email (query di sola lettura, D107 C)

Da lanciare sul database D1 `presente-lista` **dopo** il primo giro del cron (minuto 23 dell'ora dopo l'unione):

```sql
SELECT email, 'https://presenteincontri.app/da/amico?invito=' || codice AS link FROM iscrizioni WHERE codice IS NOT NULL ORDER BY id;
```

Controllo prima di caricare: `SELECT COUNT(*) FROM iscrizioni WHERE codice IS NULL;` deve dare 0.
Il risultato va solo in Brevo: mai in plancia, nei log, in chat o nel repository. La query è solo qui, non nel codice del Worker (richiesta CISO del 3/11).

Chi la lancia (D107 C, decisa da Giuseppe il 4/11): un agente con il connettore Cloudflare, **solo dopo** che è online l'informativa 1.5.1 con la riga nuova al punto 8 (Anthropic anche per preparare le email della lista). È l'unica eccezione alla regola «nessun dato personale dal database agli agenti»: vale solo per questa query e per quella degli aggiornamenti qui sotto, solo per caricarle in Brevo. Nella plancia, nei report e nei log vanno solo i conteggi.

## Blocco «Porta un'amica» nella prima email (E15, dal 12/11)

Esperimento E15 di growth, deciso da Giuseppe il 6/11 (brief › decisioni_giuseppe_06_11_analisi, punto 9: le iscritte ricevono il loro link personale; vantaggio solo di accesso, mai denaro o beni). Lo inserisce il Coordinatore nel modello Brevo della prima email, **sotto** il pulsante principale.

skill_usate: presente-contesto-marketing, cro, signup, referrals · tecnica: cro › una sola CTA per email (il link personale è testo, non un secondo pulsante); referrals › link personale subito dopo l'iscrizione.

- **Nessun dato nuovo**: a Brevo vanno già email e link personale (query qui sopra, colonna `link` → attributo contatto `LINK`). Informativa e dati raccolti invariati.
- **Nessun testo nuovo**: solo frasi già online su `/da/meta` (titolo e prima riga) e su `/grazie` (link e nota).
- **Una sola CTA**: il pulsante resta quello principale dell'email; qui il link è scritto per esteso.
- Nessun premio, nessuna classifica, nessuna data. Pagine del sito invariate (brief 6/11 punto 4).

Testo da incollare nel modello Brevo:

```text
Porta un'amica o un amico. La tua città si accende prima.

Si parte con la Stanza Italia. Le stanze della tua città aprono quando arriva a 36 iscritti: ogni persona che porti la avvicina.

Il tuo link personale: {{ contact.LINK }}

Il codice nel link è casuale e non dice nulla di te: serve solo a contare quante persone arrivano con il tuo invito.
```

Se un contatto non ha `LINK` (non dovrebbe: il controllo `codice IS NULL` deve dare 0), Brevo mostra il campo vuoto: in quel caso non inviare e scrivere al CTO.

Misura (growth, solo conteggi): `inviti_personali.iscritti_con_invito` di `/conteggio` e iscrizioni del canale «amico» per giorno, contro le email consegnate (totale Brevo). Ipotesi: almeno 1 iscrizione con invito ogni 50 email consegnate entro 7 giorni; sbagliata sotto 1 ogni 100.

## Aggiornamenti ogni 2 settimane (informativa 1.5, D97 A)

Solo a chi ha spuntato la casella separata del sito (colonna `consenso_aggiornamenti_il` non vuota, dal 3/11). Chi si è iscritto prima o dal modulo Meta non la riceve. Query di sola lettura:

```sql
SELECT email, 'https://presenteincontri.app/da/amico?invito=' || codice AS link FROM iscrizioni WHERE consenso_aggiornamenti_il IS NOT NULL AND codice IS NOT NULL ORDER BY id;
```

## Regole

- L'email esce solo dopo la prova su un indirizzo interno e il via di Giuseppe.
- Chi si è cancellato non riceve più nulla; chi ha chiesto la cancellazione dei dati non c'è più nella lista.
- Nessun dato degli iscritti nel repository, nei log o in plancia: solo numeri.
