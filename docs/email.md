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
| Link per cancellarsi e invio | Brevo (campagna del Coordinatore) | non serve codice nostro |
| Informativa 1.5 con la seconda casella non spuntata per gli aggiornamenti ogni 2 settimane (D97 A) | landing + `worker/iscrizione.js` | dopo l'invio |

## Link personali per l'email (query di sola lettura per il Coordinatore)

Da lanciare sul database D1 `presente-lista` **dopo** il primo giro del cron (minuto 23 dell'ora dopo l'unione):

```sql
SELECT email, 'https://presenteincontri.app/da/amico?invito=' || codice AS link FROM iscrizioni WHERE codice IS NOT NULL ORDER BY id;
```

Controllo prima di caricare: `SELECT COUNT(*) FROM iscrizioni WHERE codice IS NULL;` deve dare 0.
Il risultato va solo in Brevo: mai in plancia, nei log, in chat o nel repository. La stessa query è in `worker/codici_mancanti.js` (`QUERY_LINK_PERSONALI`).

## Regole

- L'email esce solo dopo la prova su un indirizzo interno e il via di Giuseppe.
- Chi si è cancellato non riceve più nulla; chi ha chiesto la cancellazione dei dati non c'è più nella lista.
- Nessun dato degli iscritti nel repository, nei log o in plancia: solo numeri.
