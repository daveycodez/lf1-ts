# FIGHT.EXE — Ungarbled Binary Analysis

Reference for code that Ghidra's decompiler could not resolve.

## Decade 7 Handler (file 0x0F598, 157 bytes)

Simple 3-state jump preparation sequence:

```
if state == 0x48 (72):     // frame 2: launch
    Zvel = -13             // upward velocity
    state = 1              // reset to idle

if state == 0x47 (71):     // frame 1: wind-up
    anim = 0x15            // crouch-before-jump frame
    state++                // → 72

if state == 0x4B (75):     // timeout: cancel
    state = 1
    anim = 1               // back to idle
```

## Decade 11 Handler (file 0x11055, 80 bytes)

Found via `CMP word [BP-2], 0x0B` — the dispatch uses a stored `state/10` local
variable, not a recomputed pattern.

The handler is timer-based:
1. `INC [state]` — advances each frame (117→118→119→120)
2. `CMP [state], 0x78 (120)` — after 3 frames, state reaches 120
3. When state >= 120: transitions to decade 12 territory

So the airborne dash state lasts exactly **3 frames**, then hands off to decade 12
which changes the animation from dash to jump. The mid-arc sprite transition is
**timer-based (3 frames)**, not velocity-based.

## Decade 12 Handler (`FUN_2b82_4485` — plain 16-bit x86)

Ghidra may show this routine as garbage: the listing is **not** the Borland FPU thunk
sequence. Confusion usually comes from **far calls**, **stack-limit helpers** (`call` to
`0:342Ch`-style), and repeated `entity_index * 0x34` prologue — not opaque machine code.

### Where it lives

| Item | Value |
|------|--------|
| **Handler body** | File offset **`0x110A5`** (`55 8B EC 56 57 8B 76 06 …`) |
| **Dispatch** | Per-entity update ~**`0x15DC0`**: after `state / 10` (`idiv 10`), **`cmp ax, 12`** → **`call` near** into **`0x110A5`** |

**Decade 12** here means **`floor(state / 10) == 12`** → **states `120–129`** (`0x78`–`0x81`).

Entity base: **`BX = player_index * 0x34`**. Offsets: **`0x3414` state**, **`0x3412` anim**,
**`0x3402` facing**, **`0x3406` Xvel**, **`0x340A` Zvel**, **`0x33FC` Xpos**. Word at
**`0x3416`** is used here as **minus 12** in one branch (HP/MP field — name per your struct).

### Readable outline

1. **`DI = facing`** (`[BX+0x3402]`). If **`state == 0x7B` (123)**, **`DI`** is **negated** for the rest of the routine (temporary work-facing).

2. **Early exit out of the 120s**  
   If **`anim == 0x15`** and **`state == 0x7B`**: **`anim = 0x12`**, **`state = 0x2A` (42)** → forces the **`40–49`** decade (not FPU-related).

3. **Landing / bounce (still `anim == 0x15`)**  
   Skips a block unless **`X == 0x125`** or **`X == 0x1B`** (special positions).  
   If **`state == 0x7A` (122)**:
   - **`state = 0x7B` (123)**
   - **`facing *= -1`**
   - **`Zvel = -5`** (`0xFFFB`)
   - **`anim = 0x13`**
   - **`Xvel = Xvel / 3`** (signed `idiv` by 3)
   - **`word [BX+0x3416] -= 12`**
   - **`call` near `0x6550`** with **`Xpos`**, **`8`** on stack — likely **hit SFX / small effect** helper.

4. **VFX path**  
   If **`state > 0x79` (121)** and **`Xvel != 0`**: large argument block → **`call far 15F1:2F0A`** (particle / sparkle / impact — typical pattern Hex-Rays turns to mush).

5. **State `121` branch**  
   If **`state == 0x79`**: **`Xvel = facing << 4`**, **`Zvel = -5`**, **`anim = 0x10`**, **`state = 0x7A` (122)**.  
   Then if **`Zvel > 0`** and **`state == 0x7A`**: **`anim = 0x11`** — direct anim/state rewrites, not “air friction.”

6. **Epilogue** ends with **`pop di; pop si; pop bp; retf`** ~**`0x112EE`**. The **`dec [state]`** / **`anim = 0x2a`** that follows is **the next packed routine**, not part of the same `retf`.

### Why the decompiler looks broken here

- **`retf`** immediately adjacent to **`push bp`** of the next function — tight packing; tools mis-slice boundaries.
- **`call far`** and stack/limit thunks break CFG recovery.
- Long runs of **`mov ax,si` / `imul 0x34` / `mov bx,ax`** merge branches incorrectly unless split on **`cmp`** targets.

### Takeaway

This handler is a **large state/anim machine** for **`state` in the 120s**: forced jump to
**`state = 42`**, facing flips, Z knockback, Xvel scaling, optional **12-point** word
deduction, near helper, and far VFX — i.e. dash/landing behavior driven by **`state`** and
**`anim`**, including the **`0x10` / `0x11`** animation path (mid-arc sprite change).

## Friction FPU — Real But Unknown Formula

The friction code (file 0x15E9E) decodes to:

```
CD 3B 46 FC    → FIADD word [BP-4]     ; ST(0) += Xvel (load onto FPU stack)
CD 38 36 8B 01 → DB /6 [DS:018Bh]      ; Borland-specific FPU op using data segment constant
9A 82 0F 00 00 → CALL FAR __ftol       ; convert float result to integer (truncate toward zero)
```

The `DB /6` is NOT a standard x87 instruction — it's a reserved opcode that Borland's
software FPU emulator repurposes. Most likely `FIDIV` (integer divide by constant) or
`FIMUL` (multiply by friction factor). The constant at `DS:018Bh` determines the decay rate
but its value depends on runtime segment setup.

