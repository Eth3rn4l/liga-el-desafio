// Imágenes de las mesas para WhatsApp: una imagen vertical cada 4 mesas, con el diseño de la página.
// Se dibujan con el mismo Chrome que usa WhatsApp (o uno propio en modo --simular).

const fs = require("fs");
const path = require("path");
const { standing } = require("./anuncios");

const DIR = __dirname;
const MESAS_POR_IMAGEN = 4;
const NOMBRE_LIGA = { precon: "Liga Precon", b3: "Liga Bracket 3", precon_test: "Liga Precon · Testeo", b3_test: "Liga Bracket 3 · Testeo" };
const SISTEMA = { suizo: "Suizo", desafio: "Suizo Desafío", azar: "Al azar" };
const MANA_CSS = fs.readFileSync(path.join(DIR, "mana.css"), "utf8");
const LOGO = fs.readFileSync(path.join(DIR, "logo.png")).toString("base64");
const ORDEN = "WUBRG";

// ---------- Identidad de color de los comandantes (Scryfall, con caché en disco) ----------
const CI_FILE = path.join(DIR, "colores.json");
let CI = {}; try { CI = JSON.parse(fs.readFileSync(CI_FILE, "utf8")); } catch (e) {}
const norm = s => String(s || "").trim().toLowerCase();
const partes = c => String(c || "").split(/\s+\+\s+/).map(x => x.trim()).filter(Boolean);
async function cargarColores(nombres) {
  const faltan = [...new Set(nombres.map(norm))].filter(n => n && !(n in CI));
  for (let i = 0; i < faltan.length; i += 70) {
    const lote = faltan.slice(i, i + 70);
    try {
      const r = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "LigaElDesafioBot/1.0", Accept: "application/json" },
        body: JSON.stringify({ identifiers: lote.map(name => ({ name })) })
      });
      if (!r.ok) continue;
      const j = await r.json();
      (j.data || []).forEach(c => {
        const ci = (c.color_identity || []).join("");
        CI[norm(c.name)] = ci;
        if (c.name.includes(" // ")) CI[norm(c.name.split(" // ")[0])] = ci;
      });
    } catch (e) { /* sin internet: sin símbolos de maná */ }
    await new Promise(r => setTimeout(r, 150));
  }
  try { fs.writeFileSync(CI_FILE, JSON.stringify(CI)); } catch (e) {}
}
// Colores de un mazo: lo guardado en la liga o, si no, lo de Scryfall (unión si son dos comandantes)
function coloresDe(deck) {
  if (deck && typeof deck.ci === "string") return deck.ci.split("~")[0];
  const ps = partes(deck && deck.c);
  if (!ps.length || ps.some(p => !(norm(p) in CI))) return null;
  const set = new Set(ps.flatMap(p => CI[norm(p)].split("")));
  return ORDEN.split("").filter(x => set.has(x)).join("");
}

// ---------- HTML ----------
const E = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function fechaLarga(f) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f || ""); if (!m) return "";
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}
function pips(ci) {
  if (ci == null) return "";
  const xs = ci ? ci.split("") : ["C"];
  return `<span class="ci">${xs.map(x => `<i class="pip-${x}"></i>`).join("")}</span>`;
}

