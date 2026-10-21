// Bot de WhatsApp de la Liga Commander El Desafío.
// Lee la liga en vivo desde Supabase (solo lectura, con la clave pública) y publica en los grupos:
// mesas de cada ronda, resultado de cada mesa al cerrarse, standing tras cada ronda y el cierre de la fecha.
//
//   node bot.js            → funciona normal (la primera vez muestra un código QR para vincular WhatsApp)
//   node bot.js --grupos   → muestra los nombres exactos de tus grupos para copiarlos en config.json
//   node bot.js --prueba   → manda un mensaje de prueba a los grupos configurados
//   node bot.js --simular  → no usa WhatsApp: muestra en pantalla lo que publicaría y guarda las imágenes en la carpeta "salida"
//   node bot.js --simular --estado archivo.json → igual, pero con un estado de liga guardado en un archivo (para pruebas)

const fs = require("fs");
const path = require("path");
const { anunciar, textoInscripcion, msgMesas, textoResultados, textoStanding, textoCierre, urlPortal, NOMBRE_LIGA } = require("./anuncios");
const { imagenesMesas } = require("./imagenes");

const DIR = __dirname;
const CFG_FILE = path.join(DIR, "config.json");
const MEM_FILE = path.join(DIR, "memoria.json");
if (!fs.existsSync(CFG_FILE)) { console.error("Falta config.json: copia config.ejemplo.json como config.json y complétalo."); process.exit(1); }
const CFG = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
const ARG = process.argv.slice(2);
// Navegador para WhatsApp Web: el de config.json, el que descarga puppeteer o, si no está, el Chrome o Edge instalado en el PC
function buscarNavegador() {
  const existe = f => { try { return !!f && fs.existsSync(f); } catch (e) { return false; } };
  if (existe(CFG.chromePath)) return CFG.chromePath;
  try { const f = require("puppeteer").executablePath(); if (existe(f)) return undefined; } catch (e) {}
  const pf = process.env["ProgramFiles"] || "C:\\Program Files", pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", la = process.env.LOCALAPPDATA || "";
  const cands = [
    path.join(pf, "Google", "Chrome", "Application", "chrome.exe"), path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(la, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"), path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ];
  const f = cands.find(existe);
  if (f) console.log("Usando el navegador instalado:", f);
  return f;
}
const NAVEGADOR = buscarNavegador();
const SIMULAR = ARG.includes("--simular");
// Liga que maneja el bot en esta sesión: --liga precon | b3 | ambas (si no se indica, se pregunta al iniciar)
const argVal = k => (i => i >= 0 ? (ARG[i + 1] || "") : null)(ARG.indexOf(k));
let LIGA_SEL = null, INVITAR = ARG.includes("--invitar");
const SEL = { precon: ["precon", "precon_test"], b3: ["b3", "b3_test"], ambas: ["precon", "b3", "precon_test", "b3_test"] };
const usaLiga = liga => !LIGA_SEL || LIGA_SEL.includes(liga);
function pregunta(txt) {
  return new Promise(res => { const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout }); rl.question(txt, r => { rl.close(); res(String(r || "").trim()); }); });
}
async function elegirLiga() {
  let v = (argVal("--liga") || "").toLowerCase();
  if (!SEL[v]) v = "ambas";
  LIGA_SEL = SEL[v] || SEL.ambas;
  console.log(`${hora()} Liga: ${v === "precon" ? "Precon" : v === "b3" ? "Bracket 3" : "las dos"}${INVITAR ? " · se manda el mensaje de inscripción" : ""}`);
}
const LIGAS = { precon: { estado: "estado", cal: "calendario" }, b3: { estado: "estado_b3", cal: "calendario_b3" },
  // Ligas de testeo del desarrollador: solo se leen si tienen grupo en config.json ("precon_test" / "b3_test")
  precon_test: { estado: "estado_test", cal: "calendario_test" }, b3_test: { estado: "estado_b3_test", cal: "calendario_b3_test" } };

const leerMem = () => { try { return JSON.parse(fs.readFileSync(MEM_FILE, "utf8")); } catch (e) { return {}; } };
// Solo se escribe el archivo cuando algo cambió (antes se reescribía cada 15 s)
let memGuardada = null;
const guardarMem = m => { const t = JSON.stringify(m, null, 1); if (t === memGuardada) return; memGuardada = t; try { fs.writeFileSync(MEM_FILE, t); } catch (e) { console.error(`${hora()} no se pudo guardar memoria.json:`, e.message); } };
const hora = () => new Date().toLocaleTimeString("es-CL");
const espera = ms => new Promise(r => setTimeout(r, ms));

const ESTADO_ARCH = (i => i >= 0 ? ARG[i + 1] : null)(ARG.indexOf("--estado"));
async function leerLiga() {
  if (ESTADO_ARCH) return { estado: JSON.parse(fs.readFileSync(ESTADO_ARCH, "utf8")) };
  // Solo las ligas que maneja esta sesión (las de testeo, solo si tienen chat configurado)
  const ids = Object.entries(LIGAS).filter(([l]) => usaLiga(l) && (!l.endsWith("_test") || destinos[l] || SIMULAR)).flatMap(([, l]) => [l.estado, l.cal]).join(",");
  const url = `${CFG.supabaseUrl}/rest/v1/liga?select=id,data&id=in.(${ids})`;
  const r = await fetch(url, { headers: { apikey: CFG.supabaseKey, Accept: "application/json" } });
  if (!r.ok) throw new Error("Supabase respondió " + r.status + ": " + (await r.text()).slice(0, 200));
  const filas = await r.json(), out = {};
  filas.forEach(f => out[f.id] = f.data);
  return out;
}

