# Plan de Implementación Estratégico — Herbal Moonlight
**Fecha:** 2026-02-19
**Propósito:** Limpiar el repo, sincronizar los dos frontends, aplicar todos los cambios acumulados,
y dejarlo listo para despliegue sin romper nada.


Claude, cambio de planes estratégico. La versión ganadora es la que está en herbal-moonlight-frontend. Es la más avanzada y visualmente superior. Vamos a limpiar el repositorio para que este sea el frontend principal y eliminaremos la redundancia de sgs_frontend para no confundir a los jueces.

OBJETIVO: Dejar un repositorio limpio donde solo existan los archivos necesarios para Herbal Moonlight (Front, Back y ZK).

TAREAS PASO A PASO:

Establecer el Front Principal:

Toma el contenido de herbal-moonlight-frontend y prepáralo para que sea la cara del proyecto.

Asegúrate de que las conexiones con el contrato en contracts/herbal-moonlight/lib.rs sean perfectas.

Mecánica "Ciega" y Fix de Daño (Crucial):

Verifica que en este frontend esté aplicada la Mecánica Ciega (la Criatura no ve plantas, solo siente el daño).

Aplica el fix de desenvuelto (unwrap) en herbalMoonlightService.ts para que el daño se registre correctamente y no devuelva siempre 0.

Limpieza de lo Obsoleto:

Eliminar sgs_frontend/: Ya no usaremos el catálogo multi-juego. Mueve cualquier asset útil que falte a la carpeta de nuestro juego y borra el resto.

Limpiar Raíz: Borra los archivos duplicados o viejos en root/public/assets/ (Background.png viejo, grilla-sinfondo, etc.).

Eliminar Juegos de Referencia: Borra las carpetas de contratos de dice-duel, number-guess y twenty-one para que el repo solo contenga herbal-moonlight y groth16-verifier.

Ajustes Finales de UX:

Asegúrate de que la Navbar profesional tenga el botón de conectar wallet y el switcher de jugadores arriba a la derecha.

El footer debe ser una sola línea limpia: 'Powered by ZK Magic & Stellar Game Studio'.

Verificación de Identidad:

Revisa los archivos en la carpeta docs/ (game-design.md, zk-implementation.md) para asegurar que el README final refleje exactamente la arquitectura que estamos dejando.

RESTRICCIÓN: No rompas la integración con el Game Hub (start_game / end_game). Es un requisito obligatorio de la hackatón.

Confirma cuando el repo esté limpio y el frontend avanzado sea el único que responda.

---

## DIAGNÓSTICO: Estado Actual

### El problema raíz
`bun run dev` sirve **`sgs_frontend/`** (puerto 3000).
Todos los cambios visuales de las últimas sesiones se aplicaron a **`herbal-moonlight-frontend/`**.

### Inventario de los dos frontends

| Aspecto | `herbal-moonlight-frontend/` | `sgs_frontend/` |
|---------|------------------------------|-----------------|
| Propósito | Standalone del juego (deploy independiente) | Catálogo multi-juego (lo que ve el usuario con `bun run dev`) |
| Componente principal | `HerbalMoonlightGame.tsx` (1720 líneas) | `index.tsx` (1575 líneas) |
| Cambios visuales | ✅ APLICADOS (dirt tiles, fog, shake, mensajes) | ❌ NO APLICADOS |
| Bug de daño (`revealCell`) | ❌ SIN CORREGIR | ❌ SIN CORREGIR |
| Assets del juego | `herbal-moonlight-frontend/public/assets/` ✅ | `sgs_frontend/public/assets/` ✅ |
| Assets del Layout | `herbal-moonlight-frontend/public/` ✅ | NO necesita extras ✅ |

### Lo que ya está bien (NO tocar)
- `sgs_frontend/public/assets/` → tiene `background.jpeg`, `creature.png`, `lavender.png`, `mint.png`, `mandrake.png` ✅
- `herbal-moonlight-frontend/public/` → assets completos del standalone ✅
- Infraestructura compartida (`hooks/`, `utils/`, `services/`) → funciona en ambos lados ✅
- Contrato Rust y bindings TypeScript → no tocar ✅
- El catálogo de otros juegos (`dice-duel`, `number-guess`, `twenty-one`) → no tocar ✅

