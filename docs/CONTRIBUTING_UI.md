# Herbal Moonlight — UI Contributing Guide

> Estado al cierre de sesión: **2026-02-21**
> Build status: ✅ `bun run build` limpio (0 errores TypeScript, 0 errores de linting)

---

## 1. Arquitectura de las 4 Pantallas

Todas las pantallas comparten: fondo forestal (`/assets/background.png`), vignette oscuro, y `GameNavbar` (Info | logo | Connect Wallet + dev gear).

### Flujo de early returns en `HerbalMoonlightGame.tsx`

```
HerbalMoonlightGame()
  │
  ├── if (uiPhase === 'create')
  │     → early return: <LandingScreen> + WoodPanel + 3 WoodButtons
  │       [Inicio.png reference]
  │
  ├── if (uiPhase === 'garden-setup' && gameState && !welcomeDone)
  │     → early return: forest bg + GameNavbar + witch overlapping WoodPanel
  │       [Welcome.png reference]
  │
  ├── if (uiPhase === 'complete' && gameState)
  │     → early return: forest bg + GameNavbar + WoodPanel con Lose-died + Win-Troll
  │       [finish.png reference]
  │
  └── main return (garden-setup post-welcome + play)
        ├── GameNavbar (fixed)
        ├── garden-setup: editor de jardín + commit button
        └── play: dark purple 3-column panel
              [Game.png reference]
```

### Componentes compartidos (exportados de `LandingScreen.tsx`)

| Componente     | Descripción                                                           |
|----------------|-----------------------------------------------------------------------|
| `GameNavbar`   | Navbar fija: Info pill \| logo \| wallet pill + gear dropdown dev     |
| `WoodPanel`    | Panel con `panel-inicio.png` como background (objectFit: fill)        |
| `WoodButton`   | Botón estilo madera oscura (variants: primary / secondary / ghost)    |
| `LandingScreen`| Wrapper completo: forest bg + GameNavbar + WoodPanel + logo + footer  |

### Estado `welcomeDone`

```typescript
const [welcomeDone, setWelcomeDone] = useState(false);
// Se resetea automáticamente cuando cambia sessionId:
useEffect(() => { if (sessionId > 0) setWelcomeDone(false); }, [sessionId]);
```

### Helpers compartidos entre early returns

Definidos entre el `create` early return y el `welcome` early return (líneas ~1318-1340):

```typescript
const sharedNavProps = { walletAddress, devPlayer, onGearClick, gearOpen, ... };
const forestBgLayers = (<> <div bg-image /> <div vignette /> </>);
const moonPhaseImg = (phase: number) =>
  phase === 0 ? '/assets/FullMoon.png' :
  phase === 1 ? '/assets/NewMoon.png'  : '/assets/MenguantMoon.png';
```

---

## 2. Assets Clave

### Ubicación: `herbal-moonlight-frontend/public/`

| Asset               | Ruta               | Uso                                             |
|---------------------|--------------------|-------------------------------------------------|
| `brujita.png`       | `/brujita.png`     | Witch character — navbar brand, Welcome screen  |
| `background.png`    | `/assets/`         | Forest night background en todas las pantallas  |
| `panel-inicio.png`  | `/assets/`         | Wood frame con ivy y gemas — base de WoodPanel  |
| `logo.png`          | `/assets/`         | Logo del juego — navbar center y LandingScreen  |
| `ghost.png`         | `/assets/`         | Criatura (Creature) — columna derecha Screen 3  |
| `witch.png`         | `/assets/`         | Jardinero pequeño — columna izquierda Screen 3  |
| `Lose-died.png`     | `/assets/`         | Skull pixel art — Screen 4 lado "You lose!"     |
| `Win-Troll.png`     | `/assets/`         | Troll pixel art — Screen 4 lado "You Win!"      |
| `smell.png`         | `/assets/`         | Ability icon: Smell (detectar plantas cercanas) |
| `adivine.png`       | `/assets/`         | Ability icon: Instinct (peek adjacent cells)    |
| `lavender2.png`     | `/assets/`         | Baby lavender — Screen 2 Welcome + Screen 3 left|
| `mint2.png`         | `/assets/`         | Baby mint — Screen 2 Welcome + Screen 3 left    |
| `mandrake2.png`     | `/assets/`         | Baby mandrake — Screen 2 Welcome + Screen 3 left|
| `FullMoon.png`      | `/assets/`         | Moon phase 0 — header de Screen 3              |
| `NewMoon.png`       | `/assets/`         | Moon phase 1 — header de Screen 3              |
| `MenguantMoon.png`  | `/assets/`         | Moon phase 2 — header de Screen 3              |

