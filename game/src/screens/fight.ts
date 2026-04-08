/**
 * fight.ts — 1-to-1 port of FIGHT.EXE from Ghidra decompiled C
 *
 * Source: game/tools/fight_decompiled.c
 * Key functions ported:
 *   FUN_25f1_32be  = main fight loop
 *   FUN_25f1_1139  = fighter spawn/init
 *   FUN_25f1_1562  = round init
 *   FUN_161d_43d9  = per-slot update (physics + state dispatch)
 *   FUN_161d_28af  = walk/idle handler (state 0-9)
 *   FUN_161d_3555  = attack handler (state 10-19)
 *   FUN_161d_42dc  = hit reaction handler (state 20-29)
 *   FUN_161d_2e22  = airborne/projectile handler (state 30-39)
 *   FUN_161d_4388  = death handler (state 40-49)
 *   FUN_161d_0104  = collision / hit detection
 *   FUN_161d_1829  = fighter-vs-fighter interaction
 *   FUN_161d_0025  = sound queue (pan-based)
 *   FUN_25f1_2f0a  = spawn hitbox/projectile entity
 *   FUN_25f1_2fef  = play sound (s?.wav)
 *
 * Data layout (from decompiled offsets):
 *   Fighter record stride: 0x34 bytes (0x1a words), 30 max slots
 *   Hitbox/projectile slots: 30 entries, 0xb words each
 *   Sound queue: 30 entries in DAT_3463_463b
 *
 * Sound files: s?.wav template from FIGHT.EXE binary (SA, SB, SC, ...)
 */

import { KEYS } from "../engine/input";
import { SCREEN_H, SCREEN_W } from "../engine/renderer";
import type { GameContext } from "../main";

// ══════════════════════════════════════════════════════════════
// Constants from decompiled code
// ══════════════════════════════════════════════════════════════

const MAX_SLOTS = 30; // 0x1e — fighters + entities + projectiles
const MAX_FIGHTERS = 8;
const MAX_HITBOXES = 30; // 0x1e hitbox/projectile slots

// From decompiled FUN_25f1_1d67 (line 18377):
// (iVar2 % 0xc) * 0x1a + 1 → 12 columns, 26px cell width, 1px padding
// (iVar2 / 0xc) * 0x1a + 1 → 26px cell height, 1px padding
// 0x19 = 25px sprite size (within 26px cell)
const ACT_CELL = 26; // cell pitch in the sprite sheet
const ACT_PAD = 1; // padding before sprite data in each cell
const ACT_SPR = 25; // actual sprite size (0x19)
const ACT_COLS = 12; // 0xc columns per sheet
const ACT1_MAX = 60; // 12 cols * 5 rows = 60 frames per sheet (0-59 ACT1, 60+ ACT2)

const WEAP_FW = 18;
const WEAP_FH = 16;
const WEAP_COLS = 15;

const HEAD_FW = 18;
const HEAD_FH = 13;
const HEAD_COLS = 11;

// MENU.GRH (320x56) at top, BACK*.GRH top 100 rows fill play area
// FUN_25f1_038e draws 100 rows of BG at Y=56 (line 17508-17509: local_a=100)
// Bottom 44 rows of BG go into bottom HUD at Y=156
const HUD_Y = 0; // MENU/HUD at top of screen
const HUD_H = 56; // MENU.GRH height
const BG_Y = 56; // play area starts right below HUD
const BG_ROWS = 100; // only top 100 rows of BG image shown in play area

const BG_PAIRS: [string, string][] = [
	["BACK21", "BACK22"],
	["BACK31", "BACK32"],
	["BACK41", "BACK42"],
	["BACK51", "BACK52"],
	["BACK61", "BACK62"],
];

// Y bounds loaded from ctx.backgrounds at runtime.
// BG_PAIRS[i] = stage (i+1) in the original = ctx.backgrounds[i+1] in DATA.DAT

// Sound file mapping — FIGHT.EXE uses "s?.wav" template
// s1.wav → SA, s2.wav → SB, etc. But the actual files are SA.WAV-SR.WAV
// The sound index from FUN_161d_0025 maps to loaded sound names
const SOUND_NAMES = [
	"",
	"SA",
	"SB",
	"SC",
	"SD",
	"SE",
	"SF",
	"SG",
	"SH",
	"SI",
	"SJ",
	"SK",
	"SL",
	"SM",
	"SN",
	"SO",
	"SP",
	"SQ",
	"SR",
];

// Per-frame head offset tables (FUN_25f1_1562 lines 18081-18112)
// DAT_4b4a[v12] = X offset for head relative to body, multiplied by facing
// DAT_4b0d[v12] = Y offset for head (0=normal, 0x32=50=lowered, 0x3c/0x3d=very low)
const HEAD_OFFSET_X: number[] = new Array(61).fill(0);
const HEAD_OFFSET_Y: number[] = new Array(61).fill(0);
// X offsets (line 18087-18093)
for (const i of [7, 11, 24, 38, 39]) HEAD_OFFSET_X[i] = 4;
for (const i of [44, 45, 46, 50, 51, 58, 59, 60]) HEAD_OFFSET_X[i] = 3;
// Y offsets (line 18098-18111)
for (const i of [
	12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 26, 27, 28, 29, 30, 31, 33, 34,
	35, 36, 37, 40, 41, 42, 43, 47, 48, 52, 53, 54, 55, 56,
])
	HEAD_OFFSET_Y[i] = 0x32;
for (const i of [38, 50, 51]) HEAD_OFFSET_Y[i] = 0x3c;
HEAD_OFFSET_Y[39] = 0x3d;
// Crouch/jump prep frame (0x15=21): uRam00039152 = 3 → DAT_4b0d[0x15] = 3
HEAD_OFFSET_Y[0x15] = 3;

// MP bar color tiers (palette indices → RGB from PAL file)
const MP_COLOR_LOWEST = "#0000ff"; // pal[0x01] — below first threshold
const MP_COLOR_MID = "#285dff"; // pal[0x68] — above first threshold
const MP_COLOR_HIGH = "#00aaff"; // pal[0x6a] — above second threshold
const MP_COLOR_FLASH = "#ffffff"; // pal[0x0f] — above third threshold + tick flash

// ══════════════════════════════════════════════════════════════
// Fighter slot fields (matching decompiled DAT_3463 offsets)
// Stride: 0x1a words = 0x34 bytes per slot
// ══════════════════════════════════════════════════════════════

interface Slot {
	f2: number; // 33f2: slot type (0=empty, 1=human, 2=AI/entity, 4=projectile)
	f4: number; // 33f4: palette/skin variant index
	f6: number; // 33f6: misc flag
	f8: number; // 33f8: lives/bounce counter (init 0x33=51)
	fa: number; // 33fa: max lives (init 0x33)
	fc: number; // 33fc: X position
	fe: number; // 33fe: Y position
	v00: number; // 3400: vertical accumulator (Z-like)
	v02: number; // 3402: facing (-1=0xffff left, 1=right)
	v04: number; // 3404: target slot / team index
	v06: number; // 3406: X delta per tick
	v08: number; // 3408: Y delta per tick
	v0a: number; // 340a: Y acceleration (gravity-like)
	v0c: number; // 340c: invulnerability timer
	v0e: number; // 340e: misc timer (init 1)
	v10: number; // 3410: owner/linked slot index
	v12: number; // 3412: animation frame index
	v14: number; // 3414: state (decade-bucketed: /10 selects handler)
	v16: number; // 3416: HP (init 200)
	v18: number; // 3418: character type ID (0-10)
	v1a: number; // 341a: max HP (init 200)
	v1c: number; // 341c: current move row index
	v1e: number; // 341e: MP/stun threshold (init from char table 0x3d0a)
	v20: number; // 3420: MP/stun meter (init 0xfa=250, or 100)
	v22: number; // 3422: aux counter
	v24: number; // 3424: priority/damage scale
}

interface Hitbox {
	x: number; // 3148: X position
	y2: number; // 314a: Y reference
	y: number; // 314c: Y position
	hw: number; // 314e: half-width
	hh: number; // 3150: half-height
	v52: number; // 3152
	v54: number; // 3154
	v56: number; // 3156
	type: number; // 3158: hit type (negative = special, positive = damage*1000+kind)
	v5a: number; // 315a
	owner: number; // 315c: owner slot index
}

