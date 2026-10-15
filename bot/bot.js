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
const { anunciar } = require("./anuncios");
const { imagenesMesas } = require("./imagenes");

const DIR = __dirname;
const CFG_FILE = path.join(DIR, "config.json");
const MEM_FILE = path.join(DIR, "memoria.json");
if (!fs.existsSync(CFG_FILE)) { console.error("Falta config.json: copia config.ejemplo.json como config.json y complétalo."); process.exit(1); }
const CFG = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
const ARG = process.argv.slice(2);
const SIMULAR = ARG.includes("--simular");
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
  if (!navegador) navegador = await require("puppeteer").launch({ headless: true, executablePath: CFG.chromePath || undefined, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  return navegador;
}
async function enviarMesas(liga, m, S) {
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
  for (let i = 0; i < imgs.length; i++) {
    const media = new MessageMedia("image/png", imgs[i].png.toString("base64"), imgs[i].nombre);
    await client.sendMessage(destinos[liga], media, i === 0 ? { caption: m.texto } : {});
    await espera(1200);
  }
  console.log(`${hora()} enviado a ${liga}: ${imgs.length} ${imgs.length === 1 ? "imagen" : "imágenes"} de la ronda ${m.ri + 1}`);
}
async function enviarTexto(liga, texto) {
  if (SIMULAR) console.log(`\n----- [${liga}] ${hora()} -----\n${texto}\n`);
  else { await client.sendMessage(destinos[liga], texto); console.log(`${hora()} enviado a ${liga}: ${texto.split("\n")[0]}`); }
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
    const S = datos[ids.estado], cal = datos[ids.cal] || {};
    if (!S) continue;
    const top = cal.topPublico == null ? (CFG.top || 10) : cal.topPublico;
    // Al arrancar, lo que ya pasó se registra sin publicar (para no repetir mensajes)
    const silencioso = primera && !mem[liga] && !ARG.includes("--anunciar-todo");
    const { mensajes, memoria } = anunciar(liga, S, { top, portal: CFG.portal }, mem[liga], silencioso);
    mem[liga] = memoria;
    mensajes.forEach(msg => cola.push({ liga, msg, S }));
  }
  primera = false;
  guardarMem(mem);
  procesarCola();
}

async function iniciar() {
  console.log(`${hora()} Bot listo. Revisando la liga cada ${CFG.cadaSegundos || 15} s.`);
  await revisar();
  setInterval(revisar, (CFG.cadaSegundos || 15) * 1000);
}

if (SIMULAR) {
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
  puppeteer: { headless: true, executablePath: CFG.chromePath || undefined, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] }
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
    if (!valor || /NOMBRE EXACTO/.test(valor)) continue;
    const g = await idDeGrupo(valor, cargar);
    if (g) { destinos[liga] = g.id; console.log(`${hora()} ${liga} → ${g.nombre}`); }
    else console.error(`${hora()} No encontré el grupo "${valor}" para ${liga}. Revisa el nombre o usa el link de invitación del grupo.`);
  }
  if (!Object.keys(destinos).length) { console.error("No hay grupos configurados. Revisa config.json."); process.exit(1); }
  if (ARG.includes("--prueba")) {
    for (const id of new Set(Object.values(destinos))) await client.sendMessage(id, "🤖 Bot de la liga conectado. Aquí se publicarán las mesas y los resultados en vivo.");
    console.log("Mensaje de prueba enviado."); await espera(3000); process.exit(0);
  }
  iniciar();
});
client.initialize();
