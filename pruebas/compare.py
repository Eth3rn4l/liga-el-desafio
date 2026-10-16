# Simula fechas completas en el Excel (port VBA) y en la página (JS real del sitio) con el mismo azar, y compara todo.
import asyncio, json, random, sys, http.server, threading, functools
sys.path.insert(0, "/tmp/claude-0/sim")
from vba_port import Excel, Mulberry
from playwright.async_api import async_playwright
ROOT = "/home/claude/el-desafio"
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8771), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
MOCK = open("/home/claude/el-desafio-build/mock-supabase.js").read()
CMDS = ["Atraxa, Praetors' Voice", "Jace, Multiverse Architect", "Chatterfang, Squirrel General", "Tidus, Yuna's Guardian", "Rootha, Mastering the Moment",
        "Doctor Doom, King of Latveria", "Valgavoth, Harrower of Souls", "Teval, the Balanced Scale", "Commodore Guff", "Inquisitor Greyfax",
        "Satya, Aetherflux Genius", "Hakbal of the Surging Soul", "Ulalek, Fused Atrocity", "Pantlaza, Sun-Favored", "Zhulodok, Void Gorger"]
MODOS = {"desafio": "SUIZO DESAFIO", "suizo": "SUIZO", "azar": "ALEATORIO"}

JS_SETUP = """(seed) => { let a = seed | 0; Math.random = function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }"""

def gen_result(R, seats):
    n = len(seats); tipo = R.random()
    res = {"w": None, "a": [], "k": {}, "c": {}}
    if tipo < 0.55:
        w = R.choice(seats); res["w"] = w; res["a"] = [w]
    elif tipo < 0.85:
        res["a"] = R.sample(seats, R.randint(2, n))
    else:
        w = R.choice(seats); res["w"] = w; otros = [s for s in seats if s != w]
        res["a"] = [w] + R.sample(otros, R.randint(1, len(otros)))
    dead = n - len(res["a"])
    for _ in range(R.randint(0, dead)):
        who = R.choice(seats)
        if R.random() < 0.3: res["c"][who] = res["c"].get(who, 0) + 1
        else: res["k"][who] = res["k"].get(who, 0) + 1
    return res