### Referencias de prototipo (solo en `public/`, no se sirven en prod)
- `Inicio.png`, `Welcome.png`, `Game.png`, `finish.png` — imágenes de referencia del diseño

---

## 3. Mecánica Ciega (Fog of War) y renderGameBoard

### Principio ZK

El **Jardinero** conoce el layout completo del jardín (almacenado en `garden: GardenLayout` + `gardenCommitment: Buffer`). La **Criatura** no ve nada — el contrato solo revela si una celda tiene planta *después* de que la Criatura pisa.

### `renderGameBoard(interactive, showPlants)`

```typescript
const renderGameBoard = (interactive: boolean, showPlants: boolean) => {
  // interactive = true → la Criatura puede hacer clic en celdas válidas
  // showPlants  = isGardener → solo el Jardinero ve las plantas en su tablero

  const validMoves = interactive && isCreature && phase === Playing
    ? getValidMoves(creature_x, creature_y, revealed_cells)
    : [];

  // Por cada celda:
  const plantType = showPlants ? garden[idx] : 0;  // ← FOG OF WAR aquí

  // revealed_cells se usa SOLO para calcular validMoves (movimiento)
  // NO se usa para revelar visualmente las celdas pisadas — tablero siempre oscuro
```

**Comportamiento actual:**
- `Gardener`: ve sus propias plantas (`showPlants = true`) — las ve como `PlantSprite`
- `Creature`: tablero completamente oscuro, solo ve celdas válidas resaltadas en azul/índigo
- Celda actual de la Criatura: resaltada en dorado (`rgba(255,213,79,0.22)`)
- Fila 4 (casa): borde dorado cálido más grueso

### Auto-reveal (Gardener)

Cuando `gameState.phase === WaitingForProof`, el `useEffect` lanza `handleRevealCell()` automáticamente. No hay botón "Reveal Cell" visible. El progreso ZK se muestra con la barra de progreso compacta en el centro del panel.

---

## 4. Tokens de Diseño Actuales

### Paleta Screen 3 (panel oscuro)
```
background:     rgba(20, 12, 50, 0.88)   // deep purple-dark
border:         rgba(140, 100, 220, 0.3) // soft violet
column divider: rgba(140, 100, 220, 0.12)
gardener label: #c4b5fd  (light violet)
creature label: #fde68a  (amber)
HP low alert:   #f87171  (red, when HP ≤ 2)
hp normal:      #fde68a
ability button: rgba(60, 30, 120, 0.35) hover state
```

### Paleta WoodPanel / Buttons
```
panel bg img:   /assets/panel-inicio.png (objectFit: fill)
WoodButton primary bg:  rgba(55, 32, 10, 0.82)
WoodButton primary border: rgba(190, 140, 55, 0.55)
WoodButton primary text:   rgba(238, 212, 158, 0.95)
WoodButton secondary bg:   rgba(38, 22, 8, 0.72)
WoodButton ghost:          transparent + rgba(150, 110, 50, 0.25) border
```

---

## 5. To-Do — Refinamiento para Mañana

> Prioridad: contraste, escala y espaciado AAA.

### 🔤 Jerarquía de Fuentes (Screen 3)

