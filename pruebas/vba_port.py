# Port literal de las macros VBA del Excel de la liga (Liga_Precon_Octubre_-_Fecha_2.xlsm, Módulo1)
# Solo las partes que deciden mesas, puntos y standing. Índices 1-based como en VBA.
M32 = 0xFFFFFFFF
def _s32(x):
    x &= M32
    return x - 0x100000000 if x & 0x80000000 else x
def _imul(a, b): return _s32((a & M32) * (b & M32))
class Mulberry:
    def __init__(self, seed): self.a = _s32(seed)
    def __call__(self):
        a = self.a = _s32(self.a + 0x6D2B79F5)
        t = _imul(a ^ ((a & M32) >> 15), 1 | a)
        t = _s32(_s32(t + _imul(t ^ ((t & M32) >> 7), 61 | t)) ^ t)
        return ((t ^ ((t & M32) >> 14)) & M32) / 4294967296

class Excel:
    def __init__(self, cfg, rnd):
        self.cfg = cfg            # pWin pTie pMax pKill pKillCmd pMaxKillCmd modalidad attempts swaps
        self.Rnd = rnd
        self.Lista = []           # ListaJugadores (dicts compartidos)
        self.Hist = {}            # HistorialOponentes[(id, r)] = [ids]
        self.Torneo = []          # rondas: lista de mesas: lista de filas {id, gano, empato, k, c}
        self.inscripcion = []     # filas de INSCRIPCION: {nombre, cmd, drop}
    # ---- INSCRIPCION ----
    def inscribir(self, nombre, cmd): self.inscripcion.append({"nombre": nombre, "cmd": cmd, "drop": False})
    def cargar(self):
        self.Lista = [{"nombre": r["nombre"], "cmd": r["cmd"], "id": i + 1, "activo": not r["drop"], "pts": 0, "kills": 0, "buch": 0.0}
                      for i, r in enumerate(self.inscripcion)]
    def recargar_memoria(self):
        n0 = len(self.Lista)
        for n in range(n0 + 1, len(self.inscripcion) + 1):
            r = self.inscripcion[n - 1]
            self.Lista.append({"nombre": r["nombre"], "cmd": r["cmd"], "id": n, "activo": not r["drop"], "pts": 0, "kills": 0, "buch": 0.0})
        for p in self.Lista: p["activo"] = not self.inscripcion[p["id"] - 1]["drop"]
    def ronda_actual(self): return len(self.Torneo)
    def por_id(self, i): return next(p for p in self.Lista if p["id"] == i)
    def cmd_de(self, i): return self.por_id(i)["cmd"].strip().upper()
    def valid_cmd(self, c): return c != "" and c != "DESCONOCIDO"
    # ---- DesordenarAleatoriamente ----
    def desordenar(self):
        L = self.Lista
        for i in range(len(L), 1, -1):
            j = int(i * self.Rnd()) + 1
            L[i - 1], L[j - 1] = L[j - 1], L[i - 1]
    # ---- Puntajes ----
    def actualizar_puntajes(self, r):
        c = self.cfg
        for mesa in self.Torneo[r - 1]:
            for f in mesa:
                pts = 0
                if f["gano"]: pts = c["pWin"]
                if f["empato"]: pts = c["pTie"]
                pts += f["k"] * c["pKill"]
                pk = f["c"] * c["pKillCmd"]
                if pk > c["pMaxKillCmd"]: pk = c["pMaxKillCmd"]
                pts += pk
                if pts > c["pMax"]: pts = c["pMax"]
                p = self.por_id(f["id"])
                p["pts"] += pts; p["kills"] += f["k"] + f["c"]
    def registrar_oponentes(self, r):
        for mesa in self.Torneo[r - 1]:
            ids = [f["id"] for f in mesa]
            for a in ids: self.Hist[(a, r)] = [b for b in ids if b != a]
    def calcular_buchholz(self):
        for p in self.Lista: p["buch"] = 0.0
        if self.ronda_actual() <= 1: return
        for p in self.Lista:
            for r in range(1, 6):
                for op in self.Hist.get((p["id"], r), []):
                    p["buch"] += self.por_id(op)["pts"]
    def ordenar_ranking(self):
        self.calcular_buchholz()
        L = self.Lista
        for i in range(len(L) - 1):
            for j in range(i + 1, len(L)):
                a, b = L[i], L[j]
                sw = b["pts"] > a["pts"] or (b["pts"] == a["pts"] and b["kills"] > a["kills"]) or (b["pts"] == a["pts"] and b["kills"] == a["kills"] and b["buch"] > a["buch"])
                if sw: L[i], L[j] = L[j], L[i]
    def recalcular(self, hasta):
        for p in self.Lista: p["pts"] = 0; p["kills"] = 0; p["buch"] = 0.0
        self.Hist = {}
        for r in range(1, hasta + 1):
            self.actualizar_puntajes(r); self.registrar_oponentes(r)
        self.ordenar_ranking()
    # ---- Flujo de botones ----
    def generar_ronda1(self):
        self.Torneo = []; self.cargar(); self.desordenar()
        self.Torneo.append(None); self.asignar_mesas()
    def generar_siguiente(self):
        self.recargar_memoria(); self.recalcular(self.ronda_actual())
        self.Torneo.append(None); self.asignar_mesas()
    def resultados_finales(self):
        self.recargar_memoria(); self.recalcular(self.ronda_actual())
    def matriz(self, prev):
        M = set()
        for (i, r), ops in self.Hist.items():
            if r <= prev:
                for o in ops:
                    if o != i: M.add((i, o)); M.add((o, i))
        return M
    @staticmethod
    def tamanos(n):
        n4 = n // 4; r = n % 4; n3 = 0
        if r == 1:
            if n4 >= 2: n4 -= 2; n3 = 3
            else: n4 = 0; n3 = 2
        elif r == 2:
            if n4 >= 1: n4 -= 1; n3 = 2
            else: n3 = 1
        elif r == 3: n3 = 1
        return n4, n3
    def asignar_mesas(self):
        mod = self.cfg["modalidad"]; R = self.ronda_actual()
        alea = mod in ("ALEATORIO", "RANDOM") or (mod == "SUIZO DESAFIO" and R <= 2)
        mesas = self.aleatorio() if alea else self.clasico()
        self.Torneo[R - 1] = [[{"id": i, "gano": False, "empato": False, "k": 0, "c": 0} for i in m] for m in mesas]
    # ---- AsignarMesas_Clasico_FFA + RepararConflictosInterMesas ----
    def clasico(self):
        R = self.ronda_actual()
        Idx = [p for p in self.Lista if p["activo"]]
        num = len(Idx); n4, n3 = self.tamanos(num)
        hist = R >= 2
        MC = self.matriz(R - 1) if hist else set()
        ptr = 1
        for m in range(1, n4 + n3 + 1):
            cap = 4 if m <= n4 else 3
            mesa = []
            for _ in range(cap):
                if ptr <= num:
                    p = Idx[ptr - 1]; cmd = p["cmd"].strip().upper()
                    cc = any(o["cmd"].strip().upper() == cmd and self.valid_cmd(cmd) for o in mesa)
                    ch = hist and any((p["id"], o["id"]) in MC for o in mesa)
                    if cc or ch:
                        oro = plata = bronce = 0
                        for sc in range(ptr + 1, num + 1):
                            s = Idx[sc - 1]
                            if R == 1: ok = True
                            else: ok = s["pts"] == p["pts"] and s["kills"] == p["kills"] and abs(s["buch"] - p["buch"]) < 0.01
                            if ok:
                                cs = s["cmd"].strip().upper()
                                scc = any(o["cmd"].strip().upper() == cs and self.valid_cmd(cs) for o in mesa)
                                sch = hist and any((s["id"], o["id"]) in MC for o in mesa)
                                if not scc and not sch: oro = sc; break
                                elif not scc and sch and plata == 0: plata = sc
                                elif scc and not sch and bronce == 0: bronce = sc
                            else: break
                        fs = oro or plata or bronce
                        if fs > 0:
                            s = Idx[fs - 1]; Idx[fs - 1] = p; Idx[ptr - 1] = s; p = s
                    mesa.append(p); ptr += 1
        # RepararConflictosInterMesas
        caps = [4] * n4 + [3] * n3
        Mesas = []; ptr = 0
        for cap in caps:
            Mesas.append(Idx[ptr:ptr + cap]); ptr += cap
        if R >= 2:
            def conf(a, b): return (a["id"], b["id"]) in MC or (a["cmd"].strip().upper() == b["cmd"].strip().upper() and self.valid_cmd(a["cmd"].strip().upper()))
            def limpio(m, ign, nuevo):
                for k in range(1, len(Mesas[m - 1]) + 1):
                    if k != ign:
                        o = Mesas[m - 1][k - 1]
                        if (nuevo["id"], o["id"]) in MC: return False
                        nc = nuevo["cmd"].strip().upper()
                        if nc == o["cmd"].strip().upper() and self.valid_cmd(nc): return False
                return True
            def remove_add(m, p, nuevo):
                col = Mesas[m - 1]; del col[p - 1]
                before = len(col) if p > len(col) else p          # Add Before:=IIf(p > count, count, p)
                col.insert(before - 1, nuevo)
            for m in range(len(Mesas), 0, -1):
                capM = len(Mesas[m - 1])
                for p in range(capM, 0, -1):
                    pl = Mesas[m - 1][p - 1]
                    tiene = any(k != p and conf(pl, Mesas[m - 1][k - 1]) for k in range(1, capM + 1))
                    if tiene:
                        hecho = False
                        for tm in range(1, len(Mesas) + 1):
                            if tm != m:
                                for tp in range(1, len(Mesas[tm - 1]) + 1):
                                    t = Mesas[tm - 1][tp - 1]
                                    if t["pts"] == pl["pts"]:
                                        if limpio(m, p, t) and limpio(tm, tp, pl):
                                            remove_add(m, p, t); remove_add(tm, tp, pl); hecho = True; break
                            if hecho: break
        return [[p["id"] for p in m] for m in Mesas if m]
    # ---- AsignarMesas_AleatorioConMaximosOponentesNuevos ----
    def aleatorio(self):
        prev = self.ronda_actual()
        Act = [p for p in self.Lista if p["activo"]]
        num = len(Act); n4, n3 = self.tamanos(num); nT = n4 + n3
        cap = [4] * n4 + [3] * n3
        MC = self.matriz(prev)
        cmd = {p["id"]: p["cmd"].strip().upper() for p in self.Lista}
        def mismo(a, b): return cmd[a] == cmd[b] and self.valid_cmd(cmd[a])
        def conflictos(t, pid, TP):
            s = 0
            for o in TP[t]:
                if o > 0 and o != pid:
                    if (pid, o) in MC: s += 1
                    if mismo(pid, o): s += 10
            return s
        def score(TP):
            sc = 0
            for t in range(nT):
                m = TP[t]
                for i in range(len(m) - 1):
                    for j in range(i + 1, len(m)):
                        sc += -500 if (m[i], m[j]) in MC else 1
                        if mismo(m[i], m[j]): sc -= 300
            return sc
        best = None; bestS = -99999999
        for _ in range(self.cfg["attempts"]):
            Idxs = list(range(1, num + 1))
            for i in range(num, 1, -1):
                j = int(i * self.Rnd()) + 1
                Idxs[j - 1], Idxs[i - 1] = Idxs[i - 1], Idxs[j - 1]
            TP = [[] for _ in range(nT)]
            for i in range(num):
                pid = Act[Idxs[i] - 1]["id"]
                bt = 0; minc = 9999
                for t in range(1, nT + 1):
                    if len(TP[t - 1]) < cap[t - 1]:
                        c = conflictos(t - 1, pid, TP)
                        if c == 0: bt = t; break
                        if c < minc: minc = c; bt = t
                if bt == 0:
                    for t in range(1, nT + 1):
                        if len(TP[t - 1]) < cap[t - 1]: bt = t; break
                TP[bt - 1].append(pid)
            cur = score(TP)
            for _s in range(self.cfg["swaps"]):
                t1 = int(nT * self.Rnd()) + 1; t2 = int(nT * self.Rnd()) + 1
                if t1 != t2 and len(TP[t1 - 1]) > 0 and len(TP[t2 - 1]) > 0:
                    p1 = int(len(TP[t1 - 1]) * self.Rnd()) + 1; p2 = int(len(TP[t2 - 1]) * self.Rnd()) + 1
                    a = TP[t1 - 1][p1 - 1]; b = TP[t2 - 1][p2 - 1]
                    TP[t1 - 1][p1 - 1] = b; TP[t2 - 1][p2 - 1] = a
                    nv = score(TP)
                    if nv >= cur: cur = nv
                    else: TP[t1 - 1][p1 - 1] = a; TP[t2 - 1][p2 - 1] = b
            if cur > bestS:
                bestS = cur; best = [m[:] for m in TP]
        return [m for m in best if m]
    # ---- POSICIONES ----
    def posiciones(self):
        return [(p["nombre"], p["pts"], p["kills"], p["buch"]) for p in self.Lista]