// ---------- Envío (cola con pausa entre mensajes) ----------
let client = null;
const destinos = {};          // liga → id del grupo
const cola = [];
let enviando = false;
let navegador = null;          // Chrome para dibujar las imágenes (el de WhatsApp, o uno propio al simular)
async function obtenerNavegador() {
  if (!SIMULAR && client && client.pupBrowser) return client.pupBrowser;
  if (!navegador) navegador = await require("puppeteer").launch({ headless: true, executablePath: NAVEGADOR, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  return navegador;
}
// Envío robusto: sin "marcar como leído" (falla en algunas versiones de WhatsApp Web) y, si aun así falla, por el chat directamente
async function enviar(id, contenido, opciones = {}) {
  const op = Object.assign({ sendSeen: false }, opciones);
  try { return await client.sendMessage(id, contenido, op); }
  catch (e) {
    console.log(`${hora()} reintentando el envío por otra vía (${String(e.message || e).split("\n")[0].slice(0, 80)})`);
    const chat = await client.getChatById(id);
    return await chat.sendMessage(contenido, op);
  }
}
// Destino del mensaje: el grupo elegido en el menú, o el grupo configurado de la liga
let destinoManual = null;
const dest = liga => destinoManual || destinos[liga];
async function enviarMesas(liga, m, S) {
  // config.json → "mesasComo": "texto" manda un mensaje por mesa en vez de imágenes
  if (CFG.mesasComo === "texto") return enviarTexto(liga, m.respaldo);
  let imgs = [];
  try { imgs = await imagenesMesas(await obtenerNavegador(), S, liga, m.ri); }
  catch (e) { console.error(`${hora()} no se pudieron dibujar las mesas, se envían como texto:`, e.message); }
  if (!imgs.length) return enviarTexto(liga, m.respaldo);
  if (SIMULAR) {
    const dir = path.join(DIR, "salida"); fs.mkdirSync(dir, { recursive: true });
    imgs.forEach(x => fs.writeFileSync(path.join(dir, `${liga}-${x.nombre}`), x.png));
    console.log(`\n----- [${liga}] ${hora()} · ${imgs.length} ${imgs.length === 1 ? "imagen" : "imágenes"} en la carpeta salida -----\n${m.texto}\n`);
    return;
  }
  const { MessageMedia } = require("whatsapp-web.js");
  try {
    for (let i = 0; i < imgs.length; i++) {
      const media = new MessageMedia("image/png", imgs[i].png.toString("base64"), imgs[i].nombre);
      await enviar(dest(liga), media, i === 0 ? { caption: m.texto } : {});
      await espera(1200);
    }
  } catch (e) {
    // Si la imagen no se puede mandar, las mesas salen igual como texto
    console.error(`${hora()} no se pudo mandar la imagen de las mesas, se envían como texto:`, String(e.message || e).split("\n")[0]);
    return enviarTexto(liga, m.respaldo);
  }
  console.log(`${hora()} enviado a ${liga}: ${imgs.length} ${imgs.length === 1 ? "imagen" : "imágenes"} de la ronda ${m.ri + 1}`);
}
async function enviarTexto(liga, texto) {
  // Varios mensajes (por ejemplo, una mesa por mensaje) se mandan de a uno con una pausa
  if (Array.isArray(texto)){ for (let i = 0; i < texto.length; i++){ await enviarTexto(liga, texto[i]); if (i < texto.length - 1) await espera(SIMULAR ? 0 : 1500); } return; }
  if (SIMULAR) console.log(`\n----- [${liga}] ${hora()} -----\n${texto}\n`);
  else { await enviar(dest(liga), texto); console.log(`${hora()} enviado a ${liga}: ${texto.split("\n")[0]}`); }
}
async function enviarImagen(liga, msg) {
  if (!fs.existsSync(msg.archivo)) { console.error(`${hora()} no encontré la imagen ${msg.archivo}`); return; }
  if (SIMULAR) { console.log(`\n----- [${liga}] ${hora()} · imagen ${path.basename(msg.archivo)} -----${msg.caption ? "\n" + msg.caption : ""}\n`); return; }
  const { MessageMedia } = require("whatsapp-web.js");
  await enviar(dest(liga), MessageMedia.fromFilePath(msg.archivo), msg.caption ? { caption: msg.caption } : {});
  console.log(`${hora()} enviado a ${liga}: imagen ${path.basename(msg.archivo)}`);
}
async function procesarCola() {
  if (enviando) return; enviando = true;
  while (cola.length) {
    const { liga, msg, S, to } = cola[0];
    destinoManual = to || null;
    try {
      if (typeof msg === "string") await enviarTexto(liga, msg);
      else if (msg.tipo === "mesas") await enviarMesas(liga, msg, S);
      else if (msg.tipo === "imagen") await enviarImagen(liga, msg);
      cola.shift(); destinoManual = null;
      await espera(SIMULAR ? 50 : 2500);
    } catch (e) {
      // Un mensaje que falla una y otra vez no puede trabar los siguientes: después de 5 intentos se descarta
      const it = cola[0]; it.intentos = (it.intentos || 0) + 1;
      if (it.intentos >= 5) { cola.shift(); destinoManual = null; console.error(`${hora()} se descarta un mensaje para ${liga} después de 5 intentos:`, String(e.message || e).split("\n")[0]); continue; }
      console.error(`${hora()} no se pudo enviar (intento ${it.intentos} de 5, se reintenta en 30 s):`, String(e.message || e).split("\n")[0]);
      await espera(30000);
    }
  }
  enviando = false;
}

// ---------- Revisión periódica ----------
let mem = leerMem(), primera = true;
async function revisar() {
  let datos;
  try { datos = await leerLiga(); } catch (e) { console.error(`${hora()} no se pudo leer la liga:`, e.message); return; }
  for (const [liga, ids] of Object.entries(LIGAS)) {
    if (!SIMULAR && !destinos[liga]) continue;          // liga sin grupo configurado
    if (!usaLiga(liga)) continue;                       // liga no elegida al iniciar
    const S = datos[ids.estado], cal = datos[ids.cal] || {};
    if (!S) continue;
    const top = cal.topPublico == null ? (CFG.top || 10) : cal.topPublico;
    // Al arrancar, lo que ya pasó se registra sin publicar (para no repetir mensajes)
    const silencioso = primera && !mem[liga] && !ARG.includes("--anunciar-todo");
    const { mensajes, memoria } = anunciar(liga, S, { top, portal: CFG.portal }, mem[liga], silencioso);
    mem[liga] = memoria;
    // Mensaje de inscripción a pedido (al iniciar el bot): solo si la fecha tiene las inscripciones abiertas
    if (primera && INVITAR && !liga.endsWith("_test")) {
      if (S.phase === "inscripcion") { if (!mensajes.some(t => typeof t === "string" && /inscripciones abiertas/.test(t))) cola.push({ liga, msg: textoInscripcion(liga, S, CFG.portal), S }); }
      else console.log(`${hora()} ${liga}: la fecha ya empezó (no está en inscripciones), no se manda el mensaje de inscripción.`);
    }
    if (pausado) mensajes.forEach(msg => console.log(`${hora()} [pausado] no se envió a ${liga}: ${typeof msg === "string" ? msg.split("\n")[0] : "mesas de la ronda " + (msg.ri + 1)}`));
    else mensajes.forEach(msg => cola.push({ liga, msg, S }));
  }
  primera = false;
  guardarMem(mem);
  procesarCola();
}

async function iniciar() {
  console.log(`${hora()} Bot listo. Revisando la liga cada ${CFG.cadaSegundos || 15} s.`);
  await revisar();
  setInterval(revisar, (CFG.cadaSegundos || 15) * 1000);
  iniciarMenu();
}

// ---------- Menú de comandos (se escribe el número en la ventana del bot) ----------
// Menú principal: se elige el grupo. Dentro del grupo: se elige qué mensaje mandar (0 = volver).
let pausado = false, gruposMenu = null;
const DIR_IMG = path.join(DIR, "imagenes-para-enviar");
// Opciones que se muestran → acción interna
const MENU_GRUPO = [
  ["1", "Mensaje para inscribirse", "3"],
  ["2", "Mesas de la ronda actual", "1"],
  ["3", "Standing", "5"],
  ["4", "Imágenes (Código de la mesa u otra)", "8"],
  ["0", "Volver", null]
];
// Pantalla limpia en cada menú: solo queda el menú y el último aviso
let aviso = "", nLog = 0;
const logOriginal = console.log; console.log = (...a) => { nLog++; logOriginal(...a); };
function limpiar() {
  if (process.stdout.isTTY) process.stdout.write("\x1Bc");
  if (aviso) { logOriginal(aviso); aviso = ""; }
}
const lineas = []; let esperandoLinea = null, stdinCerrado = false;
function leerLinea(txt) {
  if (txt) process.stdout.write(txt);
  if (lineas.length) return Promise.resolve(lineas.shift());
  if (stdinCerrado) return Promise.resolve(null);
  return new Promise(r => esperandoLinea = r);
}
const nombresDestino = {};   // liga → nombre del grupo o chat configurado
// Si la liga real y la de testeo usan el mismo chat, gana la real
const ligaDeGrupo = id => { const ls = Object.keys(destinos).filter(l => destinos[l] === id && usaLiga(l)); return ls.find(l => !l.endsWith("_test")) || ls[0] || null; };
const ligasConDatos = () => Object.keys(LIGAS).filter(l => usaLiga(l) && (!l.endsWith("_test") || destinos[l]));
// Grupos disponibles: en WhatsApp, todos los grupos donde está el bot (los de la liga primero)
async function cargarGruposMenu(forzar) {
  if (gruposMenu && !forzar) return gruposMenu;
  let gs;
  if (SIMULAR) gs = [{ id: "sim-otro", nombre: "Grupo de amigos (simulado)" }];
  else { const g = await listarGrupos(); gs = (g || []).map(c => ({ id: c.id._serialized, nombre: c.name || "(sin nombre)" })); }
  if (SIMULAR) Object.keys(LIGAS).forEach(l => { if (!destinos[l] && usaLiga(l)) { destinos[l] = "sim-" + l; nombresDestino[l] = l.endsWith("_test") ? "Chat de testeo (simulado)" : "Grupo " + NOMBRE_LIGA[l]; } });
  // Los grupos de la liga aparecen aunque WhatsApp no haya podido listar los chats
  Object.entries(destinos).forEach(([l, id]) => { if (!gs.some(g => g.id === id)) gs.push({ id, nombre: nombresDestino[l] || ("Grupo " + (NOMBRE_LIGA[l] || l)) }); });
  // Orden: grupos de la liga, luego los de testeo, luego el resto
  const peso = g => { const l = ligaDeGrupo(g.id); return l ? (l.endsWith("_test") ? 1 : 0) : 2; };
  gruposMenu = gs.sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre, "es"));
  return gruposMenu;
}
async function mostrarMenu(forzar) {
  const gs = await cargarGruposMenu(forzar);
  limpiar();
  console.log("\n============ MENÚ PRINCIPAL ============");
  console.log("  Elige el grupo:");
  gs.forEach((g, i) => { const l = ligaDeGrupo(g.id); console.log(`  ${i + 1}) ${g.nombre}${l ? (l.endsWith("_test") ? "  ★ TESTEO" : "  ★ " + NOMBRE_LIGA[l]) : ""}`); });
  if (!gs.length) console.log("  (no encontré grupos; escribe R para volver a buscar)");
  console.log("  ----------------------------------------");
  console.log(`  P) ${pausado ? "Reanudar" : "Pausar"} los mensajes automáticos`);
  if (pausado) console.log("  ⏸  Mensajes automáticos EN PAUSA");
  console.log("========================================");
}
async function leerDatos(liga) {
  let datos;
  try { datos = await leerLiga(); } catch (e) { console.error("No se pudo leer la liga:", e.message); return null; }
  const S = datos[LIGAS[liga].estado], cal = datos[LIGAS[liga].cal] || {};
  if (!S || !S.players) { console.log(`${NOMBRE_LIGA[liga]} todavía no tiene datos.`); return null; }
  const ri = Math.max(0, Math.min(S.cur | 0, (S.rounds || []).length - 1));
  const ronda = (S.rounds || [])[ri];
  return { S, cal, ri, ronda, hayMesas: !!(ronda && ronda.tables && ronda.tables.length), fecha: S.fecha ? S.fecha.split("-").reverse().join("/") : "sin fecha", top: cal.topPublico == null ? (CFG.top || 10) : cal.topPublico };
}
async function elegirLigaDatos(grupo) {
  const fija = ligaDeGrupo(grupo.id); if (fija) return fija;
  const ls = ligasConDatos();
  if (ls.length === 1) return ls[0];
  console.log("  ¿De qué liga son los datos?");
  ls.forEach((l, i) => console.log(`    ${i + 1}) ${NOMBRE_LIGA[l] || l}`));
  const r = await leerLinea("  Número (Enter = cancelar): ");
  const l = ls[(parseInt(r, 10) || 0) - 1];
  if (!l) console.log("  Cancelado.");
  return l || null;
}
const resumen = msg => typeof msg === "string" ? msg : msg.tipo === "imagen" ? `[imagen: ${path.basename(msg.archivo)}]${msg.caption ? "\n" + msg.caption : ""}` : `[imágenes de las mesas]\n${msg.respaldo || msg.texto}`;
async function verFecha() {
  for (const l of ligasConDatos()) {
    const d = await leerDatos(l); if (!d) continue;
    const { S, ri, ronda, hayMesas, fecha } = d;
    console.log(`\n${NOMBRE_LIGA[l]} · ${fecha}`);
    console.log(`  Fase: ${S.phase === "inscripcion" ? "inscripciones abiertas" : S.closedSig ? "fecha cerrada" : "jugando"} · ${S.players.length} jugadores`);
    if (hayMesas && S.phase !== "inscripcion") console.log(`  Ronda ${ri + 1} de ${S.cfg.rounds}: ${ronda.tables.filter(t => t.result).length} de ${ronda.tables.length} mesas reportadas`);
  }
  console.log(`  Mensajes en espera: ${cola.length}${pausado ? " · automáticos EN PAUSA" : ""}`);
}
// Arma el mensaje de la opción elegida. Devuelve {msgs, que, liga, mesas} o null si no se puede.
async function armarMensaje(op, grupo, ligaSel) {
  if (op === "7") {
    console.log("  Escribe el mensaje. Para varias líneas, termina con una línea que tenga solo un punto ( . ):");
    const ls = [];
    for (;;) { const l = await leerLinea(""); if (l === null || l.trim() === ".") break; ls.push(l); }
    const t = ls.join("\n").trim();
    if (!t) { console.log("  Mensaje vacío, no se envía."); return null; }
    return { msgs: [t], que: "tu mensaje", liga: ligaSel || ligaDeGrupo(grupo.id) || "grupo" };
  }
  if (op === "8") {
    fs.mkdirSync(DIR_IMG, { recursive: true });
    const arch = fs.readdirSync(DIR_IMG).filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f)).sort();
    if (!arch.length) { console.log(`  No hay imágenes. Copia la imagen en la carpeta: ${DIR_IMG}`); return null; }
    arch.forEach((f, i) => console.log(`    ${i + 1}) ${f}`));
    const r = await leerLinea("  ¿Qué imagen? (número, Enter = cancelar): ");
    const f = arch[(parseInt(r, 10) || 0) - 1];
    if (!f) { console.log("  Cancelado."); return null; }
    const cap = await leerLinea("  Texto que acompaña la imagen (Enter = sin texto): ");
    return { msgs: [{ tipo: "imagen", archivo: path.join(DIR_IMG, f), caption: (cap || "").trim() }], que: `la imagen ${f}`, liga: ligaSel || ligaDeGrupo(grupo.id) || "grupo" };
  }
  const liga = ligaSel || await elegirLigaDatos(grupo); if (!liga) return null;
  const d = await leerDatos(liga); if (!d) return null;
  const { S, ri, hayMesas, fecha, top } = d;
  if (op === "1" || op === "2") {
    if (S.phase === "inscripcion" || !hayMesas) { console.log("  Todavía no hay mesas armadas en esta liga."); return null; }
    const m = msgMesas(liga, S, ri);
    return { msgs: [op === "1" ? m : m.respaldo], que: `las mesas de la ronda ${ri + 1}`, liga, S, mesas: ri };
  }
  if (op === "3") {
    if (S.phase !== "inscripcion") console.log("  Ojo: la fecha ya no está en inscripciones.");
    return { msgs: [textoInscripcion(liga, S, CFG.portal)], que: "el mensaje de inscripción", liga, S };
  }
  if (op === "4") {
    const t = hayMesas && S.phase !== "inscripcion" && textoResultados(liga, S, ri);
    if (!t) { console.log(`  Todavía no hay mesas reportadas en la ronda ${ri + 1}.`); return null; }
    return { msgs: [t], que: `los resultados de la ronda ${ri + 1}`, liga, S };
  }
  if (op === "5") {
    if (S.phase === "inscripcion") { console.log("  La fecha todavía no empieza: no hay standing."); return null; }
    const r = await leerLinea(`  ¿Cuántos jugadores mostrar? (Enter = ${top || "todos"}, 0 = todos): `);
    const n = r === null || r.trim() === "" ? top : (parseInt(r, 10) || 0);
    return { msgs: [textoStanding(S, `${NOMBRE_LIGA[liga]} · Standing${S.fecha ? " " + fecha : ""}`, n) + (CFG.portal ? `\n\nStanding completo: ${urlPortal(liga, CFG.portal)}` : "")], que: "el standing", liga, S };
  }
  if (op === "6") {
    if (S.phase === "inscripcion") { console.log("  La fecha todavía no empieza."); return null; }
    let t = textoCierre(S, liga, top, urlPortal(liga, CFG.portal));
    if (!S.closedSig) t = t.replace("· Fecha cerrada*", "· Podio parcial*");   // la fecha aún no se cierra
    return { msgs: [t], que: "el podio de la fecha", liga, S };
  }
  return null;
}
// Dentro de un grupo: primero se elige la liga (Precon o Bracket 3) y después qué mensaje mandar
async function menuGrupo(grupo) {
  for (;;) {
    const ls = ligasConDatos();
    limpiar();
    console.log(`\n------ ${grupo.nombre} ------`);
    console.log("  ¿De qué liga quieres mandar?");
    ls.forEach((l, i) => console.log(`  ${i + 1}) ${(NOMBRE_LIGA[l] || l).replace("🧪 ", "")}`));
    console.log("  0) Volver al menú principal");
    const r = await leerLinea(`\n[${grupo.nombre}] Liga (0 = menú principal): `);
    if (r === null) return;
    const o = r.trim();
    if (o === "0" || /^(v|volver)$/i.test(o)) return mostrarMenu();
    const liga = ls[(parseInt(o, 10) || 0) - 1];
    if (!liga || !/^\d+$/.test(o)) { aviso = `  No existe la opción "${o}".`; continue; }
    const fin = await menuMensajes(grupo, liga);
    if (fin === "salir") return;
  }
}
async function menuMensajes(grupo, liga) {
  const titulo = `${grupo.nombre} · ${(NOMBRE_LIGA[liga] || liga).replace("🧪 ", "")}`;
  for (;;) {
    limpiar();
    console.log(`\n------ ${titulo} ------`);
    console.log("  ¿Qué quieres mandar?");
    MENU_GRUPO.forEach(([n, t]) => console.log(`  ${n}) ${t}`));
    const op = await leerLinea(`\n[${titulo}] Opción: `);
    if (op === null) return "salir";
    const o = op.trim();
    if (o === "0" || /^(v|volver)$/i.test(o)) return;
    const item = MENU_GRUPO.find(([n]) => n === o);
    if (!item || !item[2]) { aviso = `  No existe la opción "${o}".`; continue; }
    const n0 = nLog;
    const a = await armarMensaje(item[2], grupo, liga);
    if (!a) { if (nLog > n0) await leerLinea("  (Enter para seguir) "); continue; }
    console.log(`\n----- Vista previa → ${grupo.nombre} -----\n${a.msgs.map(resumen).join("\n\n")}\n-------------------------------`);
    const ok = await leerLinea(`  ¿Enviar ${a.que} a "${grupo.nombre}"? (s/n): `);
    if (!/^s/i.test(ok || "")) { aviso = "  No se envió."; continue; }
    // Si las mesas se mandan a mano al grupo de la liga, el bot no las vuelve a mandar solo al partir la ronda
    if (a.mesas != null && destinos[a.liga] === grupo.id) { const m = mem[a.liga]; if (m && m.fecha === (a.S.fecha || "sin-fecha")) { m.hecho[`r${a.mesas}:armada`] = 1; guardarMem(mem); } }
    a.msgs.forEach(msg => cola.push({ liga: a.liga, msg, S: a.S, to: grupo.id }));
    aviso = `  ✓ ${hora()} Enviando ${a.que} a "${grupo.nombre}".`;
    procesarCola();
  }
}
async function comando(op) {
  op = String(op || "").trim();
  if (!op || op === "0" || /^(m|menu|menú|ayuda|\?)$/i.test(op)) return mostrarMenu();
  if (/^p$/i.test(op)) {
    pausado = !pausado;
    aviso = pausado ? `  ⏸  ${hora()} Mensajes automáticos en PAUSA.` : `  ▶  ${hora()} Mensajes automáticos reanudados.`;
    return mostrarMenu();
  }
  if (/^e$/i.test(op)) { await verFecha(); await leerLinea("  (Enter para seguir) "); return mostrarMenu(); }
  if (/^r$/i.test(op)) { console.log("Buscando grupos…"); return mostrarMenu(true); }
  const gs = await cargarGruposMenu();
  const g = gs[(parseInt(op, 10) || 0) - 1];
  if (!g || !/^\d+$/.test(op)) { aviso = `  No existe la opción "${op}".`; return mostrarMenu(); }
  return menuGrupo(g);
}
let menuIniciado = false;
function iniciarMenu() {
  if (menuIniciado || (!process.stdin.isTTY && !ARG.includes("--menu"))) return;
  menuIniciado = true;
  const rl = require("readline").createInterface({ input: process.stdin, terminal: false });
  rl.on("line", l => { if (esperandoLinea) { const r = esperandoLinea; esperandoLinea = null; r(l); } else lineas.push(l); });
  rl.on("close", () => { stdinCerrado = true; if (esperandoLinea) { const r = esperandoLinea; esperandoLinea = null; r(null); } });
  (async () => {
    await mostrarMenu();
    for (;;) {
      const l = await leerLinea(lineas.length ? "" : "\nGrupo (número) o P: ");
      if (l === null) break;
      try { await comando(l); } catch (e) { console.error("Error en el comando:", e.message); }
    }
    if (ARG.includes("--menu") && SIMULAR) { while (enviando || cola.length) await espera(200); if (navegador) await navegador.close(); process.exit(0); }
  })();
}