### Duplicación intencional (NO limpiar)
Los `utils/`, `hooks/`, `services/` están copiados en ambos frontends. Eso es **diseño intencional** per `CLAUDE.md` — cada standalone es autosuficiente. No unificar.

---

## PASOS DE IMPLEMENTACIÓN

---

### PASO 1 — Limpiar `root/public/assets/` (confusión de assets)

**Problema:** Hay assets en el directorio raíz `public/assets/` que NO son servidos por ningún frontend (Vite de cada frontend sirve desde su propio `public/`). Existen ahí como artefactos de commits anteriores y crean confusión.

**Archivos involucrados:**
- `public/assets/Background.png` — NO USADO (reemplazó el `background.jpeg` que sí estaba aquí antes)
- `public/assets/Brujita1.png`, `Ghost-Photoroom.png`, `grilla-sinfondo.png`, `witch.png` — NO USADOS

**Acción:**
1. Verificar con `git log` qué introdujo estos archivos y si algún script los referencia
2. Si ningún script/componente los usa → agregar `public/assets/` al `.gitignore` o moverlos a `docs/assets/` si son para documentación
3. **No eliminar** `public/assets/lavender.png`, `mint.png`, `mandrake.png` hasta confirmar que ningún script de deploy los usa

**Riesgo:** BAJO — son assets sin referencias activas en código

---

### PASO 2 — Fix crítico: `revealCell()` en ambos servicios

**Problema:** `sentTx.result` devuelve un `Result<CellRevealResult>` (wrapper con `.isOk()/.unwrap()`), no el valor directo. Al acceder `.has_plant` o `.damage_dealt` sobre el wrapper, siempre es `undefined` → el daño nunca se muestra correctamente.

**Archivos a modificar:**

**A) `sgs_frontend/src/games/herbal-moonlight/herbalMoonlightService.ts`**
Método `revealCell()` — cambiar las últimas líneas de:
```typescript
const sentTx = await signAndSendViaLaunchtube(tx, ...);
return sentTx.result;
```
A:
```typescript
const sentTx = await signAndSendViaLaunchtube(tx, ...);
const raw = sentTx.result;
if (raw && typeof raw === 'object' && typeof (raw as any).isOk === 'function') {
  return (raw as any).isOk() ? (raw as any).unwrap() as CellRevealResult : null;
}
return raw as CellRevealResult | null;
```
Agregar `Promise<CellRevealResult | null>` como tipo de retorno explícito.

**B) `herbal-moonlight-frontend/src/games/herbal-moonlight/herbalMoonlightService.ts`**
Mismo fix exacto. Este archivo YA tiene el fix aplicado de sesiones anteriores — **verificar** que la versión en disco lo tiene, si no, aplicarlo igual.

**Riesgo:** BAJO — solo afecta el resultado que ve el componente, no la transacción en sí

---

### PASO 3 — Agregar animación `hm-boardShake` al CSS de sgs_frontend

**Archivo:** `sgs_frontend/src/index.css`

**Acción:** Agregar inmediatamente después del bloque `@keyframes hm-spin`:
```css
@keyframes hm-boardShake {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  15%      { transform: translate(-5px, -2px) rotate(-0.4deg); }
  30%      { transform: translate(5px, 2px) rotate(0.4deg); }
  45%      { transform: translate(-4px, 1px) rotate(-0.3deg); }
  60%      { transform: translate(4px, -1px) rotate(0.3deg); }
  75%      { transform: translate(-2px, 1px); }
}
```

**Riesgo:** NINGUNO — solo agrega CSS, no modifica nada existente

---

### PASO 4 — Aplicar cambios visuales a `sgs_frontend/src/games/herbal-moonlight/index.tsx`

Este es el paso más largo. El archivo tiene 1575 líneas. Los cambios son quirúrgicos y van sección por sección.

#### 4a — Agregar estado `boardShake`
En el bloque de estados (después de `const [gardenCommitment, ...]`), agregar:
```typescript
const [boardShake, setBoardShake] = useState(false);
```

#### 4b — Actualizar `BoardProps` interface
Agregar `boardShake?: boolean` a la interface `BoardProps` (línea ~102).

#### 4c — Actualizar firma de `HerbalMoonlightBoard`
Agregar `boardShake` al destructuring de props.

#### 4d — Reescribir `renderCell` dentro de `HerbalMoonlightBoard`
**Cambios exactos en `renderCell`:**

