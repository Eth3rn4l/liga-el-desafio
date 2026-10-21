# Bot de WhatsApp · Liga Commander El Desafío

Publica solo en los grupos de WhatsApp de la liga:

- **las mesas de cada ronda** al presionar **Iniciar ronda**, como imágenes con el diseño de la página (una imagen cada 4 mesas: 8 mesas = 2 imágenes),
- el resultado de cada mesa cuando se cierra (y las correcciones),
- el standing tras cada ronda (solo el top que tengan configurado),
- el resumen final al presionar **Cerrar liga**: podio, más kills y comandante más letal.

Solo **lee** la liga; no puede cambiar nada.

> Usa un número de WhatsApp aparte para el bot. Es una herramienta no oficial y WhatsApp podría bloquear ese número.

## Lo que necesitas

- Un PC o notebook con Windows que quede **prendido y con internet** mientras dure la liga.
- **Node.js** (versión LTS): descárgalo de https://nodejs.org e instálalo con las opciones por defecto.
- El celular con el WhatsApp del bot, **agregado a los grupos** de la liga.

## Instalación (una sola vez)

1. Descomprime la carpeta del bot, por ejemplo en `Documentos\bot-liga`.
2. Doble clic en **1-INSTALAR.bat** y espera a que diga *Listo* (tarda unos minutos).
3. Doble clic en **2-VINCULAR-Y-VER-GRUPOS.bat**. Aparece un código QR:
   en el celular del bot, **WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo** y escanéalo.
   Al terminar, la ventana muestra la lista de grupos.
4. Abre `config.json` con el Bloc de notas y escribe el nombre exacto de cada grupo:
   ```
   "grupos": {
     "precon": "Liga Precon El Desafío",
     "b3": "Liga B3 El Desafío"
   },
   ```
   En vez del nombre también puedes pegar el **link de invitación** del grupo (`https://chat.whatsapp.com/...`); sirve si la lista de grupos no aparece.
   Si una liga no tiene grupo, deja `""`. Guarda el archivo.
5. Doble clic en **3-PROBAR.bat**: debe llegar “🤖 Bot de la liga conectado…” a los grupos.

## Cada día de liga

Doble clic en **INICIAR-BOT.bat** y deja esa ventana abierta (puedes minimizarla).

Al abrirlo pregunta:

1. **Qué liga va a manejar**: 1 Precon, 2 Bracket 3 o 3 las dos. Solo publica lo de esa liga.
2. **Si manda ahora el mensaje para inscribirse** (S/N): manda al grupo el aviso de inscripciones abiertas con el link, si la fecha está en inscripciones.

Si el bot se reinicia solo, mantiene la liga elegida y no repite el mensaje de inscripción.

- Si se cae o se corta internet, se vuelve a abrir solo a los 15 segundos.
- Si lo abres con la fecha ya empezada, **no repite** lo que ya pasó.
- Para detenerlo, cierra la ventana.
- El PC no debe suspenderse: el bot desactiva la suspensión mientras está enchufado, pero revisa que no se apague la tapa del notebook (Configuración → Energía → “Al cerrar la tapa: no hacer nada”).

## Comandos del bot (en la ventana negra)

Con el bot andando, escribe en su ventana y presiona **Enter**.

**Menú principal:** aparecen todos los grupos de WhatsApp donde está el bot (los de la liga primero, marcados con ★).
El chat de testeo (el de `precon_test` / `b3_test` en config.json) aparece marcado **★ TESTEO**: sirve para probar un mensaje
antes de mandarlo al grupo real. En config.json puede ser el nombre de un grupo, su link de invitación o un **número de teléfono**
(por ejemplo `"precon_test": "+56912345678"`) para que llegue a un chat personal.
Escribe el número del grupo para entrar. Además:

- **P**: pausa / reanuda los mensajes automáticos
- **E**: muestra cómo va la fecha (ronda, mesas reportadas, mensajes en espera)
- **R**: vuelve a cargar la lista de grupos (por si agregaste el bot a un grupo nuevo)
- **0**: muestra el menú otra vez

**Dentro de un grupo**, eliges qué mandar:

| N° | Qué manda |
|---|---|
| 1 | Las mesas de la ronda actual (imágenes) |
| 2 | Las mesas de la ronda actual (texto) |
| 3 | El mensaje para inscribirse |
| 4 | Los resultados de las mesas ya reportadas de la ronda actual |
| 5 | El standing (pregunta cuántos jugadores mostrar) |
| 6 | El podio (si la fecha aún no se cierra, sale como "Podio parcial") |
| 7 | Un mensaje que escribes tú (para varias líneas, termina con una línea con solo un punto `.`) |
| 8 | Una imagen de la carpeta **imagenes-para-enviar** (ya viene el *Código de la Mesa*; puedes agregar más) |
| 0 | Volver al menú principal |

Antes de enviar, el bot muestra una vista previa y pregunta **s/n**. Después de enviar sigues dentro del mismo grupo,
así puedes mandar varias cosas seguidas; con **0** vuelves al menú principal.
Si el grupo no es de una liga, el bot pregunta de qué liga sacar los datos (mesas, standing, etc.).
Si mandas las mesas a mano al grupo de la liga, el bot no las vuelve a mandar solo al partir la ronda.

## Probar sin WhatsApp

En una ventana de comandos dentro de la carpeta: `npm run simular`.
Muestra lo que publicaría con la liga real, sin enviar nada. Las imágenes quedan en la carpeta `salida`.

## Problemas comunes

- **Pide el QR de nuevo**: la sesión se cerró desde el celular. Abre 2-VINCULAR-Y-VER-GRUPOS.bat y escanéalo otra vez.
- **“No encontré el grupo”**: el nombre en `config.json` no es exacto. Cópialo tal cual de la lista.
- **Deja de funcionar tras una actualización de WhatsApp**: en una ventana de comandos dentro de la carpeta, `npm install whatsapp-web.js@latest`.
- **Nunca compartas la carpeta `sesion-whatsapp`**: es la sesión abierta del WhatsApp del bot.

## En un servidor Linux (opcional)

`bash instalar-servidor.sh` instala todo en Ubuntu (por ejemplo Oracle Cloud) y deja el bot listo para `pm2`.
