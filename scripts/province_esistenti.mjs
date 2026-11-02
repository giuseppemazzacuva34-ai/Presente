// Provincia e regione per gli iscritti già in lista prima del menu delle province (D84 A).
// Scrive solo istruzioni SQL basate su zona e città (nessuna email, nessun dato della persona):
//   node scripts/province_esistenti.mjs > /cartella/temporanea/province.sql
//   npx wrangler d1 execute presente-lista --remote --file /cartella/temporanea/province.sql
// Tocca solo le righe ancora senza provincia. venezia-padova, brescia-bergamo, «non-indicata» e le città che non sono
// capoluogo restano senza provincia finché la persona non la indica (app, #2: provincia obbligatoria al primo accesso).
// Da eseguire SOLO dopo la pubblicazione dell'informativa 1.4 (CFO) che lo prevede.
import { PROVINCE, provinciaDaZona, regioneDi } from "../worker/province.js";
import { ZONE } from "../worker/citta.js";

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const righe = [];
for (const zona of ZONE) {
  if (zona === "altra-citta-italia") continue;
  const p = provinciaDaZona(zona, null);
  if (p) righe.push(`UPDATE iscrizioni SET provincia = ${q(p)}, regione = ${regioneDi(p) ? q(regioneDi(p)) : "NULL"} WHERE provincia IS NULL AND zona = ${q(zona)};`);
}
const citta = new Set(PROVINCE.map(([, nome]) => nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['\-]+/g, " ").replace(/\s+/g, " ").trim()));
for (const c of [...citta, "monza", "pesaro", "urbino", "forli", "cesena", "massa", "carrara", "barletta", "andria", "trani"]) {
  const p = provinciaDaZona("altra-citta-italia", c);
  if (p) righe.push(`UPDATE iscrizioni SET provincia = ${q(p)}, regione = ${q(regioneDi(p))} WHERE provincia IS NULL AND zona = 'altra-citta-italia' AND citta = ${q(c)};`);
}
console.log(["ALTER TABLE iscrizioni ADD COLUMN provincia TEXT;", "ALTER TABLE iscrizioni ADD COLUMN regione TEXT;"].map((s) => `-- se le colonne mancano: ${s}`).join("\n"));
console.log(righe.join("\n"));