if (SIMULAR) {
  LIGA_SEL = SEL[(argVal("--liga") || "").toLowerCase()] || null;
  if (ESTADO_ARCH && ARG.includes("--menu")) { (async () => { await revisar(); iniciarMenu(); })(); return; }
  if (ESTADO_ARCH) { (async () => { await revisar(); while (enviando || cola.length) await espera(200); if (navegador) await navegador.close(); process.exit(0); })(); return; }
  iniciar(); return;
}

// ---------- WhatsApp ----------
// Parche para whatsapp-web.js 1.34.7: WhatsApp Web (versión 2.3000.104x) renombró el id interno "_serialized" a "$1"
// y eso rompe la lista de chats y el envío ("Error: r", "Data passed to getter must include an id property").
// Se aplica una sola vez sobre node_modules, antes de cargar la librería.
function parcharWwebjs() {
  const MARCA = "/*parche-desafio-v1*/";
  let f;
  try {
    const pk = require.resolve("whatsapp-web.js/package.json");
    if (JSON.parse(fs.readFileSync(pk, "utf8")).version !== "1.34.7") return;   // otras versiones traen su propio arreglo
    f = path.join(path.dirname(pk), "src", "util", "Injected", "Utils.js");
  } catch (e) { return; }
  let src; try { src = fs.readFileSync(f, "utf8"); } catch (e) { return; }
  if (src.includes(MARCA)) return;
  let out = src, n = 0;
  // 1) "_serialized" vuelve a existir: se lee desde "$1" en los ids vivos y en los datos que se devuelven
  out = out.replace("window.WWebJS = {};", m => { n++; return m + `
    ${MARCA}
    window.__dsfSer = (o) => { try { if (o && typeof o === 'object' && typeof o.$1 === 'string' && !Object.prototype.hasOwnProperty.call(o, '_serialized')) Object.defineProperty(o, '_serialized', { value: o.$1, enumerable: true, configurable: true, writable: true }); } catch (e) {} return o; };
    (() => { try {
        const def = (o) => { if (!o) return; const p = Object.getPrototypeOf(o); if (p && !('_serialized' in o) && typeof o.$1 === 'string') Object.defineProperty(p, '_serialized', { get() { return this.$1; }, configurable: true }); };
        const WF = window.require('WAWebWidFactory');
        def(WF.createWid('0@c.us')); def(WF.createWid('0@g.us'));
        try { const MK = window.require('WAWebMsgKey'); def(new MK({ fromMe: true, remote: WF.createWid('0@c.us'), id: 'DSF0' })); } catch (e) {}
    } catch (e) {} })();`; });
  // 2) La lista de chats no se cae entera por un chat con problemas
  out = out.replace(/const chatPromises = chats\.map\(\(chat\) =>\s*window\.WWebJS\.getChatModel\(chat\),?\s*\);\s*return await Promise\.all\(chatPromises\);/, () => { n++; return `const lista = [];
        for (const chat of chats) { try { const m = await window.WWebJS.getChatModel(chat); if (m) lista.push(m); } catch (e) {} }
        return lista;`; });
  // 3) Envío de imágenes: el modelo de la imagen trae su propio id y WhatsApp lo rechaza
  out = out.replace(/(const message = \{[\s\S]*?\n        \};)/, m => { n++; return m + "\n        delete message.__x_id;"; });
  // 4) Id del mensaje enviado
  out = out.replace(".Msg.get(newMsgKey._serialized);", () => { n++; return ".Msg.get(newMsgKey._serialized || newMsgKey.$1);"; });
  // 5) Todo lo que devuelve la librería sale con "_serialized" (lo leen las demás partes de whatsapp-web.js)
  const fin = out.lastIndexOf("};");
  out = out.slice(0, fin) + `    (() => {
        const norm = (o, d, vistos) => {
            if (!o || typeof o !== 'object' || d > 7 || vistos.has(o)) return o; vistos.add(o);
            window.__dsfSer(o);
            const plano = Array.isArray(o) || Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null;
            if (plano) for (const k of Object.keys(o)) { try { norm(o[k], d + 1, vistos); } catch (e) {} }
            return o;
        };
        Object.keys(window.WWebJS).forEach((k) => {
            const fn = window.WWebJS[k]; if (typeof fn !== 'function' || k === 'compareWwebVersions') return;
            window.WWebJS[k] = function (...a) { const r = fn.apply(this, a); return r && typeof r.then === 'function' ? r.then((v) => norm(v, 0, new WeakSet())) : norm(r, 0, new WeakSet()); };
        });
    })();
` + out.slice(fin); n++;
  if (n < 5) { console.log(`${hora()} Aviso: el parche de WhatsApp Web se aplicó a medias (${n} de 5). Si algo falla, avísale a Diego.`); }
  try { fs.writeFileSync(f + ".original", src); fs.writeFileSync(f, out); console.log(`${hora()} Parche de compatibilidad con WhatsApp Web aplicado.`); } catch (e) { console.log(`${hora()} No se pudo aplicar el parche de WhatsApp Web: ${e.message}`); }
}
parcharWwebjs();
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
// Vincular con código (en vez de QR): se usa el número del celular del bot (config.json → "numeroBot")
const normNumero = v => { const t = String(v || "").replace(/\D/g, ""); return t.length === 9 && t.startsWith("9") ? "56" + t : t; };
const haySesion = () => { try { return fs.readdirSync(path.join(DIR, "sesion-whatsapp", "session")).length > 0; } catch (e) { return false; } };
async function numeroVinculo() {
  const cfg = normNumero(CFG.numeroBot);
  if (cfg || haySesion() || !process.stdin.isTTY) return cfg;
  console.log("\nHay que vincular el WhatsApp del bot (solo la primera vez).");
  console.log("Escribe el número del celular del bot para recibir un CÓDIGO de 8 letras (ej. +56 9 1234 5678).");
  for (;;) {
    const r = await pregunta("Número del bot (Enter = usar código QR): ");
    if (!r) return "";
    const n = normNumero(r);
    if (/^\d{10,15}$/.test(n)) {
      // Se guarda en config.json para no volver a preguntarlo
      try { const c = JSON.parse(fs.readFileSync(CFG_FILE, "utf8")); c.numeroBot = "+" + n; fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2)); } catch (e) {}
      return n;
    }
    console.log("Ese número no parece válido. Escríbelo con el código del país, por ejemplo +56912345678.");
  }
}
function crearCliente(NUMERO) {
client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(DIR, "sesion-whatsapp") }),
  ...(NUMERO ? { pairWithPhoneNumber: { phoneNumber: NUMERO, showNotification: true } } : {}),
  // En un servidor Linux (p. ej. ARM de Oracle) se usa el Chromium del sistema: "chromePath": "/usr/bin/chromium"
  puppeteer: { headless: true, executablePath: NAVEGADOR, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] }
});
client.on("qr", qr => {
  console.log("\nEscanea este código con el WhatsApp del número del bot:");
  console.log("WhatsApp → Dispositivos vinculados → Vincular un dispositivo\n");
  qrcode.generate(qr, { small: true });
});
client.on("code", code => {
  const c = String(code || ""), cod = c.length === 8 ? c.slice(0, 4) + "-" + c.slice(4) : c;
  console.log("\n============================================");
  console.log("  CÓDIGO PARA VINCULAR EL BOT:  " + cod);
  console.log("============================================");
  console.log("En el celular del bot abre WhatsApp → Dispositivos vinculados → Vincular un dispositivo");
  console.log("→ toca \"Vincular con el número de teléfono\" (abajo) y escribe el código.");
  console.log("Si el código vence, el bot muestra uno nuevo solo.\n");
});
client.on("authenticated", () => console.log(`${hora()} Sesión de WhatsApp guardada.`));
client.on("auth_failure", m => console.error("No se pudo iniciar sesión en WhatsApp:", m));
client.on("disconnected", r => { console.error(`${hora()} WhatsApp se desconectó (${r}). Vuelve a abrir el bot.`); process.exit(1); });
client.on("ready", alListo);
}
// Lista de grupos (con reintentos: recién vinculado, WhatsApp tarda en sincronizar los chats)
// Si getChats falla (pasa con algunas versiones de WhatsApp Web), los grupos se leen directo de la memoria de WhatsApp Web
async function gruposDirecto() {
  const page = client.pupPage; if (!page) return null;
  const r = await page.evaluate(() => {
    const errores = [];
    const arr = col => { if (!col) return []; try { return col.getModelsArray ? col.getModelsArray() : (col.models || col._models || []); } catch (e) { errores.push(String(e && e.message || e)); return []; } };
    const req = n => { try { return window.require ? window.require(n) : null; } catch (e) { return null; } };
    const W = req("WAWebCollections") || {};
    const S = window.Store || {};
    const fuentes = [S.Chat, W.Chat, S.GroupMetadata, W.GroupMetadata];
    const out = {};
    fuentes.forEach(col => arr(col).forEach(c => {
      try {
        const id = c && c.id && (c.id._serialized || c.id.$1 || (c.id.user ? c.id.user + "@" + (c.id.server || "g.us") : ""));
        if (!id || !/@g\.us$/.test(id)) return;
        const name = c.formattedTitle || c.subject || c.name || (c.groupMetadata && c.groupMetadata.subject) || "";
        if (!(id in out) || (!out[id] && name)) out[id] = name;
      } catch (e) { errores.push(String(e && e.message || e)); }
    }));
    return { grupos: Object.entries(out).map(([id, name]) => ({ id, name })), errores: errores.slice(0, 2), store: !!window.Store, req: !!window.require };
  });
  if (!r) return null;
  if (!r.grupos.length) console.log(`${hora()} (lectura directa: Store=${r.store} require=${r.req}${r.errores.length ? " · " + r.errores.join(" | ") : ""})`);
  return r.grupos.map(g => ({ id: { _serialized: g.id }, name: g.name || "(grupo sin nombre)", isGroup: true }));
}
async function listarGrupos() {
  let ultimoError = "";
  for (let i = 0; i < 6; i++) {
    try { return (await client.getChats()).filter(c => c.isGroup); }
    catch (e) { ultimoError = String(e && e.message || e).split("\n")[0].slice(0, 160); }
    try { const g = await gruposDirecto(); if (g && g.length) { console.log(`${hora()} Grupos leídos directo de WhatsApp Web (${g.length}).`); return g; } } catch (e) {}
    console.log(`${hora()} WhatsApp todavía está cargando los chats… (intento ${i + 1} de 6)`); await espera(10000);
  }
  if (ultimoError) console.log(`${hora()} Detalle del error: ${ultimoError}`);
  return null;
}
// Un grupo se puede indicar por su nombre exacto o por su link de invitación (https://chat.whatsapp.com/...)
async function idDeGrupo(valor, cargar) {
  // Un número de teléfono (ej. +56 9 1234 5678) manda al chat personal de ese número
  const tel = String(valor || "").replace(/[\s+().-]/g, "");
  if (/^\d{8,15}$/.test(tel)) {
    const num = tel.length === 9 && tel.startsWith("9") ? "56" + tel : tel;   // celular chileno sin el 56
    try { const r = await client.getNumberId(num); if (r && r._serialized) return { id: r._serialized, nombre: "chat de +" + num }; } catch (e) {}
    return { id: num + "@c.us", nombre: "chat de +" + num };
  }
  const m = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]+)/.exec(valor || "");
  if (m) {
    try {
      const info = await client.getInviteInfo(m[1]), id = info && info.id;
      const s = id && (typeof id === "string" ? id : id._serialized || (id.user && id.server ? id.user + "@" + id.server : null));
      if (s) return { id: s, nombre: info.subject || "grupo del link" };
    } catch (e) { /* se intenta unir con el link */ }
    try { const gid = await client.acceptInvite(m[1]); return { id: gid, nombre: "grupo del link" }; } catch (e) {}
    return null;
  }
  const grupos = await cargar(); if (!grupos) return null;
  const g = grupos.find(x => (x.name || "").trim().toLowerCase() === valor.trim().toLowerCase());
  return g ? { id: g.id._serialized, nombre: g.name } : null;
}
async function alListo() {
  console.log(`${hora()} WhatsApp conectado.`);
  await espera(4000);
  let cache;
  const cargar = async () => (cache !== undefined ? cache : (cache = await listarGrupos()));
  if (ARG.includes("--grupos")) {
    const grupos = await cargar();
    if (!grupos) {
      console.log("\nNo pude leer la lista de grupos (WhatsApp sigue sincronizando o cambió algo en WhatsApp Web).");
      console.log("Alternativa: en config.json pon el LINK DE INVITACIÓN del grupo en vez del nombre, por ejemplo:");
      console.log('   "precon": "https://chat.whatsapp.com/XXXXXXXX"');
      console.log("y luego abre 3-PROBAR.bat. También puedes esperar unos minutos y volver a abrir este archivo.");
      process.exit(1);
    }
    console.log("\nTus grupos (copia el nombre exacto en config.json, o usa el link de invitación del grupo):");
    grupos.forEach(g => console.log("  · " + g.name));
    process.exit(0);
  }
  for (const [liga, valor] of Object.entries(CFG.grupos || {})) {
    if (!usaLiga(liga)) continue;
    if (!valor || /NOMBRE EXACTO/.test(valor)) { if (!liga.endsWith("_test")) console.log(`${hora()} ${liga}: sin grupo en config.json (${valor ? "todavía dice NOMBRE EXACTO…" : "vacío"}).`); continue; }
    const g = await idDeGrupo(valor, cargar);
    if (g) { destinos[liga] = g.id; nombresDestino[liga] = g.nombre; console.log(`${hora()} ${liga} → ${g.nombre}`); }
    else console.error(`${hora()} No encontré el grupo "${valor}" para ${liga}. Revisa el nombre o usa el link de invitación del grupo.`);
  }
  if (!Object.keys(destinos).length) {
    console.error(`No hay grupos configurados. Revisa config.json (se leyó: ${CFG_FILE}).`);
    console.error(`"grupos" dice: ${JSON.stringify(CFG.grupos || {})}`);
    console.error('Debe quedar, por ejemplo:  "precon": "https://chat.whatsapp.com/XXXX",  "b3": "https://chat.whatsapp.com/YYYY"');
    process.exit(1);
  }
  if (ARG.includes("--prueba")) {
    for (const id of new Set(Object.values(destinos))) await enviar(id, "🤖 Bot de la liga conectado. Aquí se publicarán las mesas y los resultados en vivo.");
    console.log("Mensaje de prueba enviado."); await espera(3000); process.exit(0);
  }
  iniciar();
}
(async () => { if (!ARG.includes("--grupos")) await elegirLiga(); crearCliente(await numeroVinculo()); client.initialize(); })();