// HUD data per fighter (from DAT_3463_3b36 stride 8)
interface HudData {
	v36: number; // 3b36
	v38: number; // 3b38
	v3a: number; // 3b3a
	v3c: number; // 3b3c — team/group index
	v3e: number; // 3b3e — palette assignment
	v40: number; // 3b40
	v42: number; // 3b42 — HP bar scale (maxHP / 5)
	v44: number; // 3b44 — MP bar scale (maxMP / 5)
}

function mkSlot(): Slot {
	return {
		f2: 0,
		f4: 0,
		f6: 0,
		f8: 0,
		fa: 0,
		fc: 0,
		fe: 0,
		v00: 0,
		v02: 1,
		v04: 0,
		v06: 0,
		v08: 0,
		v0a: 0,
		v0c: 0,
		v0e: 0,
		v10: 0,
		v12: 0,
		v14: 0,
		v16: 0,
		v18: 0,
		v1a: 0,
		v1c: 0,
		v1e: 0,
		v20: 0,
		v22: 0,
		v24: 0,
	};
}

function mkHitbox(): Hitbox {
	return {
		x: 0,
		y2: 0,
		y: 0,
		hw: 0,
		hh: 0,
		v52: 0,
		v54: 0,
		v56: 0,
		type: 0,
		v5a: 0,
		owner: 0,
	};
}

function mkHud(): HudData {
	return { v36: 0, v38: 0, v3a: 0, v3c: 0, v3e: 0, v40: 0, v42: 0, v44: 0 };
}

// Signed 16-bit conversion (decompiled code uses int16 everywhere)
function i16(v: number): number {
	v = v & 0xffff;
	return v > 0x7fff ? v - 0x10000 : v;
}

function abs16(v: number): number {
	return v < 0 ? -v : v;
}

// ══════════════════════════════════════════════════════════════
// Main entry point
// ══════════════════════════════════════════════════════════════

