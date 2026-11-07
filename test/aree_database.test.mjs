// La mappa delle aree vaste nel database (migrazione) è la stessa di api/aree.js (D121 A): stesse aree, stessi nomi,
// stesse province. Se una delle due cambia senza l'altra, «Verifica» si ferma.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { AREE } from "../api/aree.js";

const cartella = new URL("../supabase/migrations/", import.meta.url);
const file = readdirSync(cartella).find((n) => n.endsWith("_aree.sql"));

test("la migrazione delle aree esiste", () => assert.ok(file, "manca supabase/migrations/*_aree.sql"));

test("aree e province nel database = api/aree.js", () => {
  const sql = readFileSync(new URL(file, cartella), "utf8");
  const aree = [...sql.matchAll(/\('([a-z-]+)', '([^']+)', array\[([^\]]+)\]\)/g)].map((m) => ({
    codice: m[1], nome: m[2], province: m[3].split(",").map((s) => s.trim().replace(/'/g, "")),
  }));
  assert.deepEqual(aree, AREE.map((a) => ({ codice: a.codice, nome: a.nome, province: [...a.province] })));
});