1. **Eliminar** la variable `revealed` (`const revealed = cellIsRevealed(...)`) — no se usa más en visuals
2. **Eliminar** `showFog` con su condición actual y reemplazar por:
   ```typescript
   // Fog of war total: creature ve niebla en TODOS los cells excepto fila de inicio y su posición actual
   const showFog = role === 'creature' && !isStartRow && !isCreature;
   ```
3. **Eliminar** la condición `(gardenerCanSee || (revealed && plantType > 0))` del bloque de imagen de planta. Reemplazar por:
   ```typescript
   // Solo el gardener ve sus propias plantas — nunca se revelan al creature
   const showPlant = role === 'gardener' && plantType > 0;
   ```
   Y mostrar el `<img>` del plant solo cuando `showPlant && plantInfo`.
4. **Eliminar** la opacidad condicional por `revealed` (simplificar a `opacity: isPlacementMode ? 0.9 : 0.45`)
5. **Eliminar** el bloque completo:
   ```tsx
   {revealed && plantType === 0 && !isCreature && (
     <div ...>{'\u2714'}</div>
   )}
   ```
6. **Eliminar** el `<span>` con coordenadas `{x},{y}` al final de cada celda
7. **Cambiar** el `background` de las celdas:
   - Celdas normales y fila de inicio (todo excepto houseRow): `'radial-gradient(ellipse at 28% 28%, rgba(80,52,30,0.55) 0%, transparent 65%), linear-gradient(135deg, #2a1d15 0%, #1e150f 100%)'`
   - Mantener el golden para `isHouseRow` como está
8. **Cambiar** el `border` de celdas normales de `'1px solid rgba(140,120,255,0.12)'` a `'1px solid rgba(201,168,76,0.15)'`

#### 4e — Aplicar boardShake al grid wrapper del board
En el `return` de `HerbalMoonlightBoard`, el div contenedor:
```tsx
<div
  className="grid gap-[5px] w-full max-w-[380px] aspect-square"
  style={{
    gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
    animation: boardShake ? 'hm-boardShake 0.45s ease-out' : undefined,
  }}
>
```

#### 4f — Pasar `boardShake` como prop en el render (play phase)
En el bloque `{gamePhase === 'play' && session && ...}`, la llamada a `<HerbalMoonlightBoard>` ya tiene las props básicas. Agregar `boardShake={boardShake}`.

#### 4g — Actualizar `handleRevealCell` para usar el resultado y disparar shake
```typescript
const revealResult = await service.revealCell(sessionId, journalBytes, journalHash, emptySeal, userAddress, signer);

const damageDealt = Number((revealResult as any)?.damage_dealt ?? (hasPlant ? damage : 0));
if (damageDealt > 0) {
  setBoardShake(true);
  setTimeout(() => setBoardShake(false), 500);
}
```
Y los mensajes de éxito:
- Con planta: `'\uD83C\uDF3F ¡${PLANT_INFO[pType]?.name} infligió ${damageDealt} de daño!'`
- Sin planta: `'\uD83C\uDF27\uFE0F Celda vacía. La Criatura avanza sin daño.'`
- Victoria gardener: `'\u2728 ¡La Criatura fue derrotada! El jardín está a salvo.'`
- Victoria creature: `'\uD83D\uDC7B La Criatura llegó a la casita. Fin del juego.'`

**Riesgo:** MEDIO — es el paso más extenso. Seguir el orden de sub-pasos para no perder nada.

---

### PASO 5 — Verificar `herbal-moonlight-frontend` (standalone)

El standalone YA tiene los cambios visuales aplicados. Solo verificar:

1. ¿`herbalMoonlightService.ts` del standalone tiene el fix de `revealCell()`? → Lo tiene de sesiones anteriores, **confirmar** leyendo el archivo.
2. ¿`HerbalMoonlightGame.tsx` tiene el estado `boardShake`? → Lo tiene, **confirmar**.
3. ¿`LandingScreen.tsx` compila sin errores? → Verificar que todos los imports están.
4. **No correr** `bun run dev:game herbal-moonlight` — solo revisión estática es suficiente aquí.

**Riesgo:** BAJO — es verificación, no modificación

---

### PASO 6 — Build y verificación funcional

```bash
# Verificar que sgs_frontend compila
cd sgs_frontend && bun run build

# Verificar que herbal-moonlight-frontend compila
cd herbal-moonlight-frontend && bun run build
```

