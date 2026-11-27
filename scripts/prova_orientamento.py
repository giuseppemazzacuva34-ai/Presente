# Prova nel browser dell'orientamento (issue #471, D155 = A) con Chromium e un Supabase FINTO in memoria (nessuna rete,
# nessun dato reale). Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_orientamento.py <cartella schermate>
# Controlla: 05 si continua senza orientamento (criterio 1); più etichette e «Preferisco non dirlo» esclusivo (2);
# Uomo + Gay precompila solo «Uomini» nella 06 e si può cambiare (3); «Continua» spento senza scelte o senza consenso (4);
# nessuna chiamata al database, nessuna memoria del telefono e nessun messaggio della console contiene l'orientamento (D155 = A).
import asyncio, sys, json, re, base64
from urllib.parse import urlparse
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}
SEGRETO = "parolasegretadiprova"
VIETATE = re.compile(r"orientament|eterosessual|\bgay\b|lesbic|bisessual|pansessual|queer|non_dirlo|" + SEGRETO, re.I)

db = {"profili": {}, "filtri": {}}
inviati = []

async def supabase(route):
    r = route.request
    p = urlparse(r.url).path
    inviati.append(f"{r.method} {r.url} {r.post_data or ''}")
    ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
    if p == "/auth/v1/otp": return await ok({})
    if p == "/auth/v1/verify": return await ok(TOKEN)
    m = re.match(r"^/rest/v1/(profili|filtri)$", p)
    if m:
        if r.method == "GET": return await ok([db[m.group(1)]] if db[m.group(1)] else [])
        db[m.group(1)].update(json.loads(r.post_data)); return await route.fulfill(status=201, body="")
    if p.startswith("/storage/v1/object/list/"): return await ok([])
    return await ok([])

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        await ctx.route(SUPA + "/**", supabase)
        await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
        await ctx.route("**/app/api/provincia-lista", lambda route: route.fulfill(status=200, body='{"sigla":null}', content_type="application/json"))
        await ctx.route("**/app/api/zona", lambda route: route.fulfill(status=200, body='{"zona":null,"accesa":false,"testo":null}', content_type="application/json"))
        console = []
        pg = await ctx.new_page()
        pg.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
        pg.on("pageerror", lambda e: console.append(f"pageerror: {e}"))
        n = [0]
        async def foto(nome):
            n[0] += 1; await pg.screenshot(path=f"{S}/orientamento-{n[0]:02d}-{nome}.png", full_page=True)
        def bottone(testo, nome=None):
            sel = f'button[data-nome="{nome}"]' if nome else "button"
            return pg.locator(sel).filter(has_text=re.compile("^" + re.escape(testo) + "$")).first
        async def clic(testo, nome=None): await bottone(testo, nome).click()
        o = lambda testo: clic(testo, "orientamento")
        c = lambda testo: clic(testo, "cerco")
        async def titolo(atteso):
            await pg.wait_for_function("t => document.querySelector('h1') && document.querySelector('h1').textContent === t", arg=atteso)
        async def scelto(testo, nome="orientamento"): return await bottone(testo, nome).get_attribute("aria-checked")
        continua = bottone("Continua")

        await pg.goto("http://localhost:8787/app/"); await clic("Entra")
        await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
        await pg.wait_for_selector("#giorno")
        await pg.select_option("#giorno", "9"); await pg.select_option("#mese", "5"); await pg.select_option("#anno", "1994"); await clic("Continua")
        await pg.check("#accetto"); await clic("Continua")
        await titolo("Chi sei")
        await pg.fill("#nome", "Marco"); await pg.locator("#nome").blur(); await pg.fill("#provincia", "Lecce"); await clic("Uomo")
        # Criterio 1: si può continuare senza toccare l'orientamento.
        assert await continua.is_enabled(), "criterio 1: «Continua» dovrebbe essere acceso senza orientamento"
        # Criterio 2: più etichette; «Preferisco non dirlo» toglie le altre e viceversa.
        await o("Gay"); await o("Queer")
        assert await scelto("Gay") == "true" and await scelto("Queer") == "true", "criterio 2: due etichette insieme"
        await o("Preferisco non dirlo")
        assert await scelto("Gay") == "false" and await scelto("Queer") == "false" and await scelto("Preferisco non dirlo") == "true"
        await o("Preferisco descrivermi")
        assert await scelto("Preferisco non dirlo") == "false"
        await pg.get_by_label("Come descrivi il tuo orientamento").fill(SEGRETO)
        await o("Preferisco descrivermi"); await o("Gay")
        assert await scelto("Gay") == "true" and await scelto("Preferisco descrivermi") == "false"
        await foto("05-uomo-gay")
        await clic("Continua"); await titolo("Chi cerchi")
        # Criterio 3: Uomo + Gay → solo «Uomini» già scelto.
        assert [await scelto(t, "cerco") for t in ("Donne", "Uomini", "Persone non binarie")] == ["false", "true", "false"], "criterio 3"
        await foto("06-precompilato")
        # Criterio 4: senza consenso «Continua» è spento; senza scelte anche con il consenso.
        assert not await continua.is_enabled(), "criterio 4: spento senza consenso"
        await pg.check("#consenso-cerco")
        await c("Uomini")
        assert not await continua.is_enabled(), "criterio 4: spento senza nessuna scelta"
        assert "Scegli almeno un'opzione." in await pg.content()
        await foto("06-vuoto")
        await c("Donne"); await c("Uomini")  # criterio 3: la scelta precompilata si può cambiare
        for t in ("Una storia seria", "Forse", "Indifferente"):
            if await bottone(t).count(): await clic(t)
        assert await continua.is_enabled(), "criterio 4: acceso con scelta e consenso"
        await clic("Continua"); await titolo("La tua voce")
        await foto("dopo-06")

        assert db["filtri"].get("cerco") == ["donne", "uomini"], db["filtri"]
        assert db["profili"].get("mi_presento_come") == "uomo", db["profili"]
        trovate = [x for x in inviati if VIETATE.search(x)]
        assert not trovate, ("D155 = A: l'orientamento è partito verso il database", trovate)
        memoria = await pg.evaluate("JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])")
        assert not VIETATE.search(memoria), ("D155 = A: l'orientamento è nella memoria del telefono", memoria)
        assert not [c for c in console if VIETATE.search(c)], ("D155 = A: l'orientamento è nella console", console)
        errori = [c for c in console if c.startswith(("error", "warning", "pageerror"))]
        await b.close()
        print(f"orientamento: criteri 1-4 e D155 = A passati ({len(inviati)} chiamate al database finto controllate)")
        print("console:", "pulita" if not errori else errori)
        if errori: sys.exit(1)

asyncio.run(main())
