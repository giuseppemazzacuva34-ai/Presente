// PAGINA /da/meta (D92 A + testi D82 A, 2/11): è l'indirizzo del pulsante «Vai al sito» nella schermata finale del modulo
// Meta v1. Chi arriva qui si è appena iscritto dal modulo: niente secondo modulo, ma «Sei in lista!», la frase approvata
// in D82 e il pulsante «Segui @presente_app». Sotto, piccolo, il link per chi non è ancora iscritto.
// Conteggi (solo totali in visite_pagina, nessun dato personale): righe «da-meta» (visita), «da-meta-persona» (immagine 1×1)
// e «segui_ig» (clic sul pulsante, via /segui?da=meta). La visita conta anche nel canale «meta» come prima (visite_canale).
export const PERCORSO_DA_META = "/da/meta";

const HTML = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sei in lista · Presente</title>
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#0e0d10">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/stile.css?v=20261101a">
</head>
<body>
  <div class="pagina">
    <header class="testata">
      <a class="logo" href="/" aria-label="Presente, pagina iniziale">
        <span>presente</span>
        <svg viewBox="0 0 14 32" aria-hidden="true"><g transform="rotate(10 7 16)" fill="#e8432b"><rect x="4" y="1" width="6" height="20" rx="3"/><circle cx="7" cy="27" r="3.4"/></g></svg>
      </a>
    </header>
    <main>
      <h1>Sei in lista!</h1>
      <section class="segui-ig" aria-labelledby="segui-ig">
        <p id="segui-ig" class="attacco">Le città e i primi posti li annunciamo prima su Instagram.</p>
        <p><a class="bottone" href="/segui?da=meta" rel="noopener">Segui @presente_app</a></p>
      </section>
      <p class="nota">Non ti sei ancora iscritto? <a href="/?da=meta#iscriviti">Iscriviti gratis alla lista d'attesa</a></p>
    </main>
    <footer class="piede">
      <p><a href="/privacy">Informativa privacy</a></p>
    </footer>
  </div>
  <img class="px" src="/p.gif?pg=da-meta" alt="" width="1" height="1" aria-hidden="true">
</body>
</html>`;

export function paginaDaMeta(request) {
  return new Response(request.method === "HEAD" ? null : HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0", "x-robots-tag": "noindex" },
  });
}