Si hay errores de TypeScript (especialmente por el tipo `CellRevealResult | null` en el servicio), ajustar los tipos.

**Lista de verificación visual (en `bun run dev`):**
- [ ] Pantalla de creación de juego carga sin errores de consola
- [ ] Quickstart funciona (crea partida con ambas dev wallets)
- [ ] Las celdas del tablero muestran tierra oscura (no fondo purple plano)
- [ ] El creature ve niebla en todas las celdas excepto donde está
- [ ] El gardener ve sus plantas en sus posiciones (semitransparentes)
- [ ] Al revelar: el creature NO ve ninguna planta aparecer
- [ ] Al revelar: si hay planta, el tablero tiembla
- [ ] Los mensajes de daño muestran el número correcto (no "No damage")
- [ ] Los mensajes están en español temático

**Riesgo:** BAJO — es verificación, no modificación

---

### PASO 7 — Commit y push

```bash
git add sgs_frontend/src/games/herbal-moonlight/herbalMoonlightService.ts
git add sgs_frontend/src/games/herbal-moonlight/index.tsx
git add sgs_frontend/src/index.css
git add herbal-moonlight-frontend/src/games/herbal-moonlight/herbalMoonlightService.ts
# (Si hubo cambios en standalone también)

git commit -m "fix: apply fog of war, screen shake, and damage fix to sgs_frontend herbal moonlight"
git push origin main
```

---

## ORDEN DE EJECUCIÓN RECOMENDADO

```
PASO 2A (service sgs_frontend)
  → PASO 3 (CSS animation)
    → PASO 4 (visual changes index.tsx)
      → PASO 5 (verify standalone)
        → PASO 6 (build & test)
          → PASO 1 (asset cleanup, opcional)
            → PASO 7 (commit & push)
```

El PASO 1 (limpieza de root assets) es opcional y puede hacerse al final o en un commit separado, ya que no afecta el funcionamiento del juego.

---

## NOTAS CRÍTICAS PARA CLAUDE CODE

1. **EL ARCHIVO CORRECTO ES** `sgs_frontend/src/games/herbal-moonlight/index.tsx` — NO `herbal-moonlight-frontend/src/games/herbal-moonlight/HerbalMoonlightGame.tsx`

2. **La función `cellIsRevealed` puede quedarse** — se usa en `getValidMoves()` / `isValidCreatureMove()` para validar movimientos. Solo eliminar sus referencias **visuales** (en `renderCell`).

3. **No eliminar `revealed_cells` del session** — el contrato lo devuelve y se usa para lógica de movimiento válido.

4. **El import de `CellRevealResult`** ya existe en `sgs_frontend/src/games/herbal-moonlight/index.tsx` (línea 3). No necesita añadirse.

5. **Los emojis en JSX** — usar `'\uXXXX'` o Unicode literal, nunca HTML entities como `&#x1F33F;` dentro de expresiones `{}` de JSX.

6. **`MAX_PLANTS = 5`** en sgs_frontend (el standalone tiene 8). No cambiar — es intencional para el catálogo.

7. **Después de aplicar el fix de `revealCell()`**, el `handleRevealCell` en `index.tsx` actualmente ignora el retorno (`await service.revealCell(...)`). Hay que capturarlo en una variable (`const revealResult = await ...`) para poder leer `damage_dealt`.

---

## REFERENCIA: Cambios aplicados en sesiones anteriores (solo para contexto)

Los siguientes cambios se aplicaron a `herbal-moonlight-frontend/` pero necesitan portarse a `sgs_frontend/`:
- Dirt gradient en celdas del tablero
- Fog of war completo (sin revelar celdas visualmente)
- Screen shake (`boardShake` state + animación) en daño
- Mensajes temáticos en español
- Remoción de etiquetas de coordenadas `{x},{y}` en celdas
- Remoción de checkmark en celdas reveladas vacías
- Fix de `revealCell()` (unwrap de Result)

Los siguientes cambios son específicos del standalone y NO deben portarse a sgs_frontend:
- `LandingScreen.tsx` (no existe en sgs_frontend, ni debe)
- Navbar sticky de la pantalla de juego (la standalone es full-page, sgs_frontend está embebida)
- Logo de la LandingScreen
- `gardenUtils.ts` (sus funciones están inline en index.tsx ya)
