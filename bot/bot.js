// Bot de WhatsApp de la Liga Commander El Desafío.
// Lee la liga en vivo desde Supabase (solo lectura, con la clave pública) y publica en los grupos:
// mesas de cada ronda, resultado de cada mesa al cerrarse, standing tras cada ronda y el cierre de la fecha.
//
//   node bot.js            → funciona normal (la primera vez muestra un código QR para vincular WhatsApp)
//   node bot.js --grupos   → muestra los nombres exactos de tus grupos para copiarlos en config.json
//   node bot.js --prueba   → manda un mensaje de prueba a los grupos configurados
//   node bot.js --simular  → no usa WhatsApp: muestra en pantalla lo que publicaría

const fs = require("fs");
const path = require("path");
const { anunciar } = require("./anuncios");

const DIR = __dirname;
const CFG_FILE = path.join(DIR, "config.json");
const MEM_FILE = path.join(DIR, "memoria.json");
if (!fs.existsSync(CFG_FILE)) { console.error("Falta config.json: copia config.ejemplo.json como config.json y complétalo."); process.exit(1); }
const CFG = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
const ARG = process.argv.slice(2);
const SIMULAR = ARG.includes("--simular");
const LIGAS = { precon: { estado: "estado", cal: "calendario" }, b3: { estado: "estado_b3", cal: "calendario_b3" } };

const leerMem = () => { try { return JSON.parse(fs.readFileSync(MEM_FILE, "utf8")); } catch (e) { return {}; } };
const guardarMem = m => fs.writeFileSync(MEM_FILE, JSON.stringify(m, null, 1));
const hora = () => new Date().toLocaleTimeString("es-CL");
const espera = ms => new Promise(r => setTimeout(r, ms));

async function leerLiga() {
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
async function procesarCola() {
  if (enviando) return; enviando = true;
  while (cola.length) {
    const { liga, texto } = cola[0];
    try {
      if (SIMULAR) console.log(`\n----- [${liga}] ${hora()} -----\n${texto}\n`);
      else { await client.sendMessage(destinos[liga], texto); console.log(`${hora()} enviado a ${liga}: ${texto.split("\n")[0]}`); }
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
    const top = cal.topPublico == null ? (CFG.top || 10) : cal.topPublico;
    // Al arrancar, lo que ya pasó se registra sin publicar (para no repetir mensajes)
    const silencioso = primera && !mem[liga] && !ARG.includes("--anunciar-todo");
    const { mensajes, memoria } = anunciar(liga, S, { top, portal: CFG.portal }, mem[liga], silencioso);
    mem[liga] = memoria;
    mensajes.forEach(texto => cola.push({ liga, texto }));
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

if (SIMULAR) { iniciar(); return; }

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
client.on("ready", async () => {
  const chats = await client.getChats();
  const grupos = chats.filter(c => c.isGroup);
  if (ARG.includes("--grupos")) {
    console.log("\nTus grupos (copia el nombre exacto en config.json):");
    grupos.forEach(g => console.log("  · " + g.name));
    process.exit(0);
  }
  for (const [liga, nombre] of Object.entries(CFG.grupos || {})) {
    if (!nombre) continue;
    const g = grupos.find(x => x.name.trim().toLowerCase() === nombre.trim().toLowerCase());
    if (g) { destinos[liga] = g.id._serialized; console.log(`${hora()} ${liga} → grupo "${g.name}"`); }
    else console.error(`${hora()} No encontré el grupo "${nombre}" para ${liga}. Usa --grupos para ver los nombres.`);
  }
  if (!Object.keys(destinos).length) { console.error("No hay grupos configurados. Revisa config.json."); process.exit(1); }
  if (ARG.includes("--prueba")) {
    for (const liga of Object.keys(destinos)) await client.sendMessage(destinos[liga], "🤖 Bot de la liga conectado. Aquí se publicarán las mesas y los resultados en vivo.");
    console.log("Mensaje de prueba enviado."); await espera(3000); process.exit(0);
  }
  iniciar();
});
client.initialize();
