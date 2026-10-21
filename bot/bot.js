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
  if (!SEL[v] && process.stdin.isTTY && !ARG.includes("--grupos")) {
    console.log("\n¿Qué liga va a manejar el bot?\n  1) Liga Precon\n  2) Liga Bracket 3\n  3) Las dos");
    let r = ""; while (!["1", "2", "3"].includes(r)) r = await pregunta("Escribe 1, 2 o 3 y presiona Enter: ");
    v = { 1: "precon", 2: "b3", 3: "ambas" }[r];
    if (!ARG.includes("--prueba")) {
      const s = await pregunta("¿Mandar ahora al grupo el mensaje para inscribirse? (s/n): ");
      INVITAR = /^s/i.test(s);
    }
  }
  LIGA_SEL = SEL[v] || SEL.ambas;
  console.log(`${hora()} Liga: ${v === "precon" ? "Precon" : v === "b3" ? "Bracket 3" : "las dos"}${INVITAR ? " · se manda el mensaje de inscripción" : ""}`);
}
const LIGAS = { precon: { estado: "estado", cal: "calendario" }, b3: { estado: "estado_b3", cal: "calendario_b3" },
  // Ligas de testeo del desarrollador: solo se leen si tienen grupo en config.json ("precon_test" / "b3_test")
  precon_test: { estado: "estado_test", cal: "calendario_test" }, b3_test: { estado: "estado_b3_test", cal: "calendario_b3_test" } };

const leerMem = () => { try { return JSON.parse(fs.readFileSync(MEM_FILE, "utf8")); } catch (e) { return {}; } };
const guardarMem = m => fs.writeFileSync(MEM_FILE, JSON.stringify(m, null, 1));
const hora = () => new Date().toLocaleTimeString("es-CL");
const espera = ms => new Promise(r => setTimeout(r, ms));

