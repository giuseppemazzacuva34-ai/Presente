# Prova dell'accesso con email nella web app (issue #2) con Chromium e un Supabase FINTO (nessuna rete, nessun dato reale).
# Uso: node scripts/server_locale.mjs "$PWD" &  poi  python3 scripts/prova_accesso.py <cartella per le schermate>
# Controlla: invio del link, codice sbagliato, codice giusto → maggiore età; arrivo dal link → token tolti dall'indirizzo;
# link scaduto → messaggio della specifica; console pulita.
import asyncio, sys, json, re
from playwright.async_api import async_playwright

S = sys.argv[1]
SUPA = "https://abcdefghijklmnopqrst.supabase.co"
CONFIG = {"pronta": True, "accesso": True, "supabaseUrl": SUPA, "supabaseAnonKey": "sb_publishable_finta"}
TOKEN = {"access_token": "acc", "refresh_token": "ref", "expires_in": 3600, "user": {"id": "u1"}}

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        chiamate = []
        async def supabase(route):
            r = route.request
            corpo = json.loads(r.post_data or "{}")
            chiamate.append((r.url, corpo, r.headers.get("apikey")))
            if "/auth/v1/otp" in r.url:
                return await route.fulfill(status=200, body="{}", content_type="application/json")
            if "/auth/v1/verify" in r.url:
                if corpo.get("token") == "123456":
                    return await route.fulfill(status=200, body=json.dumps(TOKEN), content_type="application/json")
                return await route.fulfill(status=403, body=json.dumps({"error_code": "otp_expired"}), content_type="application/json")
            await route.fulfill(status=404, body="{}")
        await ctx.route(SUPA + "/**", supabase)
        await ctx.route("**/app/config.json", lambda route: route.fulfill(status=200, body=json.dumps(CONFIG), content_type="application/json"))
        errori = []
        def console(m):
            # Il 403 del codice sbagliato è voluto: il browser lo scrive in console, non è un errore della pagina.
            if m.type in ("error", "warning") and "403" not in m.text:
                errori.append(f"{m.type}: {m.text}")
        async def nuova():
            pg = await ctx.new_page()
            pg.on("console", console)
            pg.on("pageerror", lambda e: errori.append(f"pageerror: {e}"))
            return pg
        async def clic(pg, testo):
            await pg.locator("button").filter(has_text=re.compile("^" + re.escape(testo) + "$")).first.click()

        # 1. Email → codice sbagliato → codice giusto
        pg = await nuova()
        await pg.goto("http://localhost:8787/app/"); await pg.wait_for_timeout(500)
        assert "accesso con email è vero" in await pg.locator(".anteprima").inner_text()
        await clic(pg, "Entra"); await pg.fill("#email", "Prova@Example.com"); await clic(pg, "Mandami il link")
        await pg.wait_for_selector("#codice"); await pg.screenshot(path=f"{S}/accesso-1-codice.png")
        otp = [c for c in chiamate if "/otp" in c[0]][0]
        assert otp[1] == {"email": "prova@example.com", "create_user": True} and otp[2] == "sb_publishable_finta", otp
        assert "redirect_to=http%3A%2F%2Flocalhost%3A8787%2Fapp%2F" in otp[0], otp[0]
        await pg.fill("#codice", "000000"); await clic(pg, "Entra"); await pg.wait_for_selector(".errore")
        assert "Codice sbagliato" in await pg.locator(".errore").inner_text()
        await pg.screenshot(path=f"{S}/accesso-2-codice-sbagliato.png")
        await pg.fill("#codice", "123456"); await clic(pg, "Entra")
        await pg.wait_for_selector("#giorno"); await pg.screenshot(path=f"{S}/accesso-3-dentro.png")
        memoria = await pg.evaluate("localStorage.getItem('presente.sessione')")
        assert memoria and "prova@example.com" not in memoria.lower(), memoria
        # Riaprendo l'app si è ancora dentro.
        await pg.reload(); await pg.wait_for_selector("#giorno")
        await pg.evaluate("localStorage.clear()"); await pg.close()

        # 2. Arrivo dal link nell'email
        pg = await nuova()
        await pg.goto("http://localhost:8787/app/#access_token=acc&refresh_token=ref&expires_in=3600&token_type=bearer&type=magiclink")
        await pg.wait_for_selector("#giorno")
        assert "access_token" not in pg.url, pg.url
        await pg.evaluate("localStorage.clear()"); await pg.close()

        # 3. Link scaduto
        pg = await nuova()
        await pg.goto("http://localhost:8787/app/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")
        await pg.wait_for_selector(".errore")
        assert await pg.locator(".errore").inner_text() == "Link scaduto, te ne mandiamo un altro.", await pg.locator(".errore").inner_text()
        assert "error" not in pg.url, pg.url
        await pg.screenshot(path=f"{S}/accesso-4-scaduto.png")

        await b.close()
        print("accesso: tutte le prove passate")
        print("console:", "pulita" if not errori else errori)
        if errori: sys.exit(1)

asyncio.run(main())
