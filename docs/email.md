# Email agli iscritti (D98 A, D97 A)

Piano tecnico del CTO, 3 novembre 2026. Nessuna email parte e nessun account viene creato dal CTO: l'account lo crea Giuseppe (azione `az-brevo-202611031205`).

skill_usate: presente-contesto-marketing, signup, cro · tecnica: signup › un solo passo per completare il profilo (link personale monouso); cro › una sola CTA per email.

## Servizio scelto: Brevo, piano Free

- 0 €, fino a 300 email al giorno: i 56 iscritti di oggi ci stanno in un giorno, e anche 500 si mandano in 2 giorni.
- Brevo SAS, Parigi (Francia), server nell'UE. Ragione sociale presa dalle condizioni d'uso di Brevo (versione 1° ottobre 2025, letta il 3/11/2026).
- Alternative valutate dal CFO: MailerLite Free (limite 250 iscritti), Cloudflare Email Sending (richiede Workers a pagamento). Scartate.
- Usiamo Brevo **solo come canale di invio** (API «transactional email»): la lista resta in D1. A Brevo passiamo, per ogni email, solo l'indirizzo e il testo. Niente importazione di contatti, niente tracciamento di aperture e clic (si spengono nelle impostazioni).

## Cosa deve fare Giuseppe (circa 15 minuti, 0 €)

1. Crea l'account gratuito su brevo.com con l'email di Presente e accetta l'accordo sul trattamento dei dati (DPA).
2. In Brevo › Senders, Domains & Dedicated IPs › Domains: aggiunge `presenteincontri.app`. **I record DNS li crea il Coordinatore con Composio** (connettori Cloudflare e Brevo, aggiornamento del 3/11): Giuseppe non tocca Cloudflare. Elenco qui sotto.
3. In Brevo › SMTP & API › API Keys: crea una chiave e la incolla come secret del Worker (Cloudflare › Workers › presente › Impostazioni › Variabili e segreti › Aggiungi › Segreto) con nome `BREVO_CHIAVE`. La chiave non va mai in chat né nel repository.
4. Disattiva in Brevo il tracciamento di aperture e clic.

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
| Informativa 1.4.1 con Brevo al punto 8 | `landing/privacy.html` | PR del 3/11 |
| Link personale «porta un'amica» anche per i 52 del modulo Meta (codice invito per chi non ce l'ha) | `worker/codici.js`, migrazione D1 | da fare |
| Link per cancellarsi in un clic (gettone per iscritto, pagina di conferma, intestazioni `List-Unsubscribe` e `List-Unsubscribe-Post`) | nuovo `worker/email.js` | da fare |
| Invio: endpoint protetto (solo con secret `INVIO_CHIAVE`) che manda a gruppi di 50 con pausa, prima solo all'indirizzo di prova, poi a tutti | `worker/email.js` | da fare |
| Registro: tabella `invii` (iscritto, campagna, quando, esito); in plancia solo i conteggi (inviate, errori, cancellati) | D1 | da fare |
| Informativa 1.5 con la seconda casella non spuntata per gli aggiornamenti ogni 2 settimane (D97 A) | landing + `worker/iscrizione.js` | dopo l'invio |

## Regole

- L'email esce solo dopo la prova su un indirizzo interno e il via di Giuseppe.
- Chi si è cancellato non riceve più nulla; chi ha chiesto la cancellazione dei dati non c'è più nella lista.
- Nessun dato degli iscritti nel repository, nei log o in plancia: solo numeri.
