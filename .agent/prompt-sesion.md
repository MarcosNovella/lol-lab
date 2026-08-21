# Prompt de arranque — sesiones de trabajo

Para retomar el proyecto. Copiá todo lo que está debajo de la línea y pegalo en un chat nuevo.

> No confundir con `prompt-planificacion.md`, que es el de la sesión de diseño del 2026-08-16
> y **quedó obsoleto**: contiene el diagnóstico "estoy arriba en 17 de 18 métricas, mi fuga
> no está en la línea", que esa misma sesión refutó. Volver a pegarlo reinyecta la conclusión
> equivocada. Se conserva como registro histórico, no para usar.

**Este prompt a propósito NO repite el contexto del proyecto.** Apunta a los archivos, porque
contexto duplicado es contexto que se desactualiza y después miente.

---

Retomamos el proyecto de LoL en `~/Documents/lol-lab`.

## Antes de tocar nada, leé en este orden

1. `.agent/state.md` — dónde quedamos.
2. `.agent/roadmap.md` — qué sigue. **§1 es time-critical**, **§4 es dónde la sesión anterior
   cree que se equivocó** (discutilo, no lo heredes), **§5b es la regla de cuentas**.
3. `.agent/guardrails.md` — antes de escribir código.
4. `.agent/decisions.md` — solo los ADR que toquen lo que vayas a hacer.
5. `.agent/journal.md` — solo si necesitás el detalle de una sesión anterior.

El plan aprobado está en `~/.claude/plans/lol-lab-plan.md`.

## Chequeos de arranque

- `riot_key_status` — la key de desarrollo caduca cada 24 h y bloquea cualquier sync.
- `git status` y `git log --oneline -5`.
- ¿Jugué partidas nuevas desde el último sync?

## Lo primero que quiero: una auditoría

**Antes de construir nada**, decime en una pantalla o menos:

**1. Qué está mal.** Inconsistencias entre archivos, cosas a medio hacer, afirmaciones que no
se sostienen, código que no hace lo que dice su comentario, tests que pinean algo que ya no
queremos.

**2. Qué se podría hacer mejor.** Decisiones ya tomadas que hoy tomarías distinto, y por qué.
Incluí ideas que no se me ocurrieron a mí.

**3. Qué afirmación heredaste sin verificar.** Recorré lo que los archivos dan por cierto y
marcá lo que estás creyendo porque está escrito y no porque lo comprobaste. Este proyecto ya
perdió una sesión entera por eso.

Formato por punto: **qué**, **dónde** (`archivo:línea`), y **tu recomendación explícita** —
cambiarlo o dejarlo, con el porqué. Ordenalo por si cambia o no lo que vamos a construir.

**Si no encontrás nada que valga la pena, decí "nada" y seguimos.** No rellenes. Una auditoría
que siempre encuentra cinco cosas es ruido y deja de servir.

Después de la auditoría, esperá mi OK antes de empezar a construir.

## Cómo quiero que trabajes

- **No heredes conclusiones: verificalas.** El error más caro de este proyecto fue arrastrar
  "estoy arriba en 17 de 18 métricas" hasta que alguien miró los datos y resultó ser un
  artefacto de promediar palizas. Si te vas a apoyar en un número, corré la consulta.
- **Discutime.** Si te pido algo que te parece mal, decímelo una vez, claro, y después hacé lo
  que yo decida. Las mejores decisiones de este proyecto salieron de que me discutas — la
  regla de cuentas cambió tres veces así y terminó mejor que como arrancó.
- **n chico se declara.** Efecto y n siempre, nunca p-valores. A n=20 no hay conclusiones, hay
  candidatos, y se registran como hipótesis fechadas.
- **Anti-fragilidad (§5 del harness)**: error → causa raíz en una línea → regla nueva en
  `guardrails.md` → recién ahí el fix.
- **`pnpm verify` verde** antes de decir que algo está hecho. R7: un test no se ablanda para
  que pase; si el test afirma el contrato viejo, se le hace afirmar el nuevo, que cubre más.
- Castellano conmigo. Inglés en código, comentarios, commits y `.agent/`.
- Actualizá `state.md` en cada milestone, no solo al final.

## Qué no hace falta que me re-expliques

Ya está decidido y vive en los archivos: la arquitectura de tres capas, la clase
`contamination`, que el conocimiento se acumula entre cuentas y el rendimiento no, y que no
quiero dashboard. Si querés cambiar algo de eso, **proponelo como cambio con su porqué** — no
lo vuelvas a derivar desde cero ni lo des por no decidido.
