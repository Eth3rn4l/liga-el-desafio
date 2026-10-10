/* =====================================================================
   El Desafío · conexión con Supabase
   - Cuentas: crear cuenta, código de 6 dígitos por correo, entrar,
     recuperar contraseña (estándares del documento de cuentas)
   - Base de datos: misma interfaz que usaba la página (doc / collection
     / onSnapshot), guardada en las tablas de Supabase
   ===================================================================== */
(function(){
  "use strict";
  const CFG = window.SB_CONFIG || {};
  const sb = (window.supabase && CFG.url && CFG.key) ? window.supabase.createClient(CFG.url, CFG.key) : null;
  window.sb = sb;

  /* ---------- Reglas de cuenta ---------- */
  const R = {
    nombreMin: 2, nombreMax: 40, apodoMin: 2, apodoMax: 20,
    passMin: 8, passMax: 72,
    codigoLargo: 6, codigoMin: 15, codigoIntentos: 5,
    reenvioSeg: 60,
    loginIntentos: 5, bloqueoMin: 15
  };
  const NOMBRE_RE = /^[\p{L}][\p{L}' .-]*$/u;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
  const clean = s => String(s || "").trim().replace(/\s+/g, " ");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const store = {
    get(k){ try { return JSON.parse(localStorage.getItem(k) || "null"); } catch(e){ return null; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
    del(k){ try { localStorage.removeItem(k); } catch(e){} }
  };

  function checkPass(p){
    if (p.length < R.passMin) return `La contraseña debe tener al menos ${R.passMin} caracteres.`;
    if (p.length > R.passMax) return `La contraseña puede tener como máximo ${R.passMax} caracteres.`;
    if (!/\p{L}/u.test(p) || !/\d/.test(p)) return "La contraseña debe tener al menos una letra y un número.";
    return "";
  }
  function friendly(err){
    const code = err && (err.code || ""), msg = String(err && err.message || err || "");
    if (code === "over_email_send_rate_limit" || /rate limit|for security purposes/i.test(msg)) return "Se enviaron demasiados correos. Espera un momento antes de pedir otro código.";
    if (code === "otp_expired" || /expired|invalid/i.test(msg) && /token|otp/i.test(msg)) return "El código no es correcto o ya venció.";
    if (code === "invalid_credentials" || /invalid login/i.test(msg)) return "Correo o contraseña incorrectos.";
    if (code === "email_not_confirmed") return "Tu correo aún no está verificado.";
    if (code === "weak_password") return "La contraseña es muy débil: usa al menos 8 caracteres con letras y números.";
    if (code === "same_password") return "La contraseña nueva debe ser distinta a la anterior.";
    if (/Failed to fetch|NetworkError|network/i.test(msg)) return "No hay conexión. Revisa tu internet e intenta de nuevo.";
    if (/error sending .*email/i.test(msg)) return "No se pudo enviar el correo con el código. Intenta en unos minutos o avísale al organizador.";
    if (/Database error saving new user/i.test(msg)) return "Revisa tu nombre y apellido: deben tener entre 2 y 40 letras.";
    return msg || "Ocurrió un error. Intenta de nuevo.";
  }

  /* ---------- Ventana de cuenta ---------- */
  const css = `
.acc-back{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px;z-index:200;overflow:auto}
.acc{width:100%;max-width:420px;background:var(--surface,#151111);border:1px solid var(--line,#2c2321);border-radius:16px;padding:22px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.acc-h{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.acc-h h2{margin:0;font-family:var(--f-display);font-weight:900;font-size:22px;line-height:1.15}
.acc-h .eyebrow{display:block;font-family:var(--f-num);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--red-hi,#e2472c);margin-bottom:4px}
.acc-logo{width:52px;height:52px;flex:none}
.acc-x{background:none;border:0;color:var(--muted);font-size:22px;line-height:1;padding:2px 6px;cursor:pointer}
.acc form{display:flex;flex-direction:column;gap:12px;margin:0}
.acc .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:420px){.acc .two{grid-template-columns:1fr}}
.acc input[type=text],.acc input[type=email],.acc input[type=password]{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px;color:var(--fg);font-size:16px}
.acc input:focus{outline:2px solid var(--red-hi,#e2472c);outline-offset:1px}
.acc .hint{font-size:12px;color:var(--muted);margin:0}
.acc .otp{font-family:var(--f-num);font-size:34px;letter-spacing:.5em;text-align:center;padding:12px 0 12px .5em!important}
.acc .chk{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--muted)}
.acc .chk input{margin-top:3px;width:18px;height:18px;flex:none}
.acc .btn{width:100%;padding:12px 14px}
.acc .links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:13px}
.acc .lnk{background:none;border:0;padding:0;color:var(--fg);text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:13px}
.acc .lnk:disabled{color:var(--muted);text-decoration:none;cursor:default}
.acc .err:empty,.acc .ok:empty{display:none}
.acc .ok{font-size:13px;color:var(--ok)}
.acc .eye{position:relative}
.acc .eye input{padding-right:64px}
.acc .eye button{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;color:var(--muted);font-size:12px;font-family:var(--f-num);letter-spacing:.1em;text-transform:uppercase;cursor:pointer}
.acc-user{display:inline-flex;align-items:center;gap:8px}
a.btn{color:inherit;text-decoration:none;display:inline-flex;align-items:center}
`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  let back = null, view = null, ctx = {email:"", mode:"signup", sentAt:0, fails:0}, timer = null;
  const $a = id => back && back.querySelector("#" + id);

  function passField(id, label, auto){
    return `<div class="field"><label for="${id}">${label}</label><div class="eye"><input id="${id}" type="password" autocomplete="${auto}" maxlength="${R.passMax}" required><button type="button" data-eye="${id}">Ver</button></div></div>`;
  }
  const VIEWS = {
    login: () => ({eyebrow:"Liga Commander El Desafío", title:"Entrar", body:`
      <form id="fLogin" novalidate>
        <div class="field"><label for="aEmail">Correo</label><input id="aEmail" type="email" autocomplete="email" inputmode="email" value="${esc(ctx.email)}" required></div>
        ${passField("aPass", "Contraseña", "current-password")}
        <span class="err" id="aErr"></span>
        <button class="btn primary" type="submit">Entrar</button>
      </form>
      <div class="links"><button class="lnk" type="button" data-go="signup">Crear cuenta</button><button class="lnk" type="button" data-go="forgot">Olvidé mi contraseña</button></div>`}),
    signup: () => ({eyebrow:"Portal de jugadores", title:"Crear cuenta", body:`
      <form id="fSignup" novalidate>
        <div class="two">
          <div class="field"><label for="aFirst">Nombre</label><input id="aFirst" type="text" autocomplete="given-name" maxlength="${R.nombreMax}" required></div>
          <div class="field"><label for="aLast">Apellido</label><input id="aLast" type="text" autocomplete="family-name" maxlength="${R.nombreMax}" required></div>
        </div>
        <div class="field"><label for="aNick">Apodo (opcional)</label><input id="aNick" type="text" autocomplete="nickname" maxlength="${R.apodoMax}"></div>
        <div class="field"><label for="aEmail">Correo</label><input id="aEmail" type="email" autocomplete="email" inputmode="email" value="${esc(ctx.email)}" required></div>
        ${passField("aPass", "Contraseña", "new-password")}
        ${passField("aPass2", "Repite la contraseña", "new-password")}
        <p class="hint">Mínimo ${R.passMin} caracteres, con al menos una letra y un número.</p>
        <label class="chk"><input id="aOk" type="checkbox"> <span>Acepto que la liga use mi nombre, correo y resultados para gestionar inscripciones, mesas y estadísticas. Mi correo no se muestra a otros jugadores.</span></label>
        <span class="err" id="aErr"></span>
        <button class="btn primary" type="submit">Crear cuenta</button>
      </form>
      <div class="links"><button class="lnk" type="button" data-go="login">Ya tengo cuenta</button></div>`}),
    code: () => ({eyebrow: ctx.mode === "recovery" ? "Recuperar contraseña" : "Verifica tu correo", title:"Ingresa el código", body:`
      <p class="hint" style="font-size:14px">Te enviamos un código de ${R.codigoLargo} dígitos a <b style="color:var(--fg)">${esc(ctx.email)}</b>. Vence en ${R.codigoMin} minutos. Si no lo ves, revisa spam.</p>
      <form id="fCode" novalidate>
        <input id="aCode" class="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="${R.codigoLargo}" pattern="[0-9]*" aria-label="Código de ${R.codigoLargo} dígitos" required>
        <span class="err" id="aErr"></span><span class="ok" id="aOk"></span>
        <button class="btn primary" id="aVerify" type="submit">Verificar</button>
      </form>
      <div class="links"><button class="lnk" type="button" id="aResend" data-resend>Reenviar código</button><button class="lnk" type="button" data-go="${ctx.mode === "recovery" ? "forgot" : "signup"}">Cambiar correo</button></div>`}),
    forgot: () => ({eyebrow:"Recuperar contraseña", title:"¿Olvidaste tu contraseña?", body:`
      <p class="hint" style="font-size:14px">Escribe tu correo y te enviaremos un código para crear una contraseña nueva.</p>
      <form id="fForgot" novalidate>
        <div class="field"><label for="aEmail">Correo</label><input id="aEmail" type="email" autocomplete="email" inputmode="email" value="${esc(ctx.email)}" required></div>
        <span class="err" id="aErr"></span>
        <button class="btn primary" type="submit">Enviar código</button>
      </form>
      <div class="links"><button class="lnk" type="button" data-go="login">Volver</button></div>`}),
    newpass: () => ({eyebrow:"Recuperar contraseña", title:"Crea tu contraseña nueva", body:`
      <form id="fNew" novalidate>
        ${passField("aPass", "Contraseña nueva", "new-password")}
        ${passField("aPass2", "Repite la contraseña", "new-password")}
        <p class="hint">Mínimo ${R.passMin} caracteres, con al menos una letra y un número.</p>
        <span class="err" id="aErr"></span>
        <button class="btn primary" type="submit">Guardar y entrar</button>
      </form>`, noClose:true})
  };

  function show(v){
    view = v;
    if (!back){
      back = document.createElement("div"); back.className = "acc-back";
      back.addEventListener("click", onClick); back.addEventListener("submit", onSubmit);
      back.addEventListener("input", e => { if (e.target.id === "aCode") e.target.value = e.target.value.replace(/\D/g, "").slice(0, R.codigoLargo); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && back && !back.hidden && !VIEWS[view]().noClose && Auth.closable) close(); });
      document.body.appendChild(back);
    }
    const d = VIEWS[v]();
    back.hidden = false;
    back.innerHTML = `<div class="acc" role="dialog" aria-modal="true" aria-labelledby="accTitle"><div class="acc-h"><img class="acc-logo" src="logo-256.png" alt="" width="52" height="52"><div style="flex:1;min-width:0"><span class="eyebrow">${d.eyebrow}</span><h2 id="accTitle">${d.title}</h2></div>${d.noClose || !Auth.closable ? "" : '<button class="acc-x" type="button" data-close aria-label="Cerrar">×</button>'}</div>${d.body}</div>`;
    clearInterval(timer);
    if (v === "code"){ timer = setInterval(tickResend, 500); tickResend(); }
    const first = back.querySelector("input:not([type=checkbox])"); if (first) setTimeout(() => first.focus(), 30);
  }
  function close(){ if (back) back.hidden = true; clearInterval(timer); }
  const setErr = t => { const e = $a("aErr"); if (e) e.textContent = t || ""; };
  const busy = (form, on) => { const b = form && form.querySelector("button[type=submit]"); if (b){ b.disabled = on; b.dataset.label = b.dataset.label || b.textContent; b.textContent = on ? "Un momento…" : b.dataset.label; } };

  function tickResend(){
    const b = $a("aResend"); if (!b) return;
    const left = Math.ceil((ctx.sentAt + R.reenvioSeg * 1000 - Date.now()) / 1000);
    b.disabled = left > 0; b.textContent = left > 0 ? `Reenviar código en ${left} s` : "Reenviar código";
    const expired = ctx.sentAt && Date.now() - ctx.sentAt > R.codigoMin * 60000;
    const v = $a("aVerify");
    if (v && (ctx.fails >= R.codigoIntentos || expired)){
      v.disabled = true;
      const e = $a("aErr"); if (e && !e.dataset.locked){ e.dataset.locked = "1"; e.textContent = expired ? "El código venció. Pide uno nuevo." : `Fallaste ${R.codigoIntentos} veces. Pide un código nuevo.`; }
    }
  }

  // Bloqueo de 15 min tras 5 intentos fallidos de entrar (en este equipo)
  const lockKey = email => "desafio-login-" + email;
  function lockedFor(email){ const l = store.get(lockKey(email)); return l && l.until > Date.now() ? Math.ceil((l.until - Date.now()) / 60000) : 0; }
  function failLogin(email){
    const l = store.get(lockKey(email)) || {n:0, until:0};
    l.n = (l.until && l.until <= Date.now()) ? 1 : l.n + 1;
    if (l.n >= R.loginIntentos){ l.until = Date.now() + R.bloqueoMin * 60000; l.n = 0; }
    store.set(lockKey(email), l);
    return l.until > Date.now();
  }

  async function sendCode(){
    if (ctx.mode === "recovery") return sb.auth.resetPasswordForEmail(ctx.email);
    return sb.auth.resend({type:"signup", email:ctx.email});
  }
  function toCode(mode, email){
    ctx = {email, mode, sentAt:Date.now(), fails:0};
    store.set("desafio-pend", {email, mode, at:ctx.sentAt});
    show("code");
  }
  const done = () => { store.del("desafio-pend"); close(); location.reload(); };

  async function onSubmit(e){
    e.preventDefault();
    const f = e.target; setErr("");
    if (!sb) return setErr("No se pudo conectar con el servidor.");
    if (f.id === "fLogin"){
      const email = clean($a("aEmail").value).toLowerCase(), pass = $a("aPass").value;
      ctx.email = email;
      if (!EMAIL_RE.test(email)) return setErr("Escribe un correo válido.");
      if (!pass) return setErr("Escribe tu contraseña.");
      const m = lockedFor(email); if (m) return setErr(`Demasiados intentos. Espera ${m} min o recupera tu contraseña.`);
      busy(f, true);
      const {error} = await sb.auth.signInWithPassword({email, password:pass});
      busy(f, false);
      if (!error) return done();
      if (error.code === "email_not_confirmed"){
        const r = await sb.auth.resend({type:"signup", email});
        if (r.error) return setErr(friendly(r.error));
        return toCode("signup", email);
      }
      if (error.code === "invalid_credentials" || /invalid login/i.test(error.message || "")){
        return setErr(failLogin(email) ? `Demasiados intentos. Espera ${R.bloqueoMin} min o recupera tu contraseña.` : "Correo o contraseña incorrectos.");
      }
      return setErr(friendly(error));
    }
    if (f.id === "fSignup"){
      const first = clean($a("aFirst").value), last = clean($a("aLast").value), nick = clean($a("aNick").value);
      const email = clean($a("aEmail").value).toLowerCase(), p1 = $a("aPass").value, p2 = $a("aPass2").value;
      ctx.email = email;
      const nameErr = (v, what) => v.length < R.nombreMin || v.length > R.nombreMax ? `El ${what} debe tener entre ${R.nombreMin} y ${R.nombreMax} caracteres.` : !NOMBRE_RE.test(v) ? `El ${what} solo puede tener letras, espacios, guion o apóstrofo.` : "";
      const err = nameErr(first, "nombre") || nameErr(last, "apellido") ||
        (nick && (nick.length < R.apodoMin || nick.length > R.apodoMax) ? `El apodo debe tener entre ${R.apodoMin} y ${R.apodoMax} caracteres.` : "") ||
        (!EMAIL_RE.test(email) ? "Escribe un correo válido." : "") ||
        checkPass(p1) || (p1 !== p2 ? "Las contraseñas no coinciden." : "") ||
        (!$a("aOk").checked ? "Debes aceptar el uso de tus datos para la liga." : "");
      if (err) return setErr(err);
      busy(f, true);
      const {error} = await sb.auth.signUp({email, password:p1, options:{data:{nombre:first, apellido:last, apodo:nick || null}}});
      busy(f, false);
      if (error) return setErr(friendly(error));
      return toCode("signup", email);
    }
    if (f.id === "fCode"){
      const token = $a("aCode").value.trim();
      if (!new RegExp(`^\\d{${R.codigoLargo}}$`).test(token)) return setErr(`El código tiene ${R.codigoLargo} dígitos.`);
      if (ctx.fails >= R.codigoIntentos) return setErr("Pide un código nuevo.");
      busy(f, true);
      let r = await sb.auth.verifyOtp({email:ctx.email, token, type: ctx.mode === "recovery" ? "recovery" : "email"});
      if (r.error && ctx.mode !== "recovery") r = await sb.auth.verifyOtp({email:ctx.email, token, type:"signup"});
      busy(f, false);
      if (r.error){
        ctx.fails++;
        const left = R.codigoIntentos - ctx.fails;
        $a("aCode").value = "";
        setErr(left > 0 ? `${friendly(r.error)} Te quedan ${left} ${left === 1 ? "intento" : "intentos"}.` : `Fallaste ${R.codigoIntentos} veces. Pide un código nuevo.`);
        tickResend(); return;
      }
      if (ctx.mode === "recovery"){ store.del("desafio-pend"); return show("newpass"); }
      return done();
    }
    if (f.id === "fForgot"){
      const email = clean($a("aEmail").value).toLowerCase(); ctx.email = email;
      if (!EMAIL_RE.test(email)) return setErr("Escribe un correo válido.");
      busy(f, true);
      const {error} = await sb.auth.resetPasswordForEmail(email);
      busy(f, false);
      if (error) return setErr(friendly(error));
      return toCode("recovery", email);
    }
    if (f.id === "fNew"){
      const p1 = $a("aPass").value, p2 = $a("aPass2").value;
      const err = checkPass(p1) || (p1 !== p2 ? "Las contraseñas no coinciden." : "");
      if (err) return setErr(err);
      busy(f, true);
      const {error} = await sb.auth.updateUser({password:p1});
      busy(f, false);
      if (error) return setErr(friendly(error));
      store.del(lockKey(ctx.email));
      return done();
    }
  }
  async function onClick(e){
    const t = e.target;
    if (t === back && Auth.closable && !VIEWS[view]().noClose) return close();
    if (t.closest("[data-close]")) return close();
    const eye = t.closest("[data-eye]");
    if (eye){ const i = $a(eye.dataset.eye); i.type = i.type === "password" ? "text" : "password"; eye.textContent = i.type === "password" ? "Ver" : "Ocultar"; return; }
    const go = t.closest("[data-go]");
    if (go){ const em = $a("aEmail"); if (em) ctx.email = clean(em.value).toLowerCase(); return show(go.dataset.go); }
    if (t.closest("[data-resend]")){
      const b = $a("aResend"); b.disabled = true; setErr("");
      const {error} = await sendCode();
      if (error){ setErr(friendly(error)); tickResend(); return; }
      ctx.sentAt = Date.now(); ctx.fails = 0;
      store.set("desafio-pend", {email:ctx.email, mode:ctx.mode, at:ctx.sentAt});
      const er = $a("aErr"); if (er) delete er.dataset.locked;
      const v = $a("aVerify"); if (v) v.disabled = false;
      const ok = $a("aOk"); if (ok) ok.textContent = "Te enviamos un código nuevo. El anterior ya no sirve.";
      tickResend();
    }
  }

  /* ---------- API pública de cuenta ---------- */
  const Auth = {
    closable: true,
    open(v){
      // Si quedó un código pendiente (se recargó la página), vuelve a esa pantalla
      const p = store.get("desafio-pend");
      if ((!v || v === "login") && p && Date.now() - p.at < R.codigoMin * 60000){ ctx = {email:p.email, mode:p.mode, sentAt:p.at, fails:0}; return show("code"); }
      show(v || "login");
    },
    close,
    async logout(){ if (sb) await sb.auth.signOut(); location.reload(); }
  };
  window.Auth = Auth;

  /* ---------- Base de datos con la interfaz de la página ---------- */
  // tabla → columna clave y forma de guardar el documento
  const T = {
    liga:          {key:"id",      shape:"data"},
    historial:     {key:"id",      shape:"data"},
    votos:         {key:"user_id", shape:"data"},
    inscripciones: {key:"user_id", shape:"data"},
    contactos:     {key:"id",      shape:"data"},   // correos de jugadores: solo organizadores
    vinculos:      {key:"user_id", shape:"cols", scoped:true}
  };
  T.votos.scoped = true; T.inscripciones.scoped = true;
  let LIGA_ID = "precon";   // vínculos, votos e inscripciones son por liga (columna "liga")
  const toRow = (t, id, obj) => Object.assign(T[t].shape === "cols"
    ? {[T[t].key]:id, pid:obj.pid, deck:obj.deck == null ? null : obj.deck, actualizado:new Date().toISOString()}
    : {[T[t].key]:id, data:obj}, T[t].scoped ? {liga: LIGA_ID} : {});
  const fromRow = (t, row) => {
    if (T[t].shape === "cols"){ const o = {pid:row.pid}; if (row.deck != null) o.deck = row.deck; return o; }
    return row.data;
  };
  const watch = {}; // tabla → {rows:Map, subs:[], loading, timer}
  async function load(t){
    const w = watch[t]; if (!w) return;
    let q = sb.from(t).select("*"); if (T[t].scoped) q = q.eq("liga", LIGA_ID);
    const {data, error} = await q;
    if (error){ w.subs.forEach(s => s.err && s.err(error)); return; }
    w.rows = new Map((data || []).map(r => [String(r[T[t].key]), fromRow(t, r)]));
    w.subs.forEach(s => { try { s.cb(w.rows); } catch(e){ console.error(e); } });
  }
  const reload = t => { const w = watch[t]; if (!w) return; clearTimeout(w.timer); w.timer = setTimeout(() => load(t), 150); };
  let channel = null;
  function ensureChannel(){
    if (channel) return;
    channel = sb.channel("liga-desafio");
    Object.keys(T).forEach(t => channel.on("postgres_changes", {event:"*", schema:"public", table:t}, () => reload(t)));
    channel.subscribe();
    // Respaldo por si el tiempo real se corta: refresca cada 20 s y al volver a la pestaña
    setInterval(() => Object.keys(watch).forEach(reload), 20000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) Object.keys(watch).forEach(reload); });
  }
  function subscribe(t, cb, err){
    if (!T[t]) throw new Error("Tabla desconocida: " + t);
    ensureChannel();
    const w = watch[t] || (watch[t] = {rows:null, subs:[], timer:0});
    const s = {cb, err}; w.subs.push(s);
    if (w.rows) cb(w.rows); else reload(t);
    return () => { w.subs = w.subs.filter(x => x !== s); };
  }
  async function mustOk(p){ const {error} = await p; if (error) throw new Error(friendly(error)); }
  const db = {
    doc(path){
      const [t, id] = path.split("/");
      return {
        async set(obj){ await mustOk(sb.from(t).upsert(toRow(t, id, obj), T[t].scoped ? {onConflict: T[t].key + ",liga"} : undefined)); reload(t); },
        async delete(){ let q = sb.from(t).delete().eq(T[t].key, id); if (T[t].scoped) q = q.eq("liga", LIGA_ID); await mustOk(q); reload(t); },
        onSnapshot(cb, err){ return subscribe(t, rows => { const v = rows.get(id); cb({exists: v != null, data: () => v}); }, err); }
      };
    },
    collection(t){
      return { onSnapshot(cb, err){ return subscribe(t, rows => cb({docs: Array.from(rows, ([id, v]) => ({id, data: () => v}))}), err); } };
    }
  };

  /* ---------- Sesión y perfil ---------- */
  async function connect(liga){
    if (!sb) return null;
    if (liga) LIGA_ID = liga;
    const {data:{session}} = await sb.auth.getSession();
    const u = session && session.user;
    let admin = false, perfil = null;
    if (u){
      const [a, p] = await Promise.all([
        sb.rpc("es_admin"),
        sb.from("perfiles").select("nombre,apellido,apodo").eq("id", u.id).maybeSingle()
      ]);
      admin = !!(a && a.data);
      perfil = p && p.data || null;
    }
    // Si la sesión se cierra en otra pestaña, recarga para quedar sin datos privados
    sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT" && u) location.reload(); });
    const user = {
      isOwner: async () => admin,
      canEdit: async () => admin,
      id: async () => u ? u.id : null,
      email: async () => u ? (u.email || "").toLowerCase() : null,
      async allProfiles(){
        const {data, error} = await sb.from("perfiles").select("id,nombre,apellido");
        if (error) throw error;
        return data || [];
      },
      async profiles(ids){
        const out = {};
        const {data} = await sb.from("perfiles").select("id,nombre,apellido,apodo").in("id", ids);
        (data || []).forEach(p => out[p.id] = {name: (p.nombre + " " + p.apellido).trim() + (p.apodo ? ` (${p.apodo})` : "")});
        return out;
      }
    };
    return {db, user, session, perfil, admin};
  }
  window.Conexion = {connect, ready: !!sb};
})();
