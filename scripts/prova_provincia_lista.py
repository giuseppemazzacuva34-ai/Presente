# Prova nel browser della provincia dalla lista d'attesa (#2 v1.3) con Chromium, Supabase FINTO e Worker FINTO in memoria.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_provincia_lista.py <cartella per le schermate>
# Controlla: lista con RM → «Roma» già scelta con la riga «Dalla lista d'attesa» e conferma al server; lista vuota → campo
# vuoto con «Scegli la tua provincia»; Worker che non risponde → dopo 2 secondi si va avanti col campo vuoto; console pulita.
import asyncio, sys, json, re, base64, time
from urllib.parse import urlparse
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}

async def prova(b, nome, risposta_lista, attesa=0):
    db = {"profili": {}, "filtri": {}}
    conferme = []
    async def supabase(route):
        r = route.request
        p = urlparse(r.url).path
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if p == "/auth/v1/otp": return await ok({})
        if p == "/auth/v1/verify": return await ok(TOKEN)
        m = re.match(r"^/rest/v1/(profili|filtri|questionario)$", p)
        if m:
            if r.method == "GET": return await ok([db[m.group(1)]] if db.get(m.group(1)) else [])
            db[m.group(1)].update(json.loads(r.post_data)); return await route.fulfill(status=201, body="")
        if re.match(r"^/storage/v1/object/list/", p): return await ok([])
        raise AssertionError(f"chiamata inattesa {r.method} {r.url}")
    async def lista(route):
        r = route.request
        assert r.headers.get("authorization") == f"Bearer {ACC}"
        if r.method == "POST":
            conferme.append(json.loads(r.post_data))
            db["profili"]["provincia"] = conferme[-1]["sigla"]; db["profili"]["provincia_origine_server"] = "lista"
            return await route.fulfill(status=200, body='{"lista":true}', content_type="application/json")
        if attesa: await asyncio.sleep(attesa)
        try:
            await route.fulfill(status=200, body=json.dumps(risposta_lista), content_type="application/json")
        except Exception:
            pass  # richiesta già annullata dall'app (tempo scaduto)
    ctx = await b.new_context(viewport={"width": 390, "height": 844})
    await ctx.route(SUPA + "/**", supabase)
    await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
    await ctx.route("**/app/api/provincia-lista", lista)
    errori = []
    pg = await ctx.new_page()
    pg.on("console", lambda m: errori.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
    async def clic(testo):
        await pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$")).first.click()
    await pg.goto("http://localhost:8787/app/"); await clic("Entra")
    await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
    await pg.wait_for_selector("#giorno")
    await pg.select_option("#giorno", "9"); await pg.select_option("#mese", "5"); await pg.select_option("#anno", "1994"); await clic("Continua")
    await pg.check("#accetto"); await clic("Continua")
    await pg.wait_for_selector("#provincia")
    inizio = time.time()
    if risposta_lista.get("sigla") and not attesa:
        await pg.wait_for_function("() => document.querySelector('#provincia').value === 'Roma'")
        assert await pg.locator("#provincia-lista").is_visible(), "manca la riga «Dalla lista d'attesa»"
    else:
        await pg.wait_for_timeout(int(attesa * 1000) + 300 if attesa else 500)
        assert await pg.input_value("#provincia") == "", "il campo deve restare vuoto"
        assert await pg.get_attribute("#provincia", "placeholder") == "Scegli la tua provincia"
        assert not await pg.locator("#provincia-lista").is_visible()
        await pg.fill("#provincia", "Lecce")
    await pg.screenshot(path=f"{S}/lista-{nome}.png", full_page=True)
    await pg.fill("#nome", "Giulia"); await clic("Donna"); await clic("Continua")
    await pg.wait_for_function("() => document.querySelector('h1').textContent === 'Chi cerchi'")
    if risposta_lista.get("sigla") and not attesa:
        assert conferme == [{"sigla": "RM"}], conferme
        assert db["profili"]["provincia"] == "RM", db["profili"]
    else:
        assert conferme == [], conferme
        assert db["profili"]["provincia"] == "LE", db["profili"]
    await ctx.close()
    print(f"{nome}: ok", "console pulita" if not errori else errori)
    return errori

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errori = []
        errori += await prova(b, "con-roma", {"sigla": "RM"})
        errori += await prova(b, "non-in-lista", {"sigla": None})
        errori += await prova(b, "worker-lento", {"sigla": "RM"}, attesa=3)
        await b.close()
        if errori: sys.exit(1)

asyncio.run(main())