**Ground friction IS real.** It operates when `Zpos == 0` and `anim != 0x15`.
Uses floating-point math with truncation toward zero. Exact coefficient unknown.
Same pattern repeats identically for Yvel friction.

DS:018B = 0x3FF3333333333333 = 1.2 (IEEE 754 double).
Formula: new_vel = trunc(vel / 1.2)

Decay from Xvel=9: 9→7→5→4→3→2→1→snap to 0. Six frames to stop.

## Entity Layout (confirmed fields)

| Offset | Field | Description |
|--------|-------|-------------|
| BX+0x33FC | Xpos | Horizontal position |
| BX+0x33FE | Ypos | Depth position |
| BX+0x3400 | Zpos | Height (negative = airborne, 0 = ground) |
| BX+0x3402 | Facing | -1 = left, 1 = right |
| BX+0x3406 | Xvel | Horizontal velocity |
| BX+0x3408 | Yvel | Depth velocity |
| BX+0x340A | Zvel | Vertical velocity |
| BX+0x3412 | Anim | Sprite frame |
| BX+0x3414 | State | Action state |
| BX+0x3416 | HP | Hit points |
| BX+0x3420 | MP | Mana points |

## Per-Frame Physics (confirmed)

- Gravity: if Zpos < 0 → Zvel += 3
- No air friction/drag on Xvel or Yvel
- Ground friction on Xvel/Yvel: see **Friction FPU** above (`Zpos == 0`, `anim != 0x15`)
- Landing (`FUN_161d_db4a`): `Zpos > 0` → clear Zvel/Zpos; set `anim = 0x15` unless `state/0x32 == 6`; set `state = 0x4b` unless `state/10` is `4` or `12` or `state/0x32 == 6` — decade **12** then continues into the handler above (not a simple `0x4b` handoff)
- Bounce: Xvel halved on impact (entity handler only)

## Combat / Hitbox System (confirmed from FUN_161d_0104, FUN_161d_8779, FUN_25f1_2f0a)

### Hitbox Lifecycle
- ALL hitboxes cleared (type=0) at start of each tick (line 19141-19145)
- Attack handlers spawn new hitboxes during fighter update phase
- Hitbox-vs-hitbox interactions processed (FUN_161d_1829)
- Then collision detection runs per-fighter (FUN_161d_0104)
- Each hitbox lives for exactly ONE tick

### Kick Hitbox (FUN_161d_8779)
- v14=0x15: pick starting frame (v12 = rand*2 + 8 → 8 or 10)
- v14=0x16: play sound, v12++ (→9 or 11, ACTIVE). Hitbox spawned: type=0+7=**7** (deals damage)
- v14=0x17: no v12 change. Hitbox spawned: type=0x37d+7=**900** (ghost, NO damage)
- v14=0x18: v12-- (→8 or 10, retract). No hitbox.
- v14=0x19: return to idle.
- **Key**: iVar2=0x37d when v14>0x16. Second active frame intentionally has type=900.

### Punch Hitbox (FUN_2b82_2ef7 → FUN_2b82_2f71 command executor)
- v14=0x0b: pick starting frame (v12 = rand*2 + 4 → 4 or 6)
- v14=0x0c: play sound, v12++ (→5 or 7, ACTIVE). Hitbox spawned ONCE by command executor.
- v14=0x0d: v12 stays at 5/7 but NO new hitbox (command executor is data-driven, one-shot)
- v14=0x0e: v12-- (→4 or 6, retract). No hitbox.
- v14=0x0f: return to idle.

### Type 900 (Ghost Hitbox)
- Collision function (line 8565): `hb.type == 900` routes to the special/no-damage branch.
- In the special branch, no type match (not -1,-2,-3,-5,-6), so nothing happens.
- Purpose: participates in hitbox-vs-hitbox interactions (FUN_161d_1829) without dealing damage.

### Collision Detection Guards (main loop line 19715-19717)
- Decade 5 → skip collision entirely
- Decade 4 → skip UNLESS v14 == 0x29 exactly (initial tumble frame can be interrupted)
- v14/20 == 10 → skip

### v0c Invulnerability Timer
- Countdown: decremented by 1 each tick (line 14338). While > 0, normal hits skip damage.
- Set to 6 when tumble recovery completes (v14 reaches 0x32 → v14=0x4b, v0c=6)
- Set to 100 after super move recovery (v14=0xbc7)
- Set to 20 in certain entity interactions
- NOT set in the collision function itself — recovery handlers set it.

### Tumble State (Decade 4, func_0x0002e2f8)
- v14=0x29: initial frame. Can still be hit (main loop allows v14==0x29).
- v14=0x2a+: v14 increments each tick. Immune to hits.
  - If v12==0x12 (grounded tumble) and HP<=0: v12=0x25 (KO frame)
  - Spawns body hitbox (type -2) each tick while HP > 0
- v14=0x32: recovery. v14→0x4b, v0c=6. If HP<=0: f2=3 (dead). Else: v12=0x15 (landing).
- Landing during tumble (v12==0x15 && v14!=0x4b): play sound, v12=0x12, v14=rand+0x2a.
- This creates a bounce cycle: launched → land → ground tumble → recover.

### Light Stun (Decade 3, FUN_2b82_2dd9)
- Decade 3 is NOT in the main state dispatch (line 14357-14398).
- Handled separately at line 14542: `if (v14/10 == 3) FUN_2b82_2dd9()`.
- FUN_2b82_2dd9 uses the command executor (FUN_2b82_2f71), data-driven.
- Runs AFTER landing, friction, etc. in the update function.
- Recovery timing determined by command data tables (not a simple counter).