export async function runFightExe(ctx: GameContext): Promise<void> {
	const { renderer, input, audio, assets, timer } = ctx;

	// ── Color replacement for per-fighter sprite recoloring ──
	// Base ACT1 sprite uses palette band 151-159 (neutral purple tones).
	// In the original, DAT_0096 = fighter*10 shifts into the fighter's palette band.
	// Since we can't do VGA palette tricks, we do pixel-level color replacement.
	// User-verified base sprite color → body part mapping:
	const BASE_MAP: { rgb: [number, number, number]; part: string }[] = [
		{ rgb: [56, 69, 113], part: "s1" }, // #384571 → skin1
		{ rgb: [81, 81, 113], part: "s2" }, // #515171 → skin2
		{ rgb: [89, 81, 113], part: "h1" }, // #595171 → shirt1
		{ rgb: [97, 81, 113], part: "h2" }, // #615171 → shirt2
		{ rgb: [105, 81, 113], part: "t1" }, // #695171 → pants1
		{ rgb: [113, 81, 113], part: "t2" }, // #715171 → pants2
		{ rgb: [113, 81, 105], part: "ew" }, // #715169 → eye white
		{ rgb: [113, 81, 97], part: "mr" }, // #715161 → mouth red
		{ rgb: [113, 81, 89], part: "ol" }, // #715159 → outline
		{ rgb: [113, 81, 81], part: "hr" }, // #715151 → hair (per-character)
	];

	function getCharColors(
		charIdx: number,
	): Map<string, [number, number, number]> {
		const ch = ctx.characters[charIdx];
		if (!ch) return new Map();
		const pal = gamePalette;
		if (!pal) return new Map();
		const [s1, s2] = ch.skinColors;
		const [h1, h2] = ch.shirtColors;
		const [t1, t2] = ch.trouserColors;
		const partToColor: Record<string, [number, number, number]> = {
			s1: pal[s1] ?? [0, 0, 0],
			s2: pal[s2] ?? [0, 0, 0],
			h1: pal[h1] ?? [0, 0, 0],
			h2: pal[h2] ?? [0, 0, 0],
			t1: pal[t1] ?? [0, 0, 0],
			t2: pal[t2] ?? [0, 0, 0],
			ol: [0, 0, 0],
			ew: [255, 255, 255],
			mr: [255, 0, 0], // mouth red (#ff0000 = pal[0x1f=31], from line 17806)
			hr: hairColors[charIdx] ?? [0, 0, 0], // hair: extracted from HEAD.GRH top rows
		};
		const colorMap = new Map<string, [number, number, number]>();
		for (const { rgb, part } of BASE_MAP) {
			colorMap.set(`${rgb[0]},${rgb[1]},${rgb[2]}`, partToColor[part]);
		}
		return colorMap;
	}

	// Offscreen canvas for color-replaced sprites
	const recolorCanvas = document.createElement("canvas");
	recolorCanvas.width = ACT_SPR;
	recolorCanvas.height = ACT_SPR;
	const recolorCtx = recolorCanvas.getContext("2d")!;

	function drawRecoloredSprite(
		img: HTMLImageElement,
		sx: number,
		sy: number,
		dx: number,
		dy: number,
		flip: boolean,
		charIdx: number,
	) {
		const colorMap = getCharColors(charIdx);
		recolorCtx.clearRect(0, 0, ACT_SPR, ACT_SPR);
		if (flip) {
			recolorCtx.save();
			recolorCtx.translate(ACT_SPR, 0);
			recolorCtx.scale(-1, 1);
			recolorCtx.drawImage(
				img,
				sx,
				sy,
				ACT_SPR,
				ACT_SPR,
				0,
				0,
				ACT_SPR,
				ACT_SPR,
			);
			recolorCtx.restore();
		} else {
			recolorCtx.drawImage(
				img,
				sx,
				sy,
				ACT_SPR,
				ACT_SPR,
				0,
				0,
				ACT_SPR,
				ACT_SPR,
			);
		}
		if (colorMap.size > 0) {
			const imgData = recolorCtx.getImageData(0, 0, ACT_SPR, ACT_SPR);
			const d = imgData.data;
			for (let p = 0; p < d.length; p += 4) {
				if (d[p + 3] === 0) continue;
				const key = `${d[p]},${d[p + 1]},${d[p + 2]}`;
				const rep = colorMap.get(key);
				if (rep) {
					d[p] = rep[0];
					d[p + 1] = rep[1];
					d[p + 2] = rep[2];
				}
			}
			recolorCtx.putImageData(imgData, 0, 0);
		}
		renderer.getOffscreenCtx().drawImage(recolorCanvas, dx, dy);
	}

	// Cached HUD portrait canvases (pre-rendered once per fighter)
	const portraitCache = new Map<number, HTMLCanvasElement>();
	function getPortraitCanvas(charIdx: number): HTMLCanvasElement | null {
		if (portraitCache.has(charIdx)) return portraitCache.get(charIdx)!;
		const actImg = assets.getImage("ACT1");
		const headImgSrc = assets.getImage("HEAD");
		const ch = ctx.characters[charIdx];
		if (!actImg || !ch) return null;
		const cvs = document.createElement("canvas");
		cvs.width = ACT_SPR;
		cvs.height = ACT_SPR;
		const cctx = cvs.getContext("2d")!;
		// Draw recolored body (ACT1 frame 0 at 1,1)
		drawRecoloredSprite(actImg, ACT_PAD, ACT_PAD, 0, 0, false, charIdx);
		cctx.drawImage(recolorCanvas, 0, 0);
		// Draw head overlay on top
		if (headImgSrc) {
			const hi = ch.headPic;
			const hsx = ((hi - 1) % 11) * 18 + 1;
			const hsy = Math.floor((hi - 1) / 11) * 13 + 1;
			cctx.drawImage(headImgSrc, hsx, hsy, 17, 12, 0, 0, 17, 12);
		}
		portraitCache.set(charIdx, cvs);
		return cvs;
	}

	// Load game palette for color lookups
	let gamePalette: [number, number, number][] | null = null;
	{
		const palBuf = await (await fetch("/assets/PAL")).arrayBuffer();
		const palRaw = new Uint8Array(palBuf);
		gamePalette = [];
		for (let i = 0; i < 256; i++) {
			const pi = ((i - 1) & 0xff) * 3;
			const r6 = palRaw[pi] & 0x3f;
			const g6 = palRaw[pi + 1] & 0x3f;
			const b6 = palRaw[pi + 2] & 0x3f;
			gamePalette.push([
				(r6 << 2) | (r6 >> 4),
				(g6 << 2) | (g6 >> 4),
				(b6 << 2) | (b6 >> 4),
			]);
		}
	}

	// Extract hair color per character from HEAD.GRH top rows
	const hairColors: [number, number, number][] = [];
	{
		const headImg = assets.getImage("HEAD");
		const tmpCvs = document.createElement("canvas");
		tmpCvs.width = 198;
		tmpCvs.height = 65;
		const tmpCtx = tmpCvs.getContext("2d")!;
		if (headImg) tmpCtx.drawImage(headImg, 0, 0);
		for (let ci = 0; ci < 11; ci++) {
			const hp = ctx.characters[ci]?.headPic ?? ci + 1;
			const hsx = ((hp - 1) % 11) * 18 + 1;
			const hsy = Math.floor((hp - 1) / 11) * 13 + 1;
			const counts = new Map<
				string,
				{ c: [number, number, number]; n: number }
			>();
			for (let y = 0; y < 3; y++) {
				for (let x = 0; x < 17; x++) {
					const d = tmpCtx.getImageData(hsx + x, hsy + y, 1, 1).data;
					if (d[3] < 128) continue;
					if (d[0] + d[1] + d[2] < 15) continue; // skip black
					if (d[0] === 40 && d[1] === 40 && d[2] === 40) continue; // skip bg
					const k = `${d[0]},${d[1]},${d[2]}`;
					const e = counts.get(k);
					if (e) e.n++;
					else counts.set(k, { c: [d[0], d[1], d[2]], n: 1 });
				}
			}
			let best: [number, number, number] = [0, 0, 0];
			let bestN = 0;
			for (const v of counts.values()) {
				if (v.n > bestN) {
					bestN = v.n;
					best = v.c;
				}
			}
			hairColors.push(best);
		}
	}

	// ── Game state arrays (matching DAT_3463 data segment) ──
	const slots: Slot[] = Array.from({ length: MAX_SLOTS }, mkSlot);
	const hitboxes: Hitbox[] = Array.from({ length: MAX_HITBOXES }, mkHitbox);
	const hud: HudData[] = Array.from({ length: MAX_FIGHTERS }, mkHud);
	const soundQueue = new Int16Array(MAX_SLOTS); // DAT_3463_463b
	const scores = new Int16Array(MAX_FIGHTERS); // offset 0xf0

	// ── Y bounds from DATA.DAT backgrounds ──
	// BG_PAIRS[si] = original stage (si+1) = ctx.backgrounds[si+1]
	function getYMin(si: number): number {
		return ctx.backgrounds[si + 1]?.bgy1 ?? 123;
	}
	function getYMax(si: number): number {
		return ctx.backgrounds[si + 1]?.bgy2 ?? 185;
	}
	function getStageName(si: number): string {
		return ctx.backgrounds[si + 1]?.name ?? "Unknown";
	}

	// ── Match state globals ──
	let stageIdx = 0; // DAT_3463_46df (1-5, 0-indexed here)
	let scrollX = 0; // DAT_3463_46e1
	let exitFlag = 0; // DAT_3463_2ef6
	let tickCount = 0; // DAT_3463_49b6
	let tickParity = 0; // DAT_3463_46db — toggles 0/1 each tick, gates healing/idle
	let paused = false;
	let matchOver = false;
	let done = false;
	let winnerTeam = -1;

	// MP bar color based on thresholds from character specials (line 18602-18641)
	// 4 tiers: lowest (below sp0 cost), mid (above sp0), high (above sp1), flash (above sp2 + tick)
	function getMpBarColor(charIdx: number, mp: number): string {
		const ch = ctx.characters[charIdx];
		if (!ch || !ch.specials || ch.specials.length === 0) return MP_COLOR_LOWEST;
		const t0 = ch.specials[0]?.mpCost ?? 999;
		const t1 = ch.specials[1]?.mpCost ?? 999;
		const t2 = ch.specials[2]?.mpCost ?? 999;
		if (mp >= t2 && tickParity === 1) return MP_COLOR_FLASH;
		if (mp >= t1) return MP_COLOR_HIGH;
		if (mp >= t0) return MP_COLOR_MID;
		return MP_COLOR_LOWEST;
	}

	const humanPlayers = ctx.shared.humanPlayers ?? 1;
	const totalSlots = ctx.shared.totalSlots ?? 2;
	const selections: number[] = ctx.shared.selections ?? [0, 1];
	const playerIndices: number[] = ctx.shared.playerIndices ?? [0];

	// Per-character tactic table (from char_id * 0x12 + 0x2f1a)
	// [walkType, moveType, attackRange, specialId, specialRange, bounceDiv]
	// Derived from DATA.DAT character definitions
	const charTactics: number[][] = [];
	for (let i = 0; i < 11; i++) {
		charTactics.push([1, 1, 20, 0, 0, 2]);
	}

	// ══════════════════════════════════════════════════════════
	// FUN_25f1_1139: Fighter spawn/init (line 17935)
	// ══════════════════════════════════════════════════════════
	function initFighter(idx: number, charId: number, x: number, y: number) {
		const s = slots[idx];
		s.fc = x; // 33fc = param_3
		s.fe = y; // 33fe = param_4
		s.v18 = charId; // 3418 = param_2
		s.f6 = 0; // 33f6 = 0
		s.f2 = 1; // 33f2 = 1 (human)
		s.f4 = ctx.characters[charId]?.headPic ?? charId + 1; // 33f4: from DATA.DAT Head:
		s.v1a = 200; // 341a = 200 (max HP)
		s.v16 = 200; // 3416 = 200 (current HP)
		s.v20 = 100; // 3420: starting MP (pre-init value, line 17928)
		s.v1e = 250; // 341e: maxMP (0xfa, line 17927)
		s.f8 = 0x33; // 33f8 = 0x33 (51 lives)
		s.fa = 0x33; // 33fa = 0x33
		s.v0e = 1; // 340e = 1
		s.v14 = 1; // 3414 = 1 (state: walk mode, frame 1)
		s.v12 = 1; // 3412 = 1 (animation frame)
		s.v0c = 0; // 340c = 0
		s.v0a = 0; // 340a = 0
		s.v08 = 0; // 3408 = 0
		s.v06 = 0; // 3406 = 0
		// Facing based on X position (line 17898-17904)
		s.v02 = x < 0xa0 ? 1 : i16(0xffff);
	}

	// ══════════════════════════════════════════════════════════
	// FUN_25f1_1562: Round init (line 18030)
	// ══════════════════════════════════════════════════════════
	function initRound() {
		tickCount = 0; // DAT_3463_49b6 = 0
		scrollX = 0; // DAT_3463_46e1 = 0
		exitFlag = 0; // DAT_3463_2ef6

		// Clear sound queue + f6 for all 30 slots (line 18113-18118)
		for (let i = 0; i < MAX_SLOTS; i++) {
			soundQueue[i] = 0;
			slots[i].f6 = 0;
			if (i >= 8) slots[i].f2 = 0;
		}

		// Reset fighter state for active slots (line 18158-18226)
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (slots[i].f2 === 0) continue;

			hud[i].v42 = Math.floor(slots[i].v1a / 5); // HP bar scale
			hud[i].v44 = Math.floor(slots[i].v1e / 5); // MP bar scale
			hud[i].v40 = 0;
			hud[i].v38 = 0;
			hud[i].v36 = 0;

			slots[i].f8 = 0x33; // lives
			slots[i].fa = 0x33;
			slots[i].v0e = 1;
			slots[i].v14 = 1; // state = walk/idle
			slots[i].v12 = 1; // frame = 1
			slots[i].v00 = 0; // vertical = 0
			slots[i].v0a = 0; // acceleration = 0
			slots[i].v08 = 0; // Y delta = 0
			slots[i].v06 = 0; // X delta = 0
			slots[i].v0c = 0x14; // invuln timer = 20 (line 18175)
			slots[i].v24 = 0; // priority = 0
		}

		// Clear all hitbox slots (line 19141-19144)
		for (let i = 0; i < MAX_HITBOXES; i++) {
			hitboxes[i].type = 0;
		}
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_0025: Sound queue (line 8467)
	// Queues a sound effect with pan-based volume
	// ══════════════════════════════════════════════════════════
	function queueSound(effectId: number, xPos: number) {
		if (effectId < 0 || effectId >= MAX_SLOTS) return;
		// Volume based on distance from center (simplified from decompiled)
		let vol = 0x24; // max volume
		const dist = abs16(xPos - (scrollX + SCREEN_W / 2));
		if (dist > 200) vol = Math.max(1, vol - Math.floor(dist / 20));
		if (vol > soundQueue[effectId]) {
			soundQueue[effectId] = vol;
		}
	}

	// ══════════════════════════════════════════════════════════
	// FUN_25f1_2fef: Play sound (line 18967)
	// Plays s?.wav with given volume
	// ══════════════════════════════════════════════════════════
	function playSound(effectId: number, volume: number) {
		const name = SOUND_NAMES[effectId];
		if (!name) return;
		const vol = Math.min(1.0, volume / 0x24);
		audio.play(name, vol);
	}

	// Drain sound queue each tick (line 19856-19860)
	function drainSoundQueue() {
		for (let i = 0; i < MAX_SLOTS; i++) {
			if (soundQueue[i] > 0) {
				playSound(i, soundQueue[i]);
				soundQueue[i] = 0;
			}
		}
	}

	// ══════════════════════════════════════════════════════════
	// FUN_25f1_2f0a: Spawn hitbox/projectile (line 18932)
	// Allocates a free hitbox slot and fills 11 fields
	// ══════════════════════════════════════════════════════════
	function spawnHitbox(
		x: number,
		y2: number,
		y: number,
		hw: number,
		hh: number,
		dir: number,
		vx: number,
		vy: number,
		type: number,
		lifetime: number,
		owner: number,
	): number {
		for (let i = 0; i < MAX_HITBOXES; i++) {
			if (hitboxes[i].type === 0) {
				hitboxes[i].x = x;
				hitboxes[i].y2 = y2;
				hitboxes[i].y = y;
				hitboxes[i].hw = hw;
				hitboxes[i].hh = hh;
				hitboxes[i].v52 = dir;
				hitboxes[i].v54 = vx;
				hitboxes[i].v56 = vy;
				hitboxes[i].type = type;
				hitboxes[i].v5a = lifetime;
				hitboxes[i].owner = owner;
				return i;
			}
		}
		return -1;
	}

	// Find free entity slot (FUN_25f1_09ec, line 17735)
	function findFreeSlot(): number {
		for (let i = 8; i < MAX_SLOTS; i++) {
			if (slots[i].f2 === 0) return i;
		}
		return -1;
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_28af: Walk/idle handler — state 0-9 (line 9435)
	// ══════════════════════════════════════════════════════════
	function handleWalk(p: number) {
		const s = slots[p];
		// Ground level = 0 (decompiled: iVar5 = 3 for normal, 0 for types 8/9)
		// But v00=0 is the actual ground in screen coords; iVar5=3 is a bounce threshold
		const groundCap = 0;

		// If fallen too far, remove (line 9455-9456)
		if (s.v00 > 199) {
			s.f2 = 0;
			return;
		}

		// Above ground: handle landing/bouncing (line 9458-9503)
		if (s.v00 > groundCap) {
			if (s.v0a < 11) {
				// Small fall: land
				s.v0a = 0;
				s.v00 = groundCap;
				s.v12 = 3; // standing frame
				s.v14 = 1;
				s.f8--; // decrement lives
				if (s.f8 < 1) {
					s.f2 = 0;
					s.v08 = 0;
				}
				// Type 5 special death (line 9470-9474)
				if (s.f8 < 5 && s.v18 === 5) {
					s.v16 = 0;
					s.f2 = 4; // become projectile/angel
				}
			} else {
				// Bounce: reverse and scale acceleration (line 9477-9479)
				const divVal = charTactics[s.v18]?.[5] ?? 2;
				s.v0a = Math.floor(-s.v0a / divVal);
				s.v00 = groundCap - 1;
				// Random X delta if stationary (line 9481-9486)
				if (s.v06 === 0) {
					s.v06 = Math.floor(Math.random() * 19) - 9;
				}
				// Play landing/bounce sound (line 9488-9500)
				const sndId = [0, 2, 3, 6, 25].includes(s.v18) ? 5 : 10;
				queueSound(sndId, s.fc);
			}
			// Halve X delta on each bounce (line 9502-9503)
			s.v06 = Math.floor(s.v06 / 2);
		}

		// Spawn body hitbox when on ground and AI type (line 9513-9520)
		if (s.v00 === groundCap && s.f2 === 2) {
			const dir =
				s.v06 !== 0 ? (s.v06 > 0 ? 1 : -1) : Math.random() > 0.5 ? 1 : -1;
			spawnHitbox(
				s.fc,
				s.fe,
				s.v00,
				5,
				7,
				dir,
				s.v06,
				i16(0xfff9),
				i16(0xfffd),
				0x19,
				p,
			);
			s.v08 = 0;
			s.v04 = -1;
		}

		// Walk cycle when below ground cap (line 9522-9551)
		if (s.v00 < groundCap) {
			do {
				s.v14++;
				if (s.v14 > 6) s.v14 = 1;

				// Set facing from walk state (line 9529-9536)
				if (s.v14 === 1 || s.v14 === 4 || s.v14 === 5) {
					s.v02 = 1;
				} else {
					s.v02 = i16(0xffff);
				}

				// Map walk state to frame (line 9537-9547)
				if (s.v14 === 1 || s.v14 === 6) {
					s.v12 = 1;
				} else if (s.v14 === 3 || s.v14 === 4) {
					s.v12 = 2;
				} else {
					s.v12 = 3;
				}

				// Skip certain frames for defensive character types (line 9548-9551)
				const wt = charTactics[s.v18]?.[1] ?? 1;
				const shouldRepeat = (wt === 2 || wt === 4 || wt === 5) && s.v12 === 3;
				if (!shouldRepeat) break;
			} while (s.v14 <= 6);
		}

		// Gravity: increase acceleration when below ground (line 9561-9563)
		if (s.v00 < groundCap) {
			s.v0a += 3;
		}

		// Clear X delta when grounded and no acceleration (line 9565-9567)
		if (s.v00 === groundCap && s.v0a === 0) {
			s.v06 = 0;
		}
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_3555: Attack handler — state 10-19 (line 9780)
	// ══════════════════════════════════════════════════════════
	// FUN_2b82_2ef7 → FUN_2b82_2f71: Command-driven attack for fighters
	// Commands: 0xb = set v12 + spawn hitbox, 0xc = v14++
	// Simplified: v14 advances each tick, hitbox at v14=13, recovery at v14=16
	function handleFighterAttack(p: number) {
		const s = slots[p];
		const dir = i16(s.v02);

		if (s.v14 === 11) {
			// Wind-up: set attack frame from char data (approximated)
			s.v12 = 11;
			s.v14 = 12;
		} else if (s.v14 === 12) {
			s.v12 = 12;
			s.v14 = 13;
		} else if (s.v14 === 13) {
			// Swing: spawn hitbox (FUN_2b82_2f71 case 0xb, line 24662)
			// Hitbox: x=fc+dir*8, y=fe, z=v00-12, size 8x17,
			// vel dir*5/-7, lifetime 25, damage 500
			s.v12 = 13;
			spawnHitbox(
				s.fc + dir * 8,
				s.fe,
				s.v00 - 12,
				8,
				17,
				dir,
				dir * 5,
				i16(0xfff9),
				25,
				500,
				p,
			);
			s.v24 = 0x32; // priority/hitstun
			queueSound(1, s.fc);
			s.v14 = 14;
		} else if (s.v14 === 14) {
			s.v12 = 14; // follow-through
			s.v14 = 15;
		} else if (s.v14 >= 15) {
			// Recovery: return to idle
			s.v14 = 1;
			s.v12 = 1;
		}
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_42dc: Hit reaction — state 20-29 (line 10051)
	// ══════════════════════════════════════════════════════════
	// Entity attack handler (for f2==2 entities via updateEntity/FUN_161d_43d9)
	function handleAttack(p: number) {
		const s = slots[p];
		s.v14++;
		if (s.v14 >= 20) {
			s.f2 = 0;
		}
	}

	function handleHitReaction(p: number) {
		const s = slots[p];

		// Frame = state - 0x14 (line 10059-10060)
		s.v12 = s.v14 - 20;

		// Clear all velocity (line 10061-10063)
		s.v06 = 0;
		s.v08 = 0;
		s.v0a = 0;

		// If frame reaches 3, start falling (line 10064-10066)
		if (s.v12 === 3) {
			s.v00 = 1; // begin fall
		}

		// At state 23: entities get cleared, fighters recover to idle
		if (s.v14 >= 23) {
			if (p >= MAX_FIGHTERS) {
				s.f2 = 0; // entity: remove
			} else {
				s.v14 = 1; // fighter: back to idle
				s.v12 = 1;
			}
			return;
		}

		// Advance state (line 10070-10071)
		s.v14++;
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_4388: Death handler — state 40-49 (line 10077)
	// ══════════════════════════════════════════════════════════
	function handleDeath(p: number) {
		const s = slots[p];

		// Advance animation frame (line 10085-10086)
		s.v12++;

		// If frame > 3 or character type is 0x18, clear slot (line 10087-10089)
		if (s.v12 > 3 || s.v18 === 0x18) {
			s.f2 = 0;
		}
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_2e22: Airborne/projectile — state 30-39 (line 9574)
	// ══════════════════════════════════════════════════════════
	function handleAirborne(p: number) {
		const s = slots[p];
		const defaultLifetime = 500;

		// Special type 0xf: decrement timer, clear when done (line 9603-9610)
		if (s.v18 === 0xf) {
			s.v0e--;
			if (s.v0e <= 0) s.f2 = 0;
			return;
		}

		// Projectile steering toward target (line 9612-9727)
		if (s.v04 >= 0 && s.v04 < MAX_SLOTS && slots[s.v04].f2 !== 0) {
			const target = slots[s.v04];
			if (target.fc < s.fc) s.v06 = -12;
			else if (target.fc > s.fc) s.v06 = 12;
			if (target.fe < s.fe) s.v08 = -2;
			else if (target.fe > s.fe) s.v08 = 2;
			s.v02 = s.v06 >= 0 ? 1 : i16(0xffff);
		} else {
			s.v06 = i16(s.v02) * 12;
		}

		// Set vertical acceleration (line 9742)
		s.v00 = i16(0xfff9); // -7

		// Toggle animation frame (line 9743-9747)
		s.v12 = 3 - s.v12;
		if (s.v12 < 1) s.v12 = 1;
		if (s.v12 > 2) s.v12 = 2;

		// Spawn projectile hitbox
		spawnHitbox(
			s.fc,
			s.fe,
			s.v00,
			8,
			8,
			i16(s.v02),
			s.v06,
			i16(0xfff9),
			1000 + 30,
			defaultLifetime,
			p,
		);
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_db4a: Fighter update — for ALL fighters f2==1 (line 14200)
	// This is the MAIN update for human AND AI fighters.
	// ══════════════════════════════════════════════════════════
	function updateFighter(p: number) {
		const s = slots[p];

		// Timer decrements (line 14338-14345)
		if (s.v0c > 0) s.v0c--;
		if (s.v22 > 0) s.v22--;

		// Life counter regen (line 14346-14350)
		if (s.f8 < s.fa) s.f8++;

		// MP regen: +1 every other tick parity (line 14329-14337)
		if (tickParity !== 0) {
			if (s.v20 < s.v1e) s.v20++;
		}

		// State dispatch (FUN_161d_db4a line 14357-14474)
		// Decades 3,4,5,6,8 have NO handler for fighters — fall through.
		// Only specific decades have handlers:
		const decade = Math.floor(s.v14 / 10);
		if (decade === 0) {
			// Inline idle check (line 14359-14365)
			// In the original, calls FUN_25f1_2e1b to check special move buffer
		} else if (decade === 1) {
			// Attack: FUN_2b82_2ef7 (command-driven animation)
			// Simplified: advance v14 each tick, spawn hitbox at swing frame
			handleFighterAttack(p);
		} else if (decade === 2) {
			// FUN_2b82_3129: state/animation setup
			// After setup, typically advances to next state
			s.v14++;
			if (s.v14 >= 30) {
				s.v14 = 1;
				s.v12 = 1;
			}
		} else if (decade === 0x28) {
			// Dead/KO: FUN_2b82_26ba
			// Stay in death state, no recovery
		}

		// Jump states (FUN_161d_7fc8, lines 11906-11917)
		if (s.v14 === 0x47) {
			s.v12 = 0x15;
			s.v14 = 0x48;
		} else if (s.v14 === 0x48) {
			s.v0a = i16(0xfff3); // -13 launch
			s.v12 = 0x14; // jump frame (20) — HEAD_OFFSET_Y[20]=0x32, head hidden
			s.v14 = 1;
		} else if (s.v14 === 0x4b) {
			s.v14 = 1;
			s.v12 = 1;
		}

		// Position integration (line 14475-14501) — BEFORE walk animation
		if (s.v06 !== 0) s.fc += s.v06;
		if (s.v08 !== 0) s.fe += s.v08;
		if (s.v0a !== 0) s.v00 += s.v0a;

		// Fighter walk animation (simplified from FUN_25f1_2a27 / FUN_2b82_2978)
		// Fighters use v14=0 for idle. Walk frames cycle v12 through 1-3 based on movement.
		// Landing resets v12=1, v14=0 (line 12083-12085)
		if (s.v12 === 0x15 && s.v00 === 0) {
			s.v12 = 1;
			s.v14 = 0;
		}
		if (s.v14 < 5 && s.v00 === 0 && s.v0a === 0) {
			if (s.v06 !== 0 || s.v08 !== 0) {
				// Walking: cycle v12 through 1→2→3→1
				s.v12++;
				if (s.v12 > 3) s.v12 = 1;
			} else {
				// Idle: v12=1 (standing)
				s.v12 = 1;
			}
		}

		// Y clamping
		const yMin = getYMin(stageIdx) - 3;
		const yMax = getYMax(stageIdx) + 2;
		if (s.fe < yMin) s.fe = yMin;
		if (s.fe > yMax) s.fe = yMax;

		// X bounds (line 10146-10166)
		if (s.f8 < 9) {
			if (s.fc <= scrollX - 0xbe) s.f2 = 0;
			if (s.fc >= scrollX + 0x1fe) s.f2 = 0;
		} else {
			if (s.fc <= scrollX - 0xbe) {
				s.v14 = 1;
				s.v12 = 3;
				s.v0a = i16(0xffef);
				s.v06 = 10;
			}
			if (s.fc >= scrollX + 0x1fe) {
				s.v14 = 1;
				s.v12 = 3;
				s.v0a = i16(0xffef);
				s.v06 = i16(0xfff6);
			}
		}

		// Landing (line 14514-14528)
		if (s.v00 > 0) {
			s.v0a = 0;
			s.v00 = 0;
			s.v12 = 0x15;
			if (Math.floor(s.v14 / 10) !== 4 && Math.floor(s.v14 / 10) !== 0xc) {
				s.v14 = 0x4b;
			}
		}

		// Fall death (line 14529-14531)
		if (s.v00 > 200) s.f2 = 0;

		// Life timer death (line 14538-14541)
		if (s.f8 < 1) {
			s.v14 = 0x20;
			s.f8 = 0;
		}

		// Friction (line 14548-14575)
		if (abs16(s.v06) === 1) s.v06 = 0;
		else if (s.v00 === 0 && s.v12 !== 0x15 && s.v06 !== 0) {
			s.v06 = s.v06 > 0 ? s.v06 - 1 : s.v06 + 1;
		}
		if (abs16(s.v08) === 1) s.v08 = 0;
		else if (s.v00 === 0 && s.v12 !== 0x15 && s.v08 !== 0) {
			s.v08 = s.v08 > 0 ? s.v08 - 1 : s.v08 + 1;
		}

		// Gravity (line 14576-14580)
		if (s.v0a !== 0 && s.v00 < 0) {
			s.v0a += 3;
		}

		if (s.f2 === 0) s.v08 = 0;
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_43d9: Entity update — for spawned entities f2==2 (line 10096)
	// ══════════════════════════════════════════════════════════
	function updateEntity(p: number) {
		const s = slots[p];

		if (s.v0a !== 0) s.v00 = i16(s.v00 + s.v0a);

		const decade = Math.floor(s.v14 / 10);
		if (s.v14 < 10) handleWalk(p);
		else if (decade === 1) handleAttack(p);
		else if (decade === 2) handleHitReaction(p);
		else if (decade === 3) handleAirborne(p);
		else if (decade === 4) handleDeath(p);

		if (decade !== 2 && s.v18 === 0x15) s.f2 = 0;

		if (s.v06 !== 0) s.fc = i16(s.fc + s.v06);
		if (s.v08 !== 0) s.fe = i16(s.fe + s.v08);

		const yMin = getYMin(stageIdx) - 3;
		const yMax = getYMax(stageIdx) + 2;
		if (s.fe < yMin) s.fe = yMin;
		if (s.fe > yMax) s.fe = yMax;

		if (s.f8 < 9) {
			if (s.fc <= scrollX - 0xbe) s.f2 = 0;
			if (s.fc >= scrollX + 0x1fe) s.f2 = 0;
		}

		if (s.f2 === 0) s.v08 = 0;
	}

	// ══════════════════════════════════════════════════════════
	// FUN_161d_0104: Hit detection / collision (line 8512)
	// Scans hitbox slots against fighter for overlap
	// ══════════════════════════════════════════════════════════
	function detectCollisions(p: number) {
		const s = slots[p];
		if (s.f2 === 0) return;

		for (let h = 0; h < MAX_HITBOXES; h++) {
			const hb = hitboxes[h];
			if (hb.type === 0) continue;

			// Skip if same owner (line 8551)
			if (hb.owner === p) continue;

			// Skip if in death state (line 8534/8538)
			const decade = Math.floor(s.v14 / 10);
			if (decade === 4) continue;
			if (decade === 0x28) continue;

			// Priority check (line 8552-8553)
			if (s.v24 > slots[hb.owner]?.v24) continue;

			// Y distance check (line 8540-8549)
			const yDist = abs16(hb.y2 - s.fe);
			if (yDist >= 8) {
				if (yDist >= 16) continue;
				if (slots[hb.owner]?.f2 !== 4) continue;
			}

			// X overlap check (line 8555-8558)
			const xTest = abs16(s.fc + s.v02 * -2 - hb.x);
			if (xTest >= hb.hw + 10) continue;

			// Vertical overlap check (line 8560-8562)
			const vTest = abs16(s.v00 - 10 - hb.y);
			if (vTest >= hb.hh + 11) continue;

			// Team check: skip friendly fire for human fighters (line 8563-8585)
			if (hb.owner < MAX_FIGHTERS && p < MAX_FIGHTERS) {
				if (hud[p]?.v3c === hud[hb.owner]?.v3c && hb.type > 0) continue;
			}

			// Invulnerability check
			if (s.v0c > 0) continue;

			// ── Handle hit by type ──

			if (hb.type > 0) {
				// Normal damage hit (line 8713+)
				const dmg = hb.type % 1000;
				const _kind = Math.floor(hb.type / 1000);

				// Apply damage (line 8714-8767)
				s.v16 -= dmg;
				if (s.v16 < 0) s.v16 = 0;

				// Knockback
				s.v06 = hb.v52 * -4;
				s.v0a = i16(0xfff6); // -10 upward
				s.v00 = 0;

				// Sound effect on hit (line 8818-8826)
				queueSound(2, s.fc);

				// State transition
				if (s.v16 <= 0) {
					// KO: enter death state
					s.v14 = 40;
					s.v12 = 1;
					s.v0a = i16(0xffec); // strong knockup
					queueSound(8, s.fc);
				} else if (dmg > 30) {
					// Heavy hit: fall
					s.v14 = 1;
					s.v12 = 3;
					s.v0a = i16(0xfff6);
					s.v06 = hb.v52 * -6;
				} else {
					// Light hit: stun
					s.v14 = 20;
					s.v12 = 1;
				}

				// Give score/MP to attacker
				if (hb.owner < MAX_FIGHTERS) {
					scores[hb.owner] += dmg;
					slots[hb.owner].v20 = Math.min(
						slots[hb.owner].v1e,
						slots[hb.owner].v20 + Math.floor(dmg / 3),
					);
				}

				// Clear the hitbox after it hits
				hb.type = 0;
				break; // one hit per tick per fighter
			}
		}
	}

	// ══════════════════════════════════════════════════════════
	// Input handling (from FUN_25f1_32be key dispatch)
	// ══════════════════════════════════════════════════════════
	function handleInput(p: number) {
		const s = slots[p];
		if (s.f2 !== 1) return;
		if (s.v04 >= 5) return; // v04 >= 5 = CPU (line 19324)
		const ki = s.v04; // key index from player controller position (0, 1, 2)

		// Movement state guard (line 19392):
		const canMove =
			s.v14 < 5 ||
			s.v14 === 0x47 ||
			s.v14 === 0x48 ||
			Math.floor(s.v14 / 10) === 0xd ||
			s.v14 === 0xfb ||
			s.v12 === 0x2f ||
			s.v12 === 0x30;

		// LEFT (line 19392-19407)
		if (canMove && input.isAsciiDown(KEYS.LEFT[ki])) {
			s.v02 = i16(0xffff);
			if (s.v06 > -5 && s.v00 === 0) s.v06 = -5;
		}
		// RIGHT (line 19408-19423)
		if (canMove && input.isAsciiDown(KEYS.RIGHT[ki])) {
			s.v02 = 1;
			if (s.v06 < 5 && s.v00 === 0) s.v06 = 5;
		}
		// UP (line 19424-19438)
		if (canMove && input.isAsciiDown(KEYS.UP[ki])) {
			if (s.v08 > -3 && s.v00 === 0) s.v08 = -3;
		}
		// DOWN (line 19439-19453)
		if (canMove && input.isAsciiDown(KEYS.DOWN[ki])) {
			if (s.v08 < 3 && s.v00 === 0) s.v08 = 3;
		}

		// JUMP (line 19454-19480)
		if (
			input.isAsciiPressed(KEYS.JUMP[ki]) &&
			(s.v14 < 5 || Math.floor(s.v14 / 10) === 9 || s.v12 === 0x15) &&
			s.v00 === 0 &&
			s.v20 > 9
		) {
			s.v20 -= 10;
			s.v14 = 0x47;
		}

		// ATTACK (line 19516-19526)
		if (
			input.isAsciiPressed(KEYS.ATTACK[ki]) &&
			(s.v14 < 5 ||
				s.v14 === 13 ||
				s.v14 === 14 ||
				s.v14 === 23 ||
				s.v14 === 24 ||
				Math.floor(s.v14 / 10) === 9)
		) {
			s.v14 = 11;
		}

		// Air kick convert (line 19655-19660): if v14==11 && v00<0 → v14=0x15
		if (s.v14 === 11 && s.v00 < 0) {
			s.v14 = 0x15;
		}
	}

	// ══════════════════════════════════════════════════════════
	// AI (simplified port of FUN_161d_46d5 + AI paths)
	// ══════════════════════════════════════════════════════════
	function runAI(p: number) {
		const s = slots[p];
		if (s.f2 !== 1) return;
		if (s.v04 < 5) return; // v04 < 5 = human-controlled, don't use AI

		const decade = Math.floor(s.v14 / 10);
		if (decade === 2 || decade === 4) return; // hit/death: no AI
		if (s.v00 !== 0) return; // airborne

		// Find nearest enemy
		let nearestDist = 9999;
		let nearestIdx = -1;
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (i === p || slots[i].f2 === 0 || slots[i].v16 <= 0) continue;
			if (hud[i]?.v3c === hud[p]?.v3c) continue;
			const dist = abs16(slots[i].fc - s.fc) + abs16(slots[i].fe - s.fe);
			if (dist < nearestDist) {
				nearestDist = dist;
				nearestIdx = i;
			}
		}

		if (nearestIdx < 0) return;
		const target = slots[nearestIdx];

		// Face target
		s.v02 = target.fc > s.fc ? 1 : i16(0xffff);

		// Chase target
		const dx = target.fc - s.fc;
		const dy = target.fe - s.fe;

		if (abs16(dx) > 30) {
			s.v06 = dx > 0 ? 5 : -5;
		} else {
			s.v06 = 0;
		}

		if (abs16(dy) > 8) {
			s.v08 = dy > 0 ? 3 : -3;
		} else {
			s.v08 = 0;
		}

		// Attack when in range: randomly pick v14=11 or 21 (two attack types)
		if (abs16(dx) < 28 && abs16(dy) < 12 && decade < 1) {
			if (Math.random() < 0.15) {
				s.v14 = 11;
			}
		}

		// Occasional jump (same 2-tick system)
		if (Math.random() < 0.02 && s.v00 === 0 && decade < 1) {
			s.v14 = 0x47; // jump prep
		}

		// Walk animation
		if ((s.v06 !== 0 || s.v08 !== 0) && decade === 0 && s.v00 === 0) {
			s.v14++;
			if (s.v14 > 6) s.v14 = 1;
			if (s.v14 === 1 || s.v14 === 6) s.v12 = 1;
			else if (s.v14 === 3 || s.v14 === 4) s.v12 = 2;
			else s.v12 = 3;
		}
	}

	// ══════════════════════════════════════════════════════════
	// Scroll camera (from FUN_25f1_32be rendering setup)
	// ══════════════════════════════════════════════════════════
	function updateScroll() {
		let minX = 9999,
			maxX = -9999;
		let alive = 0;
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (slots[i].f2 !== 0 && slots[i].v16 > 0) {
				minX = Math.min(minX, slots[i].fc);
				maxX = Math.max(maxX, slots[i].fc);
				alive++;
			}
		}
		if (alive === 0) return;
		const center = Math.floor((minX + maxX) / 2);
		const targetX = Math.max(0, Math.min(SCREEN_W, center - SCREEN_W / 2));
		scrollX +=
			Math.sign(targetX - scrollX) * Math.min(2, abs16(targetX - scrollX));
	}

	// ══════════════════════════════════════════════════════════
	// Win check (from FUN_25f1_32be exit logic)
	// ══════════════════════════════════════════════════════════
	function checkWin() {
		if (tickCount < 36) return; // DAT_3463_49b6 min ticks before check

		const teamsAlive = new Set<number>();
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (slots[i].f2 !== 0 && slots[i].v16 > 0) {
				teamsAlive.add(hud[i]?.v3c ?? i);
			}
		}

		if (teamsAlive.size <= 1) {
			matchOver = true;
			if (teamsAlive.size === 1) {
				winnerTeam = [...teamsAlive][0];
			}
		}
	}

	// ══════════════════════════════════════════════════════════
	// Game tick (from FUN_25f1_32be main loop body)
	// ══════════════════════════════════════════════════════════
	function gameTick() {
		if (paused || matchOver) return;

		// ── Step 1: Clear hitboxes + priority (line 19140-19145) ──
		for (let i = 0; i < MAX_HITBOXES; i++) {
			hitboxes[i].type = 0;
		}
		for (let i = 0; i < MAX_SLOTS; i++) {
			slots[i].v24 = 0;
		}

		// ── Step 2: Input for human fighters, AI for CPU fighters ──
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (slots[i].f2 !== 1) continue;
			if (slots[i].v04 < 5) {
				handleInput(i);
			} else {
				runAI(i);
			}
		}

		// ── Step 3: Toggle tick parity (line 19671-19674) ──
		tickParity = 1 - tickParity;

		// ── Step 4: Per-slot update (line 19677-19701) ──
		for (let i = 0; i < MAX_SLOTS; i++) {
			if (slots[i].f2 === 1) updateFighter(i);
			else if (slots[i].f2 === 2) updateEntity(i);
		}

		// ── Step 5: Collision detection for fighters only (line 19712-19773) ──
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (slots[i].f2 !== 1) continue;
			detectCollisions(i);
		}

		// ── Step 6: Camera scroll (line 19774-19796) ──
		updateScroll();

		// ── Step 7: Team tracking + tick counter (line 19797-19818) ──
		checkWin();
		if (matchOver || winnerTeam >= 0) {
			tickCount++;
		}

		// ── Step 8: Sound drain (line 19856-19861) ──
		drainSoundQueue();
	}

	// ══════════════════════════════════════════════════════════
	// Rendering
	// ══════════════════════════════════════════════════════════
	function render() {
		renderer.clear();

		// Background: top 100 rows of BG at Y=56, bottom 44 rows at Y=156
		// From FUN_25f1_038e (line 17508): local_a=100 rows
		// From FUN_25f1_0880 (line 17727): rows 99-143 → bottom HUD area
		const bgPair = BG_PAIRS[stageIdx] ?? BG_PAIRS[0];
		const bg1 = assets.getImage(bgPair[0]);
		const bg2 = assets.getImage(bgPair[1]);
		// Play area: top 100 rows of BG at screen Y=56
		if (bg1) renderer.drawImage(bg1, 0, 0, SCREEN_W, BG_ROWS, -scrollX, BG_Y);
		if (bg2)
			renderer.drawImage(
				bg2,
				0,
				0,
				SCREEN_W,
				BG_ROWS,
				SCREEN_W - scrollX,
				BG_Y,
			);
		// Bottom area: rows 99-143 of BG at screen Y=156
		if (bg1) renderer.drawImage(bg1, 0, 99, SCREEN_W, 45, -scrollX, 156);
		if (bg2)
			renderer.drawImage(bg2, 0, 99, SCREEN_W, 45, SCREEN_W - scrollX, 156);

		// Y-sort active slots (FUN_25f1_1cf9: bubble sort on fe)
		const renderOrder: number[] = [];
		for (let i = 0; i < MAX_SLOTS; i++) {
			if (slots[i].f2 !== 0) renderOrder.push(i);
		}
		renderOrder.sort((a, b) => slots[a].fe - slots[b].fe);

		const actImg1 = assets.getImage("ACT1");
		const actImg2 = assets.getImage("ACT2");

		// Draw sprites (FUN_25f1_1d67)
		for (const idx of renderOrder) {
			const s = slots[idx];
			if (s.f2 === 0) continue;

			const isDead = Math.floor(s.v14 / 10) === 0x28;
			const flip = i16(s.v02) < 0;

			// ── Shadow — ALWAYS drawn, not gated by invuln (line 18293-18297) ──
			// Source: 25x3 sprite from ACT1 at (1, 127), drawn at fc-0xc+v02*-2, fe-1
			if (!isDead && actImg1) {
				renderer.drawSprite(
					actImg1,
					1,
					127,
					25,
					3,
					s.fc - scrollX - 12 + i16(s.v02) * -2,
					s.fe - 1,
					false,
				);
			}

			// ── v22 hit-flash blink (line 18299-18302) ──
			// v22 < 11 AND v22 is even → skip body+head
			if (s.v22 < 11 && s.v22 % 2 === 0 && s.v22 > 0) continue;

			// ── Fighter number text (line 18303-18336) ──
			// Rendered from NEWFONTS.GRH (96x128, 16x16 grid of 6x8 cells)
			// Text: v04 + '1' for humans, 'c' for CPU
			// Position: fc - 2 + v02*-2, fe + v00 - 0x1e
			if (idx < MAX_FIGHTERS && !isDead) {
				const fontsImg = assets.getImage("NEWFONTS");
				if (fontsImg) {
					const charCode = s.v04 >= 5 ? 0x63 : s.v04 + 0x31;
					const fontCol = charCode % 16;
					const fontRow = Math.floor(charCode / 16);
					const fsx = fontCol * 6;
					const fsy = fontRow * 8;
					const facing = i16(s.v02);
					const numX = s.fc - 2 + facing * -2 - scrollX;
					const numY = s.fe + s.v00 - 0x1f;
					// Per-fighter color from FIGHT.EXE 0x165 table:
					// [1,16,31,46,65,108,126,144] → pal[value] from PAL file
					const FIGHTER_COLORS = [
						"#0000ff",
						"#00ff00",
						"#ff0000",
						"#b600ff",
						"#ffff00",
						"#0065a2",
						"#827959",
						"#fb6d8e",
					];
					const tint = FIGHTER_COLORS[idx % FIGHTER_COLORS.length];
					recolorCtx.clearRect(0, 0, ACT_SPR, ACT_SPR);
					recolorCtx.drawImage(fontsImg, fsx, fsy, 5, 7, 0, 0, 5, 7);
					recolorCtx.globalCompositeOperation = "source-in";
					recolorCtx.fillStyle = tint;
					recolorCtx.fillRect(0, 0, 5, 7);
					recolorCtx.globalCompositeOperation = "source-over";
					renderer
						.getOffscreenCtx()
						.drawImage(recolorCanvas, 0, 0, 5, 7, numX, numY, 5, 7);
				}
			}

			// ── Invuln blink (line 18338-18340) — gates body+head only ──
			// v0c < 1 OR v0c is even → draw; else skip body+head
			if (s.v0c > 0 && s.v0c & 1) continue;

			// ── Death state: special sprite (line 18281-18291) ──
			if (isDead) {
				// Blink: only draw if v00 > -50 AND (tickParity%2==0 OR v00 > -25)
				if (s.v00 > -50 && (tickParity % 2 === 0 || s.v00 > -25)) {
					// Death sprite from ACT1 source (1, 79), 25x25
					if (actImg1) {
						const drawX = s.fc - scrollX - 12;
						const drawY = s.fe - 0x18; // NO v00 in Y for death
						drawRecoloredSprite(actImg1, 1, 79, drawX, drawY, flip, s.v18);
					}
				}
				continue; // no head overlay for dead fighters
			}

			// ── Body sprite (line 18360-18382) ──
			let frame = s.v12 - 1;
			if (frame < 0) frame = 0;

			const actImg = frame < ACT1_MAX ? actImg1 : actImg2;
			const localFrame = frame < ACT1_MAX ? frame : frame - ACT1_MAX;

			if (actImg) {
				const sx = (localFrame % ACT_COLS) * ACT_CELL + ACT_PAD;
				const sy = Math.floor(localFrame / ACT_COLS) * ACT_CELL + ACT_PAD;
				const drawX = s.fc - scrollX - 12;
				const drawY = s.fe + s.v00 - 0x18;

				if (idx < MAX_FIGHTERS) {
					drawRecoloredSprite(actImg, sx, sy, drawX, drawY, flip, s.v18);
				} else {
					renderer.drawSprite(
						actImg,
						sx,
						sy,
						ACT_SPR,
						ACT_SPR,
						drawX,
						drawY,
						flip,
					);
				}

				// ── HEAD overlay (line 18412-18428) ──
				// Condition: v12 < 61 AND DAT_4b0d[v12] < 50
				// Position uses per-frame offset tables
				const fi = s.v12;
				// HEAD overlay (line 18412-18428)
				// Condition: v12 < 0x3d AND (byte)DAT_4b0d[v12] < 0x32
				// Source: from HEAD.GRH using f4 (skin variant), NOT charIdx
				// Position: fc + v02*-4 + DAT_4b4a[v12]*v02 - 8, fe + DAT_4b0d[v12] + v00 - 0x18
				if (
					idx < MAX_FIGHTERS &&
					fi > 0 &&
					fi < 61 &&
					HEAD_OFFSET_Y[fi] < 0x32
				) {
					const hImg = assets.getImage("HEAD");
					if (hImg) {
						const f4 = s.f4;
						const hsx = ((f4 - 1) % 11) * 18 + 1;
						const hsy = Math.floor((f4 - 1) / 11) * 13 + 1;
						const facing = i16(s.v02);
						const headX =
							s.fc + facing * -4 + HEAD_OFFSET_X[fi] * facing - 8 - scrollX;
						const headY = s.fe + HEAD_OFFSET_Y[fi] + s.v00 - 0x18;
						renderer.drawSprite(hImg, hsx, hsy, 17, 12, headX, headY, flip);
					}
				}
			}
		}

		// ── HUD rendering (FUN_25f1_292f, lines 18561-18642) ──
		// Step 1: MENU.GRH at (0,0) — opaque, covers top 56 rows over sprites
		const menuImg = assets.getImage("MENU");
		if (menuImg) renderer.drawFullImage(menuImg, 0, HUD_Y);

		// Step 2: Character portraits in HUD (FUN_25f1_00e1, line 17432-17442)
		// Uses cached pre-rendered portrait (body recolored + HEAD overlay)
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (slots[i].f2 === 0) continue;
			const col = i % 4;
			const row = Math.floor(i / 4);
			const dx = col * 0x50 + 6;
			const dy = row * 0x1b + 3;
			const pcvs = getPortraitCanvas(slots[i].v18);
			if (pcvs) renderer.getOffscreenCtx().drawImage(pcvs, dx, dy);
		}

		// Step 3: HP bars ON TOP of MENU (line 18578-18589)
		// X = (i%4)*0x50 + 0x1a, Y = (i/4)*0x1b + row + 10, 5 rows, max 50px wide
		// Color: palette 0x1f (bright) — approximate as white/green
		for (let i = 0; i < MAX_FIGHTERS; i++) {
			if (slots[i].f2 === 0) continue;
			if (slots[i].v16 < 1) continue;
			if (Math.floor(slots[i].v14 / 10) === 0x28) continue;

			const hpBarX = (i % 4) * 0x50 + 0x1a;
			const hpBarBaseY = Math.floor(i / 4) * 0x1b + 10;
			const hpScale = hud[i].v42 > 0 ? hud[i].v42 : 40;
			const hpW = Math.max(0, Math.floor((slots[i].v16 * 10) / hpScale));
			renderer.drawRect(hpBarX, hpBarBaseY, hpW, 5, "#ff0000");

			// Step 4: MP bars ON TOP of MENU (line 18594-18642)
			// Y = (i/4)*0x1b + row + 0x14, same X, 5 rows
			if (slots[i].f2 === 1 && slots[i].v20 > 0) {
				const mpBarBaseY = Math.floor(i / 4) * 0x1b + 0x14;
				const mpScale = hud[i].v44 > 0 ? hud[i].v44 : 50;
				const mpW = Math.max(0, Math.floor((slots[i].v20 * 10) / mpScale));
				const mpColor = getMpBarColor(slots[i].v18, slots[i].v20);
				renderer.drawRect(hpBarX, mpBarBaseY, mpW, 5, mpColor);
			}
		}

		// Pause overlay
		if (paused) {
			renderer.drawRect(0, 0, SCREEN_W, SCREEN_H, "rgba(0,0,0,0.6)");
			renderer.drawText("PAUSED", SCREEN_W / 2 - 24, SCREEN_H / 2 - 10, "#fff");
			renderer.drawText(
				"ESC=Resume  ENTER=Quit",
				SCREEN_W / 2 - 66,
				SCREEN_H / 2 + 10,
				"#aaa",
			);
		}

		// Match over overlay
		if (matchOver) {
			renderer.drawRect(0, 0, SCREEN_W, SCREEN_H, "rgba(0,0,0,0.4)");
			let winText = "DRAW";
			if (winnerTeam >= 0) {
				for (let i = 0; i < MAX_FIGHTERS; i++) {
					if ((hud[i]?.v3c ?? -1) === winnerTeam && slots[i].v16 > 0) {
						const ch = ctx.characters[slots[i].v18];
						winText = ch ? `${ch.name} WINS!` : "WINNER!";
						break;
					}
				}
			}
			renderer.drawText(
				winText,
				SCREEN_W / 2 - winText.length * 4,
				SCREEN_H / 2 - 5,
				"#ff0",
			);
		}
	}

	// ══════════════════════════════════════════════════════════
	// Setup: spawn fighters from selections
	// ══════════════════════════════════════════════════════════
	stageIdx = Math.floor(Math.random() * BG_PAIRS.length);

	for (let i = 0; i < totalSlots && i < MAX_FIGHTERS; i++) {
		const charId = selections[i] ?? 0;
		// Spawn positions spread across stage (line 17896-17905)
		const x = Math.floor(
			40 + (i / Math.max(1, totalSlots - 1)) * (SCREEN_W - 80),
		);
		// From decompiled line 17910: fe = Y_MAX - initial_offset (small offset)
		const y = getYMax(stageIdx) - i * 3;
		initFighter(i, charId, x, y);

		// v04 = player controller index (0-2 for humans, 5 for CPU)
		// From shared data row 2 (line 17885-17886): 0x117[slot]
		// Used for: key lookup, number display (v04+'1'), AI detection
		slots[i].v04 = i < playerIndices.length ? playerIndices[i] : 5;

		// Team assignment
		hud[i].v3c = i < Math.ceil(totalSlots / 2) ? 0 : 1;
		hud[i].v42 = Math.floor(slots[i].v1a / 5);
		hud[i].v44 = Math.floor(slots[i].v1e / 5);
	}

	initRound();
	timer.start();

	// ══════════════════════════════════════════════════════════
	// Main loop (FUN_25f1_32be)
	// ══════════════════════════════════════════════════════════
	// From decompiled line 19863-19874: game loop waits for 2 PIT ticks
	// per frame. PIT runs at 18.2 Hz, so game logic runs every 2 ticks.
	let pitTickAccum = 0;

	return new Promise<void>((resolve) => {
		function frame() {
			if (done || ctx.signal.aborted) return;

			const ticks = timer.update();
			for (let t = 0; t < ticks; t++) {
				if (done) break;
				input.startTick();

				// Pause handling (checked every PIT tick for responsiveness)
				if (input.isAsciiPressed(KEYS.ESCAPE)) {
					if (paused) {
						paused = false;
					} else if (!matchOver) {
						paused = true;
					}
				}

				if (paused) {
					if (input.isAsciiPressed(KEYS.ENTER)) {
						done = true;
						resolve();
						return;
					}
					continue;
				}

				if (matchOver) {
					if (input.anyKeyPressed()) {
						done = true;
						resolve();
						return;
					}
					continue;
				}

				// Run game logic every 2 PIT ticks (line 19871: while delta < 2)
				pitTickAccum++;
				if (pitTickAccum >= 2) {
					pitTickAccum = 0;
					gameTick();
				}
			}

			render();
			renderer.present();
			input.endFrame();
			if (!done) requestAnimationFrame(frame);
		}
		requestAnimationFrame(frame);
	});
}
