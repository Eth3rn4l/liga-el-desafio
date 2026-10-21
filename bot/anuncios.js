// Arma los mensajes de WhatsApp a partir del estado de la liga.
// Compara con lo que ya se anunció (memoria) para no repetir mensajes.

const WARN_LIMIT = 2, WARN_PEN = 1;   // cada 2 warnings en una fecha = −1 punto (igual que la página)
const NOMBRE_LIGA = { precon: "Liga Precon", b3: "Liga Bracket 3", precon_test: "🧪 Liga Precon (testeo)", b3_test: "🧪 Liga Bracket 3 (testeo)" };

const kills = (r, p) => (r.k && r.k[p]) || 0;
const vivo = (r, p) => (r.a || []).includes(p);
const joven = (r, p) => (r.j || []).includes(p);
const bruto = (r, p) => (r.b && r.b[p]) || 0;
const dq = (r, p) => (r.x || []).includes(p);
const gana = (r, p) => r.w === p;
const ckills = (r, p) => (r.c && r.c[p]) || 0;   // kills de comandante: +1 cada una, con tope propio (igual que la página)

function puntos(r, p, c) {
  if (!r || dq(r, p)) return 0;
  // Igual que la página y el Excel: ganar o empatar + kills + kills de comandante (con su tope), y tope por mesa
  let x = (gana(r, p) ? c.win : vivo(r, p) ? c.surv : 0) + kills(r, p) * c.kill + Math.min(c.cmdCap == null ? 3 : c.cmdCap, ckills(r, p) * (c.cmdKill == null ? 1 : c.cmdKill));
  if (joven(r, p)) x += c.joven || 0;
  return Math.min(c.cap, x) - bruto(r, p) * (c.bruto || 0);
}

// Misma regla que la página (copia del Excel): Buchholz desde la ronda 2 y orden por intercambio sobre la lista desordenada de la fecha
function statsHasta(S, hasta) {
  const c = S.cfg, rec = {};
  S.players.forEach((p, i) => rec[p.id] = { id: p.id, name: p.name, pts: 0, w: 0, k: 0, pj: 0, opps: [], ord: i });
  S.rounds.slice(0, hasta).forEach(r => r.tables.forEach(t => {
    if (!t.result) return;
    t.seats.forEach(id => {
      const x = rec[id]; if (!x) return;
      x.pj++; x.pts += puntos(t.result, id, c); x.k += kills(t.result, id) + ckills(t.result, id);
      if (gana(t.result, id)) x.w++;
      t.seats.forEach(o => { if (o !== id) x.opps.push(o); });
    });
  }));
  const list = Object.values(rec);
  const W = S.warnings || {};
  const JZ = S.juez || {};   // warnings y restas que puso el juez
  list.forEach(x => { x.pts -= Math.floor(((W[x.id] || 0) + ((JZ[x.id] && JZ[x.id].w) | 0)) / WARN_LIMIT) * WARN_PEN; });
  const AJ = S.ajustes || {};
  list.forEach(x => { if (AJ[x.id]) x.pts += (+AJ[x.id].pts || 0); if (JZ[x.id]) x.pts += Math.min(0, JZ[x.id].pts | 0); });   // ajuste manual del organizador y del juez
  list.forEach(x => { x.buch = hasta > 1 ? x.opps.reduce((s, o) => s + (rec[o] ? rec[o].pts : 0), 0) : 0; });
  return rec;
}
function standing(S, hasta) {
  hasta = hasta == null ? S.rounds.length : hasta;
  const set = new Set(S.players.map(p => p.id));
  let order = (S.orden || []).filter(id => set.has(id)); const en = new Set(order);
  S.players.forEach(p => { if (!en.has(p.id)) order.push(p.id); });
  for (let r = 1; r <= hasta; r++) {
    const R = statsHasta(S, r), L = order.slice();
    for (let i = 0; i < L.length - 1; i++) for (let j = i + 1; j < L.length; j++) {
      const a = R[L[i]], b = R[L[j]];
      if (b.pts > a.pts || (b.pts === a.pts && b.k > a.k) || (b.pts === a.pts && b.k === a.k && b.buch > a.buch)) { const t = L[i]; L[i] = L[j]; L[j] = t; }
    }
    order = L;
  }
  const R = statsHasta(S, hasta);
  return order.map(id => R[id]);
}