function htmlMesas(S, liga, ri, mesas, desde, parte, total) {
  const P = {}; S.players.forEach(p => P[p.id] = p);
  const pts = {}; standing(S, ri).forEach(x => pts[x.id] = x.pts);   // puntos acumulados antes de esta ronda
  const c = S.cfg;
  const tarjetas = mesas.map((t, i) => {
    const filas = t.seats.map((id, k) => {
      const p = P[id] || { name: "?" }, d = p.deck || {};
      const [set, mazo] = (d.k || "").split("|");
      const sub = liga.startsWith("b3") ? "" : (mazo ? `${E(mazo)} · ${E(set)}` : "");
      return `<li><span class="n">•</span><div class="who"><b>${E(p.name)}</b>
        <span class="cmd">${pips(coloresDe(d))}${E(d.c || "Sin comandante")}</span>${sub ? `<span class="deck">${sub}</span>` : ""}</div>
        <span class="pts">${pts[id] || 0}<small>pts</small></span></li>`;
    }).join("");
    return `<section class="mesa"><h2>Mesa ${desde + i + 1}<span>${t.seats.length} jugadores</span></h2><ol>${filas}</ol></section>`;
  }).join("");
  const rango = total > 1 ? `Mesas ${desde + 1}–${desde + mesas.length}` : "Mesas";
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&family=Oswald:wght@400;500;600&family=Open+Sans:wght@400;600&display=swap">
<style>${MANA_CSS}
*{box-sizing:border-box}body{margin:0;background:#0b0909;color:#f4ecea;font-family:"Open Sans",Arial,sans-serif;width:1080px}
.wrap{padding:48px 44px 40px;background:radial-gradient(120% 40% at 50% 0%,rgba(226,71,44,.22),transparent 70%)}
header{display:flex;align-items:center;gap:22px;margin-bottom:26px}header img{width:104px;height:104px}
.eb{font-family:Oswald,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#b9aaa6;font-size:20px}
h1{margin:4px 0 0;font-family:Lato,sans-serif;font-weight:900;font-size:44px;text-transform:uppercase}h1 em{font-style:normal;color:#e2472c}
.ronda{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:22px 28px;border-radius:20px;background:#e2472c;margin-bottom:26px}
.ronda b{font-family:Lato,sans-serif;font-weight:900;font-size:${total > 1 ? 42 : 50}px;white-space:nowrap;text-transform:uppercase;line-height:1.05}
.ronda span{font-family:Oswald,sans-serif;font-size:25px;letter-spacing:.1em;text-transform:uppercase;text-align:right;line-height:1.3}
.mesa{background:#151111;border:1px solid #2c2322;border-radius:20px;padding:22px 24px 14px;margin-bottom:22px}
.mesa h2{margin:0 0 12px;display:flex;justify-content:space-between;align-items:baseline;font-family:Oswald,sans-serif;font-weight:600;font-size:40px;letter-spacing:.08em;text-transform:uppercase;color:#e9b44c}
.mesa h2 span{font-size:20px;color:#b9aaa6;letter-spacing:.14em;font-weight:400}
ol{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:44px 1fr auto;gap:16px;align-items:center;padding:14px 0;border-top:1px solid #2c2322}
.n{font-family:Oswald,sans-serif;font-size:28px;color:#8d7f7b;text-align:center}
.who{display:flex;flex-direction:column;gap:4px;min-width:0}.who b{font-family:Lato,sans-serif;font-size:36px;font-weight:900;overflow-wrap:anywhere}
.cmd{font-size:25px;color:#e7dcd9;display:flex;align-items:center}.deck{font-size:21px;color:#9d8f8b}
.ci{display:inline-flex;flex:none;gap:3px;margin-right:10px}.ci i{width:26px;height:26px;border-radius:50%;background-size:contain;background-position:center;background-repeat:no-repeat;box-shadow:0 0 0 1px rgba(0,0,0,.4)}
.pts{font-family:Lato,sans-serif;font-weight:900;font-size:40px;text-align:right;line-height:1}.pts small{display:block;font-size:17px;font-weight:400;color:#9d8f8b;letter-spacing:.1em;text-transform:uppercase}
footer{text-align:center;font-family:Oswald,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8d7f7b;font-size:20px;margin-top:8px}
</style></head><body><div class="wrap">
<header><img src="data:image/png;base64,${LOGO}"><div><div class="eb">${E(NOMBRE_LIGA[liga] || "Liga")} · Cafetería El Desafío</div><h1>Liga Commander <em>El Desafío</em></h1></div></header>
<div class="ronda"><b>Ronda ${ri + 1} · ${rango}</b><span>${E(fechaLarga(S.fecha))}${S.fecha ? "<br>" : ""}${c.min} min · ${E(SISTEMA[c.pairing || "suizo"] || "")}</span></div>
${tarjetas}<footer>Busca tu nombre y anda a tu mesa</footer></div></body></html>`;
}

// Devuelve [{png (Buffer), nombre}] con las mesas de la ronda ri, 4 mesas por imagen
async function imagenesMesas(browser, S, liga, ri) {
  const r = S.rounds[ri]; if (!r || !r.tables || !r.tables.length) return [];
  await cargarColores(S.players.flatMap(p => partes(p.deck && p.deck.c)));
  const total = Math.ceil(r.tables.length / MESAS_POR_IMAGEN), out = [];
  for (let i = 0; i < total; i++) {
    const desde = i * MESAS_POR_IMAGEN;
    const html = htmlMesas(S, liga, ri, r.tables.slice(desde, desde + MESAS_POR_IMAGEN), desde, i + 1, total);
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1080, height: 800, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "networkidle0", timeout: 20000 }).catch(() => {});
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const png = await page.screenshot({ fullPage: true, type: "png" });
      out.push({ png: Buffer.from(png), nombre: `ronda${ri + 1}-mesas${total > 1 ? "-" + (i + 1) : ""}.png` });
    } finally { await page.close(); }
  }
  return out;
}

module.exports = { imagenesMesas, htmlMesas };