const ESTADO_ARCH = (i => i >= 0 ? ARG[i + 1] : null)(ARG.indexOf("--estado"));
async function leerLiga() {
  if (ESTADO_ARCH) return { estado: JSON.parse(fs.readFileSync(ESTADO_ARCH, "utf8")) };
  const ids = Object.values(LIGAS).flatMap(l => [l.estado, l.cal]).join(",");
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
      await enviar(destinos[liga], media, i === 0 ? { caption: m.texto } : {});
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
  else { await enviar(destinos[liga], texto); console.log(`${hora()} enviado a ${liga}: ${texto.split("\n")[0]}`); }
}
async function procesarCola() {
  if (enviando) return; enviando = true;
  while (cola.length) {
    const { liga, msg, S } = cola[0];
    try {
      if (typeof msg === "string") await enviarTexto(liga, msg);
      else if (msg.tipo === "mesas") await enviarMesas(liga, msg, S);
      cola.shift();
      await espera(SIMULAR ? 50 : 2500);
    } catch (e) {
      console.error(`${hora()} no se pudo enviar (se reintenta en 30 s):`, e.message);
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
let pausado = false;
const MENU = [
  ["1", "Enviar al grupo las mesas de la ronda actual (imágenes)"],
  ["2", "Enviar al grupo las mesas de la ronda actual (texto)"],
  ["3", "Enviar el mensaje para inscribirse"],
  ["4", "Enviar los resultados de la ronda actual"],
  ["5", "Enviar el standing"],
  ["6", "Enviar el podio / cierre de la fecha"],
  ["7", "Enviar un mensaje escrito por ti"],
  ["8", "Pausar / reanudar los mensajes automáticos"],
  ["9", "Ver cómo va la fecha"],
  ["0", "Mostrar este menú"]
];
function mostrarMenu() {
  console.log("\n========== COMANDOS DEL BOT ==========");
  MENU.forEach(([n, t]) => console.log(`  ${n}) ${t}`));
  console.log("  Escribe el número y presiona Enter." + (pausado ? "\n  ⏸  Mensajes automáticos EN PAUSA (opción 8 para reanudar)" : ""));
  console.log("======================================");
}
const lineas = []; let esperandoLinea = null, stdinCerrado = false;
function leerLinea(txt) {
  if (txt) process.stdout.write(txt);
  if (lineas.length) return Promise.resolve(lineas.shift());
  if (stdinCerrado) return Promise.resolve(null);
  return new Promise(r => esperandoLinea = r);
}
const ligasActivas = () => Object.keys(LIGAS).filter(l => usaLiga(l) && (SIMULAR ? !l.endsWith("_test") : destinos[l]));
async function elegirLigaMenu() {
  const ls = ligasActivas();
  if (!ls.length) { console.log("No hay ningún grupo de liga conectado."); return null; }
  if (ls.length === 1) return ls[0];
  ls.forEach((l, i) => console.log(`  ${i + 1}) ${NOMBRE_LIGA[l] || l}`));
  const r = await leerLinea("¿A qué liga? (número, Enter = cancelar): ");
  const l = ls[(parseInt(r, 10) || 0) - 1];
  if (!l) console.log("Cancelado.");
  return l || null;
}
const resumen = msg => typeof msg === "string" ? msg : `[${msg.tipo === "mesas" ? "imágenes de las mesas" : "mensaje"}]\n${msg.respaldo || msg.texto}`;
async function comando(op) {
  op = String(op || "").trim();
  if (!op) return;
  if (op === "0" || /^(m|menu|menú|ayuda|\?)$/i.test(op)) return mostrarMenu();
  if (op === "8") {
    pausado = !pausado;
    console.log(pausado ? `${hora()} ⏸  Mensajes automáticos en PAUSA. Los comandos del menú siguen funcionando.` : `${hora()} ▶  Mensajes automáticos reanudados.`);
    return;
  }
  if (!MENU.some(([n]) => n === op)) { console.log(`No existe la opción "${op}". Escribe 0 para ver el menú.`); return; }
  const liga = await elegirLigaMenu(); if (!liga) return;
  let datos;
  try { datos = await leerLiga(); } catch (e) { console.error("No se pudo leer la liga:", e.message); return; }
  const S = datos[LIGAS[liga].estado], cal = datos[LIGAS[liga].cal] || {};
  if (!S || !S.players) { console.log("Esa liga todavía no tiene datos."); return; }
  const top = cal.topPublico == null ? (CFG.top || 10) : cal.topPublico;
  const ri = Math.max(0, Math.min(S.cur | 0, (S.rounds || []).length - 1));
  const ronda = (S.rounds || [])[ri], hayMesas = ronda && ronda.tables && ronda.tables.length;
  const fecha = S.fecha ? S.fecha.split("-").reverse().join("/") : "sin fecha";
  if (op === "9") {
    console.log(`\n${NOMBRE_LIGA[liga]} · ${fecha}`);
    console.log(`  Fase: ${S.phase === "inscripcion" ? "inscripciones abiertas" : S.closedSig ? "fecha cerrada" : "jugando"} · ${S.players.length} jugadores`);
    if (hayMesas) console.log(`  Ronda ${ri + 1} de ${S.cfg.rounds}: ${ronda.tables.filter(t => t.result).length} de ${ronda.tables.length} mesas reportadas`);
    console.log(`  Mensajes en espera: ${cola.length}${pausado ? " · automáticos EN PAUSA" : ""}`);
    return;
  }
  let msgs = [], que = "";
  if (op === "1" || op === "2") {
    if (S.phase === "inscripcion" || !hayMesas) { console.log("Todavía no hay mesas armadas en esta liga."); return; }
    const m = msgMesas(liga, S, ri);
    msgs = [op === "1" ? m : m.respaldo]; que = `las mesas de la ronda ${ri + 1}`;
  } else if (op === "3") {
    msgs = [textoInscripcion(liga, S, CFG.portal)]; que = "el mensaje de inscripción";
    if (S.phase !== "inscripcion") console.log("Ojo: la fecha ya no está en inscripciones.");
  } else if (op === "4") {
    const t = hayMesas && textoResultados(liga, S, ri);
    if (!t) { console.log(`Todavía no hay mesas reportadas en la ronda ${ri + 1}.`); return; }
    msgs = [t]; que = `los resultados de la ronda ${ri + 1}`;
  } else if (op === "5") {
    if (S.phase === "inscripcion") { console.log("La fecha todavía no empieza: no hay standing."); return; }
    const r = await leerLinea(`¿Cuántos jugadores mostrar? (Enter = ${top || "todos"}, 0 = todos): `);
    const n = r === null || r.trim() === "" ? top : (parseInt(r, 10) || 0);
    msgs = [textoStanding(S, `${NOMBRE_LIGA[liga]} · Standing${S.fecha ? " " + fecha : ""}`, n) + (CFG.portal ? `\n\nStanding completo: ${urlPortal(liga, CFG.portal)}` : "")];
    que = "el standing";
  } else if (op === "6") {
    if (S.phase === "inscripcion") { console.log("La fecha todavía no empieza."); return; }
    let t = textoCierre(S, liga, top, urlPortal(liga, CFG.portal));
    if (!S.closedSig) t = t.replace("· Fecha cerrada*", "· Podio parcial*");   // la fecha aún no se cierra
    msgs = [t]; que = "el podio de la fecha";
  } else if (op === "7") {
    console.log("Escribe el mensaje. Para varias líneas, termina con una línea que tenga solo un punto ( . ):");
    const ls = [];
    for (;;) { const l = await leerLinea(""); if (l === null || l.trim() === ".") break; ls.push(l); }
    const t = ls.join("\n").trim();
    if (!t) { console.log("Mensaje vacío, no se envía."); return; }
    msgs = [t]; que = "tu mensaje";
  }
  console.log(`\n----- Vista previa (${NOMBRE_LIGA[liga]}) -----\n${msgs.map(resumen).join("\n\n")}\n-------------------------------`);
  const ok = await leerLinea(`¿Enviar ${que} al grupo? (s/n): `);
  if (!/^s/i.test(ok || "")) { console.log("No se envió."); return; }
  // Las mesas enviadas a mano no se vuelven a mandar solas al partir la ronda
  if (op === "1" || op === "2") { const m = mem[liga]; if (m && m.fecha === (S.fecha || "sin-fecha")) { m.hecho[`r${ri}:armada`] = 1; guardarMem(mem); } }
  msgs.forEach(msg => cola.push({ liga, msg, S }));
  console.log(`${hora()} En cola: ${que}.`);
  procesarCola();
}
let menuIniciado = false;
function iniciarMenu() {
  if (menuIniciado || (!process.stdin.isTTY && !ARG.includes("--menu"))) return;
  menuIniciado = true;
  const rl = require("readline").createInterface({ input: process.stdin, terminal: false });
  rl.on("line", l => { if (esperandoLinea) { const r = esperandoLinea; esperandoLinea = null; r(l); } else lineas.push(l); });
  rl.on("close", () => { stdinCerrado = true; if (esperandoLinea) { const r = esperandoLinea; esperandoLinea = null; r(null); } });
  mostrarMenu();
  (async () => {
    for (;;) {
      const l = await leerLinea(lineas.length ? "" : "\nComando (0 = menú): ");
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
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const NUMERO = String(CFG.numeroBot || "").replace(/\D/g, "");   // ej. 56912345678: vincula con código en vez de QR
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
  console.log("\nCódigo para vincular el WhatsApp del bot: " + code);
  console.log("En el celular del bot: WhatsApp → Dispositivos vinculados → Vincular un dispositivo → Vincular con número de teléfono, y escribe el código.\n");
});
client.on("authenticated", () => console.log(`${hora()} Sesión de WhatsApp guardada.`));
client.on("auth_failure", m => console.error("No se pudo iniciar sesión en WhatsApp:", m));
client.on("disconnected", r => { console.error(`${hora()} WhatsApp se desconectó (${r}). Vuelve a abrir el bot.`); process.exit(1); });
// Lista de grupos (con reintentos: recién vinculado, WhatsApp tarda en sincronizar los chats)
async function listarGrupos() {
  for (let i = 0; i < 5; i++) {
    try { return (await client.getChats()).filter(c => c.isGroup); }
    catch (e) { console.log(`${hora()} WhatsApp todavía está cargando los chats… (intento ${i + 1} de 5)`); await espera(10000); }
  }
  return null;
}
// Un grupo se puede indicar por su nombre exacto o por su link de invitación (https://chat.whatsapp.com/...)
async function idDeGrupo(valor, cargar) {
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
client.on("ready", async () => {
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
    if (!valor || /NOMBRE EXACTO/.test(valor) || !usaLiga(liga)) continue;
    const g = await idDeGrupo(valor, cargar);
    if (g) { destinos[liga] = g.id; console.log(`${hora()} ${liga} → ${g.nombre}`); }
    else console.error(`${hora()} No encontré el grupo "${valor}" para ${liga}. Revisa el nombre o usa el link de invitación del grupo.`);
  }
  if (!Object.keys(destinos).length) { console.error("No hay grupos configurados. Revisa config.json."); process.exit(1); }
  if (ARG.includes("--prueba")) {
    for (const id of new Set(Object.values(destinos))) await enviar(id, "🤖 Bot de la liga conectado. Aquí se publicarán las mesas y los resultados en vivo.");
    console.log("Mensaje de prueba enviado."); await espera(3000); process.exit(0);
  }
  iniciar();
});
(async () => { if (!ARG.includes("--grupos")) await elegirLiga(); client.initialize(); })();