- [ ] **Contadores X/3** en columna Gardener: aumentar a `0.72rem`, `fontWeight: 700` (actualmente `0.58rem`)
- [ ] **Etiqueta HP** en columna Creature: subir a `1.1rem` y añadir glow `text-shadow: 0 0 12px currentColor`
- [ ] **Nombre de planta** (Lavender, Mint, Mandrake): actualmente `0.48rem` — subir a `0.6rem`
- [ ] **Turn status** en header: pixel font demasiado pequeño (`0.36rem`) — usar `0.46rem` con `letter-spacing: 0.06em`
- [ ] Revisar si `var(--font-pixel)` es legible a ese tamaño en mobile (≤ 380px)

### 📐 Escalado de Componentes (Screen 3)

- [ ] **Board** (`maxWidth: 370`): en pantallas < 700px el grid 3-columnas comprime el tablero. Considerar `minWidth: 200px` en la columna central o reducir padding lateral del card.
- [ ] **Imágenes de plantas** (`height: 42px`): en mobile se ven muy pequeñas. Target: `clamp(36px, 8vw, 52px)`.
- [ ] **Ability icons** (`height: 36px`): igual — usar `clamp(32px, 7vw, 44px)`.
- [ ] Añadir `min-width: 0` a todas las columnas del grid para prevenir overflow.

### 🎨 Contraste de WoodButton

- [ ] El texto `rgba(238, 212, 158, 0.95)` sobre `rgba(55, 32, 10, 0.82)` tiene ratio ~3.8:1. Para AA: aumentar luminosidad del texto a `rgba(255, 235, 185, 1)` o añadir `text-shadow: 0 1px 2px rgba(0,0,0,0.5)`.
- [ ] WoodButton `secondary` (darker bg) tiene bajo contraste — añadir `fontWeight: 700` y aclarar texto a `rgba(238, 212, 158, 0.95)` (mismo que primary).
- [ ] Añadir `:hover` state mediante `onMouseEnter`/`onMouseLeave` o clase CSS: `background: rgba(75, 45, 15, 0.9)`.

### 📏 Padding y Espaciado

- [ ] **Header del panel** (Screen 3): añadir `paddingTop: '4.5rem'` en `contentColStyle` ya está, pero verificar que el header del card no quede partido por la navbar en mobile.
- [ ] **Screen 4 (Finish)**: el padding `'5rem 1rem 2rem'` puede ser insuficiente en pantallas muy altas — añadir `minHeight: '100vh'` al contenedor y `justifyContent: 'center'`.
- [ ] **Screen 2 (Welcome)**: el `marginRight: -65` del witch puede no funcionar bien en pantallas < 360px. Añadir `@media (max-width: 380px)` con `marginRight: -40` y `height: 150`.
- [ ] Revisar `gap` en WoodPanel (actualmente `0.65rem`) — puede ser insuficiente para separar elementos en Screen 4.

### ✨ Detalles Adicionales de Pulido

- [ ] **Animación de entrada** al 3-column panel: ya tiene `animation: 'fadeUp 0.5s ease both'` — verificar que funcione en Safari (`-webkit-`).
- [ ] **Board shake** (`board-shake` class): confirmar que se ve en el nuevo layout comprimido.
- [ ] **Opacidad del lado perdedor** en Screen 4: `opacity: 0.38` puede ser demasiado bajo — probar `0.45`.
- [ ] **Footer** en Screen 2 y 4: actualmente `rgba(170, 140, 90, 0.32)` — considerar subir a `0.45` para mejor legibilidad.

---

## 6. Instrucción de Despertar — Próxima Sesión

> **Mañana empezamos directamente con el refinamiento de escalas y fuentes en Screen 3 (Game) y Screen 4 (Finish) para que el juego se sienta AAA. La prioridad es el contraste y el espaciado.**

Orden de ataque sugerido:
1. Jerarquía tipográfica Screen 3 (fuentes + pesos)
2. Responsive scaling del board y columnas laterales
3. WoodButton contrast + hover states
4. Padding y spacing Screen 4 + Screen 2 mobile
5. `bun run build` después de cada bloque de cambios