const sigRes = r => JSON.stringify([r.w || null, r.k || {}, (r.a || []).slice().sort(), r.j || [], r.b || {}, r.x || [], r.c || {}]);
const completa = r => !!r && r.tables.length > 0 && r.tables.every(t => t.result);
const medalla = i => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;

function textoMesa(S, ri, ti, t, correccion) {
  const nm = id => (S.players.find(p => p.id === id) || {}).name || "?";
  const r = t.result, c = S.cfg;
  const lineas = [`*MESA ${ti + 1}* · Ronda ${ri + 1}${correccion ? " (corrección)" : ""}`];
  lineas.push(r.w ? `Ganador: *${nm(r.w)}* 🏆` : `Sin ganador (${(r.a || []).length} vivos al tiempo)`, "");
  t.seats.slice().sort((a, b) => puntos(r, b, c) - puntos(r, a, c)).forEach(id => {
    const det = [];
    if (kills(r, id)) det.push(`${kills(r, id)} kill${kills(r, id) > 1 ? "s" : ""}`);
    if (!gana(r, id) && vivo(r, id)) det.push("sobrevivió");
    if (joven(r, id) && c.joven) det.push("muy joven para morir");
    if (bruto(r, id) && c.bruto) det.push(`demasiado bruto −${bruto(r, id) * c.bruto}`);
    if (dq(r, id)) det.push("no es tu lugar");
    const p = puntos(r, id, c);
    lineas.push(`- ${nm(id)}: ${p > 0 ? "+" + p : p} pts${det.length ? " (" + det.join(", ") + ")" : ""}`);
  });
  return lineas.join("\n");
}

function textoStanding(S, titulo, top) {
  const st = standing(S);
  const n = top ? Math.min(top, st.length) : st.length;
  const filas = st.slice(0, n).map((x, i) => `${medalla(i)} ${x.name} — *${x.pts}* pts · ${x.k} K`);
  return [`*${titulo}*`, ...filas, st.length > n ? `_…y ${st.length - n} más. Revisa tu posición en el portal._` : ""].filter(Boolean).join("\n");
}

function textoCierre(S, liga, top, portal) {
  const st = standing(S);
  const lineas = [`*${NOMBRE_LIGA[liga] || "Liga"} · Fecha cerrada*${S.fecha ? " (" + S.fecha.split("-").reverse().join("/") + ")" : ""}`, ""];
  st.slice(0, 3).forEach((x, i) => lineas.push(`${medalla(i)} *${x.name}* — ${x.pts} pts · ${x.w} V · ${x.k} K`));
  const killer = st.slice().sort((a, b) => b.k - a.k)[0];
  if (killer && killer.k > 0) lineas.push("", `Más kills del día: *${killer.name}* (${killer.k})`);
  const cmdK = {};
  S.rounds.forEach(r => r.tables.forEach(t => t.result && t.seats.forEach(id => {
    const p = S.players.find(x => x.id === id), c = p && p.deck && p.deck.c;
    if (c) cmdK[c] = (cmdK[c] || 0) + kills(t.result, id);
  })));
  const topCmd = Object.entries(cmdK).sort((a, b) => b[1] - a[1])[0];
  if (topCmd && topCmd[1] > 0) lineas.push(`Comandante más letal: *${topCmd[0]}* (${topCmd[1]} kills)`);
  // Solo el podio: el standing completo queda en la página (no se publica para no generar mal ambiente)
  if (portal) lineas.push("", `Standing completo y estadísticas: ${portal}`);
  return lineas.join("\n");
}

