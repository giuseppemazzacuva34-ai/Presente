// Intestazioni di sicurezza per le risposte create dal Worker (/iscrizione, /conteggio).
// Le pagine statiche le ricevono da landing/_headers; queste sono le stesse regole, per le pagine generate dal codice.
const SICUREZZA = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; font-src 'self'; script-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

export function conSicurezza(risposta) {
  const nuova = new Response(risposta.body, risposta);
  for (const [nome, valore] of Object.entries(SICUREZZA)) nuova.headers.set(nome, valore);
  return nuova;
}
