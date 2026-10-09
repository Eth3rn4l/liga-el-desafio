# Bot de WhatsApp · Liga Commander El Desafío

Publica solo en los grupos de WhatsApp:

- las mesas de cada ronda cuando se arman,
- el resultado de cada mesa cuando se cierra (y las correcciones),
- el standing tras cada ronda (solo el top que tengan configurado),
- el resumen final al presionar **Cerrar liga**: podio, más kills y comandante más letal.

Solo **lee** la liga con la clave pública; no puede cambiar nada.

> **Importante:** usa un número de WhatsApp aparte para el bot (un chip prepago).
> Es una herramienta no oficial: WhatsApp podría bloquear ese número. Así no arriesgas tu número personal.

## Lo que necesitas

- Un computador que quede prendido durante la liga (Windows, Mac o Linux).
- **Node.js 18 o más nuevo**: descárgalo de https://nodejs.org (versión LTS) e instálalo con las opciones por defecto.
- Un celular con el WhatsApp del número del bot, agregado a los grupos de la liga.

## Instalación (una sola vez)

1. Descomprime la carpeta `bot` donde quieras (por ejemplo en el Escritorio).
2. Abre una terminal **dentro de esa carpeta**:
   - Windows: abre la carpeta, haz clic en la barra de direcciones, escribe `cmd` y presiona Enter.
   - Mac: clic derecho en la carpeta → *Nuevo terminal en la carpeta*.
3. Instala lo necesario (tarda unos minutos):
   ```
   npm install
   ```
4. Copia `config.ejemplo.json` y renómbrala `config.json`.
5. Vincula WhatsApp y mira los nombres de tus grupos:
   ```
   npm run grupos
   ```
   Aparece un código QR. En el celular del bot: **WhatsApp → Dispositivos vinculados → Vincular un dispositivo** y escanéalo.
   Al terminar, la terminal muestra la lista de grupos.
6. Abre `config.json` con el Bloc de notas y pon el nombre exacto de cada grupo en `"precon"` y `"b3"`.
   Si una liga no tiene grupo, deja `""`.
7. Prueba:
   ```
   npm run prueba
   ```
   Debe llegar “🤖 Bot de la liga conectado…” a los grupos.

## Cada día de liga

En la carpeta del bot:
```
npm start
```
Deja la ventana abierta mientras dure la liga. Para detenerlo: `Ctrl + C`.

- Si lo abres con la fecha ya empezada, **no repite** lo que ya pasó: publica desde ese momento.
- Si se cae y lo vuelves a abrir, publica lo que se perdió mientras estuvo cerrado.
- El resumen final sale cuando el organizador presiona **Cerrar liga**.

## Probar sin WhatsApp

```
npm run simular
```
Muestra en pantalla lo que publicaría con la liga real, sin enviar nada.

## Problemas comunes

- **Pide el QR de nuevo**: la sesión se cerró desde el celular. Escanéalo otra vez.
- **“No encontré el grupo”**: el nombre en `config.json` no es exacto. Usa `npm run grupos`.
- **Deja de funcionar tras una actualización de WhatsApp**: actualiza la librería con `npm install whatsapp-web.js@latest`.
- Nunca compartas la carpeta `sesion-whatsapp`: es la sesión abierta del número del bot.
