// Arma los mensajes de WhatsApp a partir del estado de la liga.
// Compara con lo que ya se anunció (memoria) para no repetir mensajes.

const WARN_LIMIT = 2, WARN_PEN = 2;
const NOMBRE_LIGA = { precon: "Liga Precon", b3: "Liga Bracket 3" };

const kills = (r, p) => (r.k && r.k[p]) || 0;
const vivo = (r, p) => (r.a || []).includes(p);
const joven = (r, p) => (r.j || []).includes(p);
const bruto = (r, p) => (r.b && r.b[p]) || 0;
const dq = (r, p) => (r.x || []).includes(p);
const gana = (r, p) => r.w === p;

function puntos(r, p, c) {
  if (!r || dq(r, p)) return 0;
  let x = gana(r, p) ? c.win : kills(r, p) * c.kill + (vivo(r, p) ? c.surv : 0);
  if (joven(r, p)) x += c.joven || 0;
  return Math.min(c.cap, x) - bruto(r, p) * (c.bruto || 0);
}

// Misma regla que la página: puntos, luego kills, luego Buchholz
function standing(S, hasta) {
  hasta = hasta == null ? S.rounds.length : hasta;
  const c = S.cfg, rec = {};
  S.players.forEach((p, i) => rec[p.id] = { id: p.id, name: p.name, pts: 0, w: 0, k: 0, pj: 0, opps: [], ord: i });
  S.rounds.slice(0, hasta).forEach(r => r.tables.forEach(t => {
    if (!t.result) return;
    t.seats.forEach(id => {
      const x = rec[id]; if (!x) return;
      x.pj++; x.pts += puntos(t.result, id, c); x.k += kills(t.result, id);
      if (gana(t.result, id)) x.w++;
      t.seats.forEach(o => { if (o !== id) x.opps.push(o); });
    });
  }));
  const list = Object.values(rec);
  const W = S.warnings || {};
  list.forEach(x => { if ((W[x.id] || 0) >= WARN_LIMIT) x.pts -= WARN_PEN; });
  list.forEach(x => { x.buch = x.opps.reduce((s, o) => s + (rec[o] ? rec[o].pts : 0), 0); });
  list.sort((a, b) => b.pts - a.pts || b.k - a.k || b.buch - a.buch || a.ord - b.ord);
  return list;
}

const sigRes = r => JSON.stringify([r.w || null, r.k || {}, (r.a || []).slice().sort(), r.j || [], r.b || {}, r.x || []]);
const completa = r => !!r && r.tables.length > 0 && r.tables.every(t => t.result);
const medalla = i => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;

function textoMesa(S, ri, ti, t, correccion) {
  const nm = id => (S.players.find(p => p.id === id) || {}).name || "?";
  const r = t.result, c = S.cfg;
  const lineas = [`${correccion ? "✏️ *Corrección* · " : "✅ "}*Mesa ${ti + 1} · Ronda ${ri + 1}*`];
  lineas.push(r.w ? `🏆 Gana *${nm(r.w)}*` : `⏱️ Sin ganador (${(r.a || []).length} vivos al tiempo)`);
  t.seats.slice().sort((a, b) => puntos(r, b, c) - puntos(r, a, c)).forEach(id => {
    const det = [];
    if (kills(r, id)) det.push(`${kills(r, id)} kill${kills(r, id) > 1 ? "s" : ""}`);
    if (!gana(r, id) && vivo(r, id)) det.push("sobrevivió");
    if (joven(r, id) && c.joven) det.push("muy joven para morir");
    if (bruto(r, id) && c.bruto) det.push(`demasiado bruto −${bruto(r, id) * c.bruto}`);
    if (dq(r, id)) det.push("no es tu lugar");
    const p = puntos(r, id, c);
    lineas.push(`• ${nm(id)}: ${p > 0 ? "+" + p : p} pts${det.length ? " (" + det.join(", ") + ")" : ""}`);
  });
  return lineas.join("\n");
}

function textoStanding(S, titulo, top) {
  const st = standing(S);
  const n = top ? Math.min(top, st.length) : st.length;
  const filas = st.slice(0, n).map((x, i) => `${medalla(i)} ${x.name} — *${x.pts}* pts · ${x.k} K`);
  return [`📊 *${titulo}*`, ...filas, st.length > n ? `_…y ${st.length - n} más. Revisa tu posición en el portal._` : ""].filter(Boolean).join("\n");
}