async def una_fecha(pg, seed, modo, n, rondas, eventos):
    R = random.Random(seed * 7919 + n)
    nombres = [f"Jugador {i:02d}" for i in range(1, n + 1)]
    cmds = [R.choice(CMDS[: max(3, n // 2)]) for _ in nombres]
    cfg = {"pWin": 3, "pTie": 1, "pMax": 3, "pKill": 1, "pKillCmd": 1, "pMaxKillCmd": 3, "modalidad": MODOS[modo], "attempts": 100, "swaps": 300}
    X = Excel(cfg, Mulberry(seed))
    for nm, c in zip(nombres, cmds): X.inscribir(nm, c)
    st = {"cfg": {"min": 70, "rounds": rondas, "win": 3, "kill": 1, "surv": 1, "cap": 3, "cmdKill": 1, "cmdCap": 3, "pairing": modo},
          "players": [{"id": f"p{i}", "name": nm, "deck": {"c": c}} for i, (nm, c) in enumerate(zip(nombres, cmds))], "rounds": [], "dropped": {}}
    await pg.evaluate(JS_SETUP, seed)
    # Ronda 1
    X.generar_ronda1()
    st = await pg.evaluate("st => { const M = window.__motor; st.orden = M.shuffleExcel(st.players.map(p => p.id)); st.rounds.push(M.buildRound(st, 0)); return st; }", st)
    name = {p["id"]: p["name"] for p in st["players"]}
    id_of = lambda nm: next(p["id"] for p in st["players"] if p["name"] == nm)
    xname = lambda i: X.por_id(i)["nombre"]
    difs = []
    for r in range(1, rondas + 1):
        mx = [[xname(i) for i in m] for m in [[f["id"] for f in mesa] for mesa in X.Torneo[r - 1]]]
        mp = [[name[s] for s in t["seats"]] for t in st["rounds"][r - 1]["tables"]]
        if mx != mp:
            difs.append(f"ronda {r}: mesas distintas\n  excel  {mx}\n  pagina {mp}"); return difs
        # resultados iguales en ambos
        for ti, t in enumerate(st["rounds"][r - 1]["tables"]):
            res = gen_result(R, t["seats"]); t["result"] = {k: v for k, v in res.items() if v or k == "w"}
            ties = [s for s in res["a"] if s != res["w"]]
            for f in X.Torneo[r - 1][ti]:
                pid = id_of(xname(f["id"]))
                f["gano"] = pid == res["w"]; f["empato"] = pid in ties
                f["k"] = res["k"].get(pid, 0); f["c"] = res["c"].get(pid, 0)
        # eventos entre rondas (drop / llegada tarde)
        for ev in eventos.get(r, []):
            if ev[0] == "drop":
                nm = ev[1]; X.inscripcion[[q["nombre"] for q in X.inscripcion].index(nm)]["drop"] = True; st["dropped"][id_of(nm)] = r
            else:
                nm, c = ev[1], ev[2]; X.inscribir(nm, c); st["players"].append({"id": "late" + str(len(st["players"])), "name": nm, "deck": {"c": c}}); name[st["players"][-1]["id"]] = nm
        if r < rondas:
            X.generar_siguiente()
            st = await pg.evaluate("([st, r]) => { const M = window.__motor; st.rounds.push(M.buildRound(st, r)); return st; }", [st, r])
            # standing con el que se armó la ronda (POSICIONES)
            sx = [(nm, p, k, b) for nm, p, k, b in X.posiciones()]
            sp = await pg.evaluate("([st, r]) => window.__motor.standings(st, r).map(x => [x.name, x.pts, x.k, x.buch])", [st, r])
            if [list(t) for t in sx] != sp: difs.append(f"standing tras ronda {r} distinto\n  excel  {sx}\n  pagina {sp}"); return difs
    X.resultados_finales()
    sx = [list(t) for t in X.posiciones()]
    sp = await pg.evaluate("st => window.__motor.standings(st).map(x => [x.name, x.pts, x.k, x.buch])", st)
    if sx != sp: difs.append(f"standing final distinto\n  excel  {sx}\n  pagina {sp}")
    return difs

async def main():
    casos = []
    rr = random.Random(2026)
    plan = [("desafio", 8), ("suizo", 8), ("azar", 4)]
    for modo, cuantos in plan:
        for k in range(cuantos):
            n = rr.choice([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 21, 22, 23, 24, 25, 26, 29, 32])
            rondas = rr.choice([3, 3, 3, 4])
            ev = {}
            if rr.random() < 0.4: ev[1] = [("drop", f"Jugador {rr.randint(1, n):02d}")]
            if rr.random() < 0.4: ev.setdefault(1, []).append(("late", "Tardío Uno", rr.choice(CMDS)))
            casos.append((rr.randint(1, 10**9), modo, n, rondas, ev))
    async with async_playwright() as p:
        b = await p.chromium.launch(); c = await b.new_context()
        await c.route("**/supabase.min.js", lambda r: r.fulfill(body=MOCK, content_type="application/javascript"))
        await c.route("https://**", lambda r: r.abort())
        pg = await c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("http://127.0.0.1:8771/?liga=precon&motor=1"); await pg.wait_for_timeout(1500)
        assert await pg.evaluate("!!window.__motor"), "sin __motor"
        ok = 0; malos = []
        for i, (seed, modo, n, rondas, ev) in enumerate(casos):
            d = await una_fecha(pg, seed, modo, n, rondas, ev)
            if d: malos.append((seed, modo, n, rondas, ev, d)); print("DIF", seed, modo, n, rondas, ev, "\n", d[0][:1500], flush=True)
            else: ok += 1
            if (i + 1) % 10 == 0: print(f"{i+1}/{len(casos)} ok={ok}", flush=True)
        print("TOTAL", len(casos), "iguales", ok, "distintos", len(malos), "errores js", errs[:3])
        await b.close()
asyncio.run(main())
