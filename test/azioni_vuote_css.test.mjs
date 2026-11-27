// Linea «sviluppatore-c» (#349, schermata 18): nella home la barra dei pulsanti in fondo (.azioni) è «sticky» con
// sfondo sfumato anche quando è vuota, e copriva la metà bassa di «Entra nella stanza» del Filo (segnalazione del CTO
// del 27/11). Una barra vuota non deve restare incollata in fondo né avere sfondo; il Filo ha spazio sotto di sé.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../landing/app/app.css", import.meta.url), "utf8");

test("una barra .azioni vuota non resta incollata in fondo e non copre niente", () => {
  assert.match(css, /\.azioni:empty \{[^}]*position: static/);
  assert.match(css, /\.azioni:empty \{[^}]*background: none/);
});

test("la schermata 18 del Filo lascia spazio sotto «Entra nella stanza»", () => {
  assert.match(css, /\.app \.filo-lunedi \{[^}]*margin-bottom: 24px/);
});