function textoCierre(S, liga, top, portal) {
  const st = standing(S);
  const lineas = [`🏁 *${NOMBRE_LIGA[liga] || "Liga"} · fecha cerrada*${S.fecha ? " (" + S.fecha.split("-").reverse().join("/") + ")" : ""}`, ""];
  st.slice(0, 3).forEach((x, i) => lineas.push(`${medalla(i)} *${x.name}* — ${x.pts} pts · ${x.w} V · ${x.k} K`));
  const killer = st.slice().sort((a, b) => b.k - a.k)[0];
  if (killer && killer.k > 0) lineas.push("", `🔪 Más kills del día: *${killer.name}* (${killer.k})`);
  const cmdK = {};
  S.rounds.forEach(r => r.tables.forEach(t => t.result && t.seats.forEach(id => {
    const p = S.players.find(x => x.id === id), c = p && p.deck && p.deck.c;
    if (c) cmdK[c] = (cmdK[c] || 0) + kills(t.result, id);
  })));
  const topCmd = Object.entries(cmdK).sort((a, b) => b[1] - a[1])[0];
  if (topCmd && topCmd[1] > 0) lineas.push(`🐉 Comandante más letal: *${topCmd[0]}* (${topCmd[1]} kills)`);
  lineas.push("", textoStanding(S, "Standing final", top));
  if (portal) lineas.push("", `Tus estadísticas: ${portal}`);
  return lineas.join("\n");
}

// Devuelve {mensajes, memoria}. Con silencioso=true solo registra lo que ya existe (al arrancar el bot a mitad de fecha).
function anunciar(liga, S, cfgBot, memoria, silencioso) {
  const top = cfgBot.top, portal = cfgBot.portal ? cfgBot.portal + "?liga=" + liga : "";
  const msgs = [];
  if (!S || !S.players) return { mensajes: msgs, memoria };
  const clave = S.fecha || "sin-fecha";
  let m = memoria && memoria.fecha === clave ? memoria : { fecha: clave, hecho: {}, mesas: {} };
  const una = (k, fn) => { if (m.hecho[k]) return; m.hecho[k] = 1; if (!silencioso) { const t = fn(); if (t) msgs.push(t); } };

  if (S.phase === "inscripcion") {
    una("insc", () => `📝 *${NOMBRE_LIGA[liga]}: inscripciones abiertas*${S.fecha ? " para el " + S.fecha.split("-").reverse().join("/") : ""}.${portal ? "\nInscríbete en " + portal : ""}`);
    return { mensajes: msgs, memoria: m };
  }
  const nm = id => (S.players.find(p => p.id === id) || {}).name || "?";
  S.rounds.forEach((r, ri) => {
    if (!r || !r.tables) return;
    // Las mesas se publican al lanzar la ronda (Iniciar ronda), así salen ya con los cambios de último minuto.
    // Respaldo: si la ronda ya tiene resultados o ya se pasó a otra, se publican igual.
    const t = S.timer || {}, lanzada = ri === S.cur ? (t.running || (t.left != null && t.left < S.cfg.min * 60000)) : true;
    if (lanzada || r.tables.some(x => x.result))
      una(`r${ri}:armada`, () => [`⚔️ *${NOMBRE_LIGA[liga]} · ¡Comienza la ronda ${ri + 1} de ${S.cfg.rounds}!*`, `⏱️ ${S.cfg.min} minutos`, "", ...r.tables.map((t, ti) => `*Mesa ${ti + 1}:* ${t.seats.map(nm).join(", ")}`), "", "¡Suerte a todos!"].join("\n"));
    r.tables.forEach((t, ti) => {
      const k = `r${ri}t${ti}`, prev = m.mesas[k];
      if (!t.result) return;   // mesa reabierta: se espera el nuevo resultado
      const sg = sigRes(t.result);
      if (prev === sg) return;
      m.mesas[k] = sg;
      if (!silencioso) msgs.push(textoMesa(S, ri, ti, t, !!m.hecho["fin" + k]));
      m.hecho["fin" + k] = 1;
    });
    if (completa(r)) {
      const ultima = ri === S.cfg.rounds - 1;
      if (!ultima) una(`r${ri}:standing`, () => textoStanding({ ...S, rounds: S.rounds.slice(0, ri + 1) }, `Standing tras la ronda ${ri + 1}`, top));
    }
  });
  if (S.closedSig && S.archivedId) {
    const k = "cierre:" + S.closedSig.length + ":" + S.closedSig.slice(-40);
    una(k, () => textoCierre(S, liga, top, portal));
  }
  return { mensajes: msgs, memoria: m };
}

module.exports = { anunciar, standing, puntos };