const urlPortal = (liga, base) => base ? base + "?liga=" + liga.replace("_test", "") + (liga.endsWith("_test") ? "&test=1" : "") : "";
// Mensaje para inscribirse en la fecha (se manda solo al abrir inscripciones, o a pedido al iniciar el bot)
function textoInscripcion(liga, S, base) {
  const portal = urlPortal(liga, base);
  return `*${NOMBRE_LIGA[liga]}: inscripciones abiertas*${S && S.fecha ? " para el " + S.fecha.split("-").reverse().join("/") : ""}.${portal ? "\nInscríbete en " + portal : ""}`;
}

// Devuelve {mensajes, memoria}. Con silencioso=true solo registra lo que ya existe (al arrancar el bot a mitad de fecha).
function anunciar(liga, S, cfgBot, memoria, silencioso) {
  const top = cfgBot.top, portal = urlPortal(liga, cfgBot.portal);
  const msgs = [];
  if (!S || !S.players) return { mensajes: msgs, memoria };
  const clave = S.fecha || "sin-fecha";
  let m = memoria && memoria.fecha === clave ? memoria : { fecha: clave, hecho: {}, mesas: {} };
  const una = (k, fn) => { if (m.hecho[k]) return; m.hecho[k] = 1; if (!silencioso) { const t = fn(); if (t) msgs.push(t); } };

  if (S.phase === "inscripcion") {
    una("insc", () => textoInscripcion(liga, S, cfgBot.portal));
    return { mensajes: msgs, memoria: m };
  }
  const nm = id => (S.players.find(p => p.id === id) || {}).name || "?";
  S.rounds.forEach((r, ri) => {
    if (!r || !r.tables) return;
    // Las mesas se publican al lanzar la ronda (Iniciar ronda), así salen ya con los cambios de último minuto.
    // Respaldo: si la ronda ya tiene resultados o ya se pasó a otra, se publican igual.
    const t = S.timer || {}, lanzada = ri === S.cur ? (t.running || (t.left != null && t.left < S.cfg.min * 60000)) : true;
    if (lanzada || r.tables.some(x => x.result))
      // Se publica como imágenes de las mesas (4 por imagen); el texto va como descripción y sirve de respaldo
      una(`r${ri}:armada`, () => ({
        tipo: "mesas", ri,
        texto: [`⚔️ *${NOMBRE_LIGA[liga]} · Comienza la ronda ${ri + 1} de ${S.cfg.rounds}*`, `${S.cfg.min} minutos · ${r.tables.length} ${r.tables.length === 1 ? "mesa" : "mesas"}`, "Busca tu nombre y anda a tu mesa. ¡Suerte a todos!"].join("\n"),
        // En texto: un solo mensaje, cada mesa en negrita y los jugadores con viñetas
        respaldo: [`⚔️ *${NOMBRE_LIGA[liga]} · Comienza la ronda ${ri + 1} de ${S.cfg.rounds}*`, `${S.cfg.min} minutos · ${r.tables.length} ${r.tables.length === 1 ? "mesa" : "mesas"}`,
          ...r.tables.flatMap((t, ti) => ["", `*MESA ${ti + 1}*`, ...t.seats.map(id => `• ${nm(id)}`)]), "", "¡Suerte a todos!"].join("\n")
      }));
    r.tables.forEach((t, ti) => {
      const k = `r${ri}t${ti}`, prev = m.mesas[k];
      if (!t.result) return;   // mesa reabierta: se espera el nuevo resultado
      const sg = sigRes(t.result);
      if (prev === sg) return;
      m.mesas[k] = sg;
      // El resultado de cada mesa ya no se publica en el grupo (queda en la página)
      m.hecho["fin" + k] = 1;
    });
    if (completa(r)) {
      const ultima = ri === S.cfg.rounds - 1;
      // El standing entre rondas ya no se publica (puede generar mal ambiente); queda en la página
      void ultima;
    }
  });
  if (S.closedSig && S.archivedId) {
    const k = "cierre:" + S.closedSig.length + ":" + S.closedSig.slice(-40);
    una(k, () => textoCierre(S, liga, top, portal));
  }
  return { mensajes: msgs, memoria: m };
}

module.exports = { anunciar, standing, puntos, textoInscripcion };
