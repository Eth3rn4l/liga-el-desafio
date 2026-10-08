# Liga Commander · El Desafío

Plataforma web para las ligas semanales de **Magic: The Gathering – Commander** de Cafetería El Desafío — **Liga Precon** (sábados, mazos preconstruidos) y **Liga Bracket 3** (jueves, mazos propios) — reloj de rondas, mesas, standing en vivo, cuentas de jugadores con verificación por correo, estadísticas y sorteo.

**En producción:** https://liga-eldesafio.netlify.app · Portal de jugadores: https://liga-eldesafio.netlify.app/jugador.html

## Qué hace

**Dos ligas, un portal:** se cambia entre Liga Precon y Liga Bracket 3 desde el menú (☰). Cada liga tiene su propia fecha en curso, calendario, standing, sorteo y estadísticas. En Bracket 3 solo se declara el comandante (con aceptación de las reglas de construcción de la liga), buscado en vivo en la base de cartas de [Scryfall](https://scryfall.com) (siempre al día con las cartas nuevas).

**Para el organizador**
- Reloj de ronda en vivo (modo pantalla para TV) y control de rondas.
- Inscripción manual, en bloque o por los propios jugadores, con mazo precon y comandante elegidos desde un catálogo de ~180 precons.
- Armado de mesas de 4 (o 3) con tres sistemas: **Suizo**, **Suizo Desafío** (2 rondas al azar + suizo) y **Al azar**. Nunca junta comandantes iguales en una mesa y evita repetir rivales.
- Puntaje configurable (ganar, kill, sobrevivir, tope por mesa) y, en Bracket 3, los logros de la casa: *Muy joven para morir* (+1), *Demasiado bruto para jugar* (−2) y *No es tu lugar* (0 en la mesa) y desempate por **puntos → kills → Buchholz**.
- **Calendario de ligas mensuales**: se eligen los días de cada liga, su configuración, y se pueden mover fechas que no se pudieron jugar.
- **Warnings** por jugador (2 en una fecha = −2 puntos), corrección de estadísticas con registro de cambios, y borrado de datos con confirmación.
- **Sorteo** con ruleta animada, filtros combinables (fuera del top 4, 0 puntos, primera vez, sin premio en el mes, sin warnings…) y sin repetir ganadores.

**Para los jugadores (portal)**
- Cuenta propia con **verificación por código de 6 dígitos** al correo, recuperación de contraseña y reglas de seguridad básicas.
- Su mesa y rivales de la ronda, reporte del resultado desde el celular (la mesa se confirma sola cuando todos reportan lo mismo).
- Estadísticas personales: standing del mes, mazos y ediciones favoritas, rival más enfrentado, némesis y víctima favorita.

**Estadísticas de la liga:** standing mensual con bono por variedad de mazos, mazos y ediciones más jugados, ediciones que más ganan y comandantes con más kills.

## Tecnología

- **Frontend:** HTML, CSS y JavaScript sin frameworks (`web/`), publicado en **Netlify**.
- **Backend:** **Supabase** (PostgreSQL + Auth + Realtime). Toda la seguridad vive en políticas **RLS**: cualquiera puede ver la liga, solo los organizadores la modifican y cada jugador solo escribe sus propios datos.
- **Correo:** códigos OTP de Supabase Auth enviados por SMTP (Brevo).

```
web/
  index.html      página de la liga (organizador y pantalla)
  jugador.html    portal de jugadores
  conexion.js     cuentas (registro, código, login, recuperación) y acceso a datos
  config.js       URL y llave pública de Supabase
supabase/
  01_esquema.sql  tablas, trigger de perfiles y políticas RLS
  02_permisos.sql ajuste de permisos de lectura
  03_dos_ligas.sql separa vínculos, reportes e inscripciones por liga
```

## Montarlo desde cero

1. Crear un proyecto en Supabase y ejecutar en orden `supabase/01_esquema.sql`, `02_permisos.sql` y `03_dos_ligas.sql` en el SQL Editor.
2. En *Authentication → Email*: confirmar correo activado, código de 6 dígitos y expiración de 900 s; plantilla de correo con `{{ .Token }}`; SMTP propio configurado.
3. Poner la URL del proyecto y la llave *publishable* en `web/config.js` (es pública por diseño; la *secret key* nunca va en el frontend).
4. Publicar la carpeta `web/` en Netlify (o conectar este repositorio: `netlify.toml` ya apunta a `web`).
5. Crear la cuenta del organizador en el portal y darle permisos:
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'correo@ejemplo.cl';
   ```

## Autor

Desarrollado por **Diego Bahamondez** ([@Eth3rn4l](https://github.com/Eth3rn4l)) junto a Hans, organizador de la liga en Cafetería El Desafío.
