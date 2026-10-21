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
3. Doble clic en **2-VINCULAR-Y-VER-GRUPOS.bat**. El bot pide el **número del celular del bot**
   (por ejemplo `+56912345678`) y muestra un **código de 8 letras** (tipo `ABCD-EFGH`).
   En el celular del bot: **WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo →
   "Vincular con el número de teléfono"** (abajo) y escribe el código.
   El número queda guardado en `config.json` ("numeroBot"). Si prefieres el QR, presiona Enter sin escribir número.
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

El bot maneja las dos ligas a la vez y ya no pregunta nada al abrirse: en la ventana aparece el menú,
donde eliges el grupo, luego la liga (Precon o Bracket 3) y luego qué mandar (ver "Comandos del bot").
El mensaje para inscribirse se manda desde el menú (opción 3).

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

**Dentro de un grupo**, primero eliges la liga (**1) Liga Precon** o **2) Liga Bracket 3**; 0 vuelve al menú principal) y después qué mandar:

| N° | Qué manda |
|---|---|
| 1 | El mensaje para inscribirse |
| 2 | Las mesas de la ronda actual (imágenes) |
| 3 | El standing (pregunta cuántos jugadores mostrar) |
| 4 | Una imagen de la carpeta **imagenes-para-enviar** (ya viene el *Código de la Mesa*; puedes agregar más) |
| 0 | Volver |

Antes de enviar, el bot muestra una vista previa y pregunta **s/n**. Después de enviar sigues dentro del mismo grupo,
así puedes mandar varias cosas seguidas; con **0** vuelves al menú principal.
Si mandas las mesas a mano al grupo de la liga, el bot no las vuelve a mandar solo al partir la ronda.

## Probar sin WhatsApp

En una ventana de comandos dentro de la carpeta: `npm run simular`.
Muestra lo que publicaría con la liga real, sin enviar nada. Las imágenes quedan en la carpeta `salida`.

## Problemas comunes

- **Pide vincular de nuevo**: la sesión se cerró desde el celular. Abre 2-VINCULAR-Y-VER-GRUPOS.bat e ingresa el código nuevo que aparece.
- **“No encontré el grupo”**: el nombre en `config.json` no es exacto. Cópialo tal cual de la lista.
- **Deja de funcionar tras una actualización de WhatsApp**: en una ventana de comandos dentro de la carpeta, `npm install whatsapp-web.js@latest`.
- **Nunca compartas la carpeta `sesion-whatsapp`**: es la sesión abierta del WhatsApp del bot.

## En un servidor Linux (opcional)

`bash instalar-servidor.sh` instala todo en Ubuntu (por ejemplo Oracle Cloud) y deja el bot listo para `pm2`.
