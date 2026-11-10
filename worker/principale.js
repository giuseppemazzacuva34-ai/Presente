// Punto di partenza del Worker «presente» (wrangler.jsonc › main).
// Il Worker vero è in worker/index.js; qui si aggiungono le classi dei Durable Object, che usano «cloudflare:workers»
// e quindi non si caricano in Node: così i test di index.js restano senza Cloudflare.
export { default } from "./index.js";
export { Chiamata } from "./chiamata.js";
