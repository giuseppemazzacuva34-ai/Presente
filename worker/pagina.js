// Piccola pagina HTML nello stile della landing, usata dalle risposte delle funzioni.
export function pagina(titolo, testo, stato = 200) {
  const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${titolo} · Presente</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/stile.css">
</head>
<body>
  <div class="pagina">
    <main>
      <p class="etichetta">Lista d'attesa</p>
      <h1>${titolo}</h1>
      <p class="attacco">${testo}</p>
      <p><a href="/#iscriviti">Torna al modulo</a></p>
    </main>
  </div>
</body>
</html>`;
  return new Response(html, { status: stato, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
