# Prova nel browser della home prima della stanza (design v4, schermata 16, #349 linea A) con Chromium, Supabase FINTO
# in memoria e Worker finto. Nessun dato reale.
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_home_v4.py <cartella per le schermate>
# Controlla: nella prima schermata (390×844) settimana, conto alla rovescia, cerchio e un solo pulsante «Ci sarò lunedì»
# in fondo; il resto della home (profilo, aiuto) sotto; «Ci sarò lunedì» conferma e mostra «Ci ripenso»; console pulita.
import asyncio, sys, json, re, base64
from urllib.parse import urlparse
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
ID = "11111111-2222-4333-8444-555555555555"
ACC = "eyJhbGciOiJIUzI1NiJ9." + base64.urlsafe_b64encode(json.dumps({"sub": ID, "role": "authenticated"}).encode()).decode().rstrip("=") + ".firma"
TOKEN = {"access_token": ACC, "refresh_token": "ref", "expires_in": 3600, "user": {"id": ID}}
PROFILO = {"id": ID, "passo": 10, "nome": "Giulia", "provincia": "MI", "mi_presento_come": "donna",
           "data_nascita": "1994-05-09", "regole_accettate_il": "2026-11-01T10:00:00Z"}
LUNEDI = "2026-11-30T08:00:00+00:00"

async def main():
    conferme = []
    async def supabase(route):
        r = route.request
        p = urlparse(r.url).path
        ok = lambda corpo, stato=200: route.fulfill(status=stato, body=json.dumps(corpo), content_type="application/json")
        if p == "/auth/v1/otp": return await ok({})
        if p == "/auth/v1/verify": return await ok(TOKEN)
        if p == "/rest/v1/profili": return await ok([PROFILO])
        if p == "/rest/v1/filtri": return await ok([{"cerco": "uomini", "eta_min": 30, "eta_max": 45, "raggio": "italia"}])
        if p == "/rest/v1/conferme_stanza":
            if r.method == "GET": return await ok([{"apre_il": c} for c in conferme])
            if r.method == "POST": conferme.append(LUNEDI); return await ok([{"apre_il": LUNEDI}], 201)
            if r.method == "DELETE":
                via = [{"apre_il": c} for c in conferme]; conferme.clear(); return await ok(via)
        return await ok([])
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        await ctx.route(SUPA + "/**", supabase)
        await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
        await ctx.route("**/app/api/**", lambda route: route.fulfill(status=404, body='{"ok":false}', content_type="application/json"))
        errori = []
        pg = await ctx.new_page()
        pg.on("console", lambda m: errori.append(f"{m.type}: {m.text}") if m.type == "error" and "404" not in m.text else None)
        pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
        async def clic(testo):
            await pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$", re.I)).first.click()
        await pg.goto("http://localhost:8787/app/"); await clic("Entra")
        await pg.fill("#email", "prova@example.com"); await clic("Mandami il link"); await pg.fill("#codice", "123456"); await clic("Entra")
        await pg.wait_for_selector("#conto-settimana")
        await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{S}/16-home.png")
        await pg.screenshot(path=f"{S}/16-home-intera.png", full_page=True)
        cta = pg.locator("#app .azioni-home .bottone")
        if await cta.count():
            box = await cta.first.bounding_box()
            print("pulsante:", (await cta.first.inner_text()).strip(), "in basso a", round(box["y"] + box["height"]), "di 844")
            await cta.first.click(); await pg.wait_for_selector("#conferma-stanza")
            await pg.screenshot(path=f"{S}/16-home-confermata.png")
            print("dopo:", await pg.locator("#conferma-stanza").inner_text())
        print("ERRORI", errori)
        await b.close()
asyncio.run(main())
