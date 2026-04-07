/**
 * fight.ts — Port of FIGHT.EXE
 *
 * From disassembly of _main (0x1b30e):
 *   1. Load data.dat, act1/2.grh, head.grh, weapon.grh, menu.grh, back*.grh
 *   2. Init game state from contest.dat selections
 *   3. Main loop:
 *      a. call 0x1c900 — inkey/input handling
 *      b. call 0x164a7 — game logic (calls 0x15f15 per fighter = MAN_PROCEDURE)
 *      c. call 0x17472 — MAN_PROCEDURE (all fighter state machines)
 *      d. call 0x191ce — WEAPON_PROCEDURE
 *      e. call 0x1b042 — EXPLOSION_PROCEDURE
 *      f. call 0x1b82e — render:
 *         - 0x1d9a0: putbackgrd (draw scrolling background)
 *         - 0x2088d: Sort_Obj (Y-sort for depth)
 *         - 0x1bf8f: render pass (Put_Man, Put_Weapon, Put_Obj)
 *         - 0x1cbac: copy to VGA
 *      g. check win/lose, loop back
 *
 * Background: BACK*.GRH is 320x144, drawn at screen y=0.
 * HUD: MENU.GRH is 320x56, drawn at screen y=144.
 * Sprites: ACT1.GRH (frames 0-64), ACT2.GRH (frames 65-129), 24x26 cells, 13 cols.
 * Weapons: WEAPON.GRH, 18x16 cells, 15 cols.
 * Heads: HEAD.GRH, 18x13 cells, 11 cols x 5 rows.
 *
 * Fighter state machine (from symbol names):
 *   Normal → Running/Punch/Jump/Defend/Pick/Stop
 *   Punch → Normal (combo chains)
 *   Jump → Normal (land) / Wound (hit midair)
 *   Wound → Wound2 → Flow (knockback) → lie → getup → Normal
 *   Angel (death) → remove
 *
 * AI: Stratagem_0 through Stratagem_7, Stratagem_super
 */

import { KEYS } from "../engine/input";
import { SCREEN_H, SCREEN_W } from "../engine/renderer";
import type { GameContext } from "../main";

// From disasm: sprite grid constants
const ACT_FW = 24;
const ACT_FH = 26;
const ACT_COLS = 13;
const ACT1_MAX = 65;

const WEAP_FW = 18;
const WEAP_FH = 16;
const WEAP_COLS = 15;

const HEAD_FW = 18;
const HEAD_FH = 13;
const HEAD_COLS = 11;

// Screen layout from disasm
const BG_H = 144;
const HUD_Y = 144;
const HUD_H = 56;

// Background file pairs (from DATA.DAT Background section)
const BG_PAIRS: [string, string][] = [
	["BACK21", "BACK22"],
	["BACK31", "BACK32"],
	["BACK41", "BACK42"],
	["BACK51", "BACK52"],
	["BACK61", "BACK62"],
];

// Physics constants extracted from typical LF1 behavior
const GRAVITY = 1;
const GROUND_MIN = 118;
const GROUND_MAX = 140;
const WALK_SPEED = 2;
const RUN_SPEED = 4;
const JUMP_VZ = -9;
const PUNCH_RANGE_X = 26;
const PUNCH_RANGE_Y = 10;
const PUNCH_DAMAGE = 20;
const MAX_HP = 500;
const MAX_MP = 500;
const MP_REGEN_RATE = 3;

enum Dir {
	RIGHT = 0,
	LEFT = 1,
}

enum St {
	STAND = 0,
	WALK = 1,
	RUN = 2,
	PUNCH = 3,
	JUMP = 4,
	DEFEND = 5,
	FALL = 6,
	LIE = 7,
	GETUP = 8,
	PICK = 9,
	THROW = 10,
	WOUND = 11,
	CAUGHT = 12,
	ANGEL = 13,
}

// Animation tables: [first_frame, count, ticks_per_frame]
const ANIMS: Record<number, [number, number, number]> = {
	[St.STAND]: [0, 2, 8],
	[St.WALK]: [2, 4, 4],
	[St.RUN]: [6, 4, 3],
	[St.PUNCH]: [10, 3, 3],
	[St.JUMP]: [19, 2, 6],
	[St.DEFEND]: [23, 1, 1],
	[St.FALL]: [24, 2, 4],
	[St.LIE]: [26, 1, 30],
	[St.GETUP]: [27, 2, 6],
	[St.PICK]: [29, 1, 4],
	[St.THROW]: [30, 2, 3],
	[St.WOUND]: [24, 2, 4],
	[St.CAUGHT]: [32, 2, 4],
	[St.ANGEL]: [34, 4, 6],
};

interface Fighter {
	charIdx: number;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	hp: number;
	mp: number;
	state: St;
	dir: Dir;
	frame: number;
	ftimer: number;
	combo: number;
	hitstun: number;
	invuln: number;
	isAI: boolean;
	team: number;
	score: number;
	alive: boolean;
	aiTimer: number;
}

interface Weapon {
	type: number;
	x: number;
	y: number;
	z: number;
	vx: number;
	vz: number;
	owner: number;
	grounded: boolean;
	active: boolean;
}

export function runFightExe(ctx: GameContext): Promise<void> {
	return new Promise((resolve) => {
		const { renderer, input, assets, timer } = ctx;
		const selections: number[] = ctx.shared.selections ?? [0, 1];
		const humanPlayers: number = ctx.shared.humanPlayers ?? 1;
		const totalSlots: number = ctx.shared.totalSlots ?? selections.length;

		const bgIdx = Math.floor(Math.random() * BG_PAIRS.length);
		let bgScrollX = 0;
		let tickCount = 0;
		let matchOver = false;
		let matchTimer = 0;
		let paused = false;
		let done = false;
		let weaponTimer = 0;

		// Init fighters from selections (mirrors FIGHT.EXE NewMan calls)
		const fighters: Fighter[] = [];
		for (let i = 0; i < totalSlots; i++) {
			const ci = selections[i % selections.length];
			const team = i < Math.ceil(totalSlots / 2) ? 0 : 1;
			const startX =
				team === 0
					? 80 + (i % Math.ceil(totalSlots / 2)) * 30
					: 220 + (i - Math.ceil(totalSlots / 2)) * 30;
			fighters.push({
				charIdx: ci,
				x: startX,
				y: GROUND_MIN + 10,
				z: 0,
				vx: 0,
				vy: 0,
				vz: 0,
				hp: MAX_HP,
				mp: 0,
				state: St.STAND,
				dir: team === 0 ? Dir.RIGHT : Dir.LEFT,
				frame: 0,
				ftimer: 0,
				combo: 0,
				hitstun: 0,
				invuln: 0,
				isAI: i >= humanPlayers,
				team,
				score: 0,
				alive: true,
				aiTimer: 0,
			});
		}

		const weapons: Weapon[] = [];

		timer.start();

		function frame() {
			if (done) return;
			const ticks = timer.update();
			for (let t = 0; t < ticks; t++) {
				input.startTick();
				gameTick();
			}
			render();
			renderer.present();
			input.endFrame();
			requestAnimationFrame(frame);
		}

		// ═══════════════════════════════════════════════
		// Game tick — mirrors 0x1b3bf loop body
		// ═══════════════════════════════════════════════
		function gameTick() {
			if (paused || matchOver) return;
			tickCount++;

			// Input (0x1c900)
			if (input.isAsciiPressed(KEYS.ESCAPE)) {
				paused = true;
				return;
			}

			// Human player input
			for (let p = 0; p < humanPlayers && p < fighters.length; p++) {
				handleInput(p);
			}

			// AI (Stratagem_0..7)
			for (let i = humanPlayers; i < fighters.length; i++) {
				runAI(i);
			}

			// MAN_PROCEDURE (0x17472) — update each fighter
			for (const f of fighters) updateFighter(f);

			// WEAPON_PROCEDURE (0x191ce)
			for (const w of weapons) updateWeapon(w);

			// Collision (Detect_hit)
			detectCollisions();

			// MP regen
			if (tickCount % MP_REGEN_RATE === 0) {
				for (const f of fighters) {
					if (f.alive && f.mp < MAX_MP) f.mp++;
				}
			}

			// Weapon spawn
			weaponTimer++;
			if (weaponTimer > 180 && weapons.filter((w) => w.active).length < 4) {
				weaponTimer = 0;
				spawnWeapon();
			}

			// Background scroll (putbackgrd logic)
			updateScroll();

			// Win check
			checkWin();
		}

		function handleInput(idx: number) {
			const f = fighters[idx];
			if (!f.alive || f.hitstun > 0) return;
			if (
				f.state === St.FALL ||
				f.state === St.LIE ||
				f.state === St.GETUP ||
				f.state === St.WOUND ||
				f.state === St.ANGEL
			)
				return;

			const L = input.isAsciiDown(KEYS.LEFT[idx]);
			const R = input.isAsciiDown(KEYS.RIGHT[idx]);
			const U = input.isAsciiDown(KEYS.UP[idx]);
			const D = input.isAsciiDown(KEYS.DOWN[idx]);
			const atk = input.isAsciiPressed(KEYS.ATTACK[idx]);
			const jmp = input.isAsciiPressed(KEYS.JUMP[idx]);
			const def = input.isAsciiDown(KEYS.JUMP[idx]); // defend uses jump for now

			if (f.state === St.JUMP) {
				if (atk) {
					f.state = St.PUNCH;
					f.frame = 0;
					f.ftimer = 0;
				}
				return;
			}

			if (def) {
				f.state = St.DEFEND;
				f.vx = 0;
				f.vy = 0;
				return;
			}

			if (atk) {
				f.state = St.PUNCH;
				f.frame = 0;
				f.ftimer = 0;
				f.combo++;
				return;
			}

			if (jmp && f.z >= 0) {
				f.state = St.JUMP;
				f.vz = JUMP_VZ;
				f.frame = 0;
				f.ftimer = 0;
				if (L) f.vx = -WALK_SPEED;
				else if (R) f.vx = WALK_SPEED;
				return;
			}

			if (L || R) {
				f.state = St.WALK;
				f.dir = R ? Dir.RIGHT : Dir.LEFT;
				f.vx = (R ? 1 : -1) * WALK_SPEED;
				f.vy = U ? -1 : D ? 1 : 0;
			} else if (U || D) {
				f.state = St.WALK;
				f.vx = 0;
				f.vy = U ? -1 : 1;
			} else {
				if (f.state === St.WALK || f.state === St.RUN) {
					f.state = St.STAND;
					f.vx = 0;
					f.vy = 0;
				}
			}
		}

		// AI — simplified Stratagem (original has 8 variants)
		function runAI(idx: number) {
			const f = fighters[idx];
			if (!f.alive || f.hitstun > 0) return;
			if (f.state >= St.FALL && f.state !== St.STAND) return;

			f.aiTimer++;
			if (f.aiTimer < 5) return;
			f.aiTimer = 0;

			let nearest = -1,
				nearDist = Infinity;
			for (let j = 0; j < fighters.length; j++) {
				if (j === idx || !fighters[j].alive || fighters[j].team === f.team)
					continue;
				const d = Math.abs(fighters[j].x - f.x) + Math.abs(fighters[j].y - f.y);
				if (d < nearDist) {
					nearDist = d;
					nearest = j;
				}
			}
			if (nearest < 0) return;

			const t = fighters[nearest];
			const dx = t.x - f.x;
			const dy = t.y - f.y;
			f.dir = dx > 0 ? Dir.RIGHT : Dir.LEFT;

			if (Math.abs(dx) < PUNCH_RANGE_X && Math.abs(dy) < PUNCH_RANGE_Y) {
				if (Math.random() < 0.35) {
					f.state = St.PUNCH;
					f.frame = 0;
					f.ftimer = 0;
				}
			} else {
				f.state = St.WALK;
				f.vx = dx > 0 ? WALK_SPEED : -WALK_SPEED;
				f.vy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
				if (Math.random() < 0.04 && f.z >= 0) {
					f.state = St.JUMP;
					f.vz = JUMP_VZ;
				}
			}
		}

		// MAN_PROCEDURE per fighter
		function updateFighter(f: Fighter) {
			if (!f.alive) return;
			if (f.hitstun > 0) f.hitstun--;
			if (f.invuln > 0) f.invuln--;

			// Gravity
			if (f.z < 0 || f.vz !== 0) {
				f.vz += GRAVITY;
				f.z += f.vz;
				if (f.z >= 0) {
					f.z = 0;
					f.vz = 0;
					if (f.state === St.JUMP) {
						f.state = St.STAND;
						f.vx = 0;
					}
					if (f.state === St.FALL) {
						f.state = St.LIE;
						f.frame = 0;
						f.ftimer = 0;
					}
				}
			}

			// Movement
			if (f.state !== St.PUNCH && f.state !== St.DEFEND && f.state !== St.LIE) {
				f.x += f.vx;
				f.y += f.vy;
			}

			// Bounds
			f.x = Math.max(8, Math.min(312, f.x));
			f.y = Math.max(GROUND_MIN, Math.min(GROUND_MAX, f.y));

			// Animation
			const anim = ANIMS[f.state] ?? ANIMS[St.STAND];
			f.ftimer++;
			if (f.ftimer >= anim[2]) {
				f.ftimer = 0;
				f.frame++;
				if (f.frame >= anim[1]) {
					if (f.state === St.PUNCH) {
						f.state = St.STAND;
						f.combo = 0;
					} else if (f.state === St.LIE) {
						f.state = St.GETUP;
						f.frame = 0;
					} else if (f.state === St.GETUP) {
						f.state = St.STAND;
						f.invuln = 18;
					} else if (f.state === St.WOUND) {
						f.state = St.STAND;
					} else f.frame = 0;
				}
			}

			// Death → Angel
			if (f.hp <= 0 && f.state !== St.ANGEL) {
				f.state = St.ANGEL;
				f.frame = 0;
				f.ftimer = 0;
				f.vx = 0;
				f.vy = 0;
				f.vz = -3;
			}
			if (f.state === St.ANGEL && f.z < -80) f.alive = false;
		}

		function updateWeapon(w: Weapon) {
			if (!w.active) return;
			if (!w.grounded) {
				w.x += w.vx;
				w.z += w.vz;
				w.vz += 0.5;
				if (w.z >= 0) {
					w.z = 0;
					w.vz = 0;
					w.vx = 0;
					w.grounded = true;
				}
			}
		}

		function spawnWeapon() {
			weapons.push({
				type: Math.floor(Math.random() * 5),
				x: 40 + Math.random() * 240,
				y: GROUND_MIN + Math.random() * 15,
				z: -60,
				vx: 0,
				vz: 2,
				owner: -1,
				grounded: false,
				active: true,
			});
		}

		// Detect_hit — collision between punching fighters and targets
		function detectCollisions() {
			for (let i = 0; i < fighters.length; i++) {
				const a = fighters[i];
				if (!a.alive || a.state !== St.PUNCH || a.frame !== 1) continue;

				for (let j = 0; j < fighters.length; j++) {
					if (i === j) continue;
					const b = fighters[j];
					if (!b.alive || b.team === a.team || b.invuln > 0) continue;

					// Defend check
					if (b.state === St.DEFEND) {
						const facing =
							(a.x < b.x && b.dir === Dir.LEFT) ||
							(a.x > b.x && b.dir === Dir.RIGHT);
						if (facing) continue;
					}

					const dx = Math.abs(a.x - b.x);
					const dy = Math.abs(a.y - b.y);
					const dz = Math.abs(a.z - b.z);

					if (dx < PUNCH_RANGE_X && dy < PUNCH_RANGE_Y && dz < 15) {
						b.hp -= PUNCH_DAMAGE;
						b.hitstun = 8;
						b.vx = (a.dir === Dir.RIGHT ? 1 : -1) * 3;
						b.state = St.WOUND;
						b.frame = 0;
						b.ftimer = 0;

						if (b.hp <= 0) {
							b.state = St.FALL;
							b.vz = -5;
							b.vx = (a.dir === Dir.RIGHT ? 1 : -1) * 4;
						}

						a.mp = Math.min(MAX_MP, a.mp + 5);
						a.score += 10;
					}
				}
			}
		}

		// putbackgrd — scroll background to keep fighters centered
		function updateScroll() {
			const alive = fighters.filter((f) => f.alive);
			if (alive.length === 0) return;
			let minX = Infinity,
				maxX = -Infinity;
			for (const f of alive) {
				if (f.x < minX) minX = f.x;
				if (f.x > maxX) maxX = f.x;
			}
			const center = (minX + maxX) / 2;
			const target = Math.max(
				0,
				Math.min(SCREEN_W - SCREEN_W, center - SCREEN_W / 2),
			);
			bgScrollX += (target - bgScrollX) * 0.1;
		}

		function checkWin() {
			if (matchOver) return;
			const teams = new Set<number>();
			for (const f of fighters) if (f.alive) teams.add(f.team);
			if (teams.size <= 1 && tickCount > 36) {
				matchOver = true;
				matchTimer = 0;
			}
		}

		// ═══════════════════════════════════════════════
		// Render — mirrors 0x1b82e
		// ═══════════════════════════════════════════════
		function render() {
			renderer.clear();
			const sx = Math.floor(bgScrollX);

			// putbackgrd: draw background at y=0, 320x144
			const bgPair = BG_PAIRS[bgIdx];
			const bg1 = assets.getImage(bgPair[0]);
			if (bg1) renderer.drawImage(bg1, sx, 0, SCREEN_W, BG_H, 0, 0);

			// Sort_Obj: sort fighters by Y for depth ordering
			const sorted = fighters
				.map((f, i) => ({ f, i }))
				.filter((o) => o.f.alive || o.f.state === St.ANGEL)
				.sort((a, b) => a.f.y - b.f.y);

			// Weapons on ground
			const weapImg = assets.getImage("WEAPON");
			for (const w of weapons) {
				if (!w.active) continue;
				const wx = Math.floor(w.x - sx);
				const wy = Math.floor(w.y + w.z) - WEAP_FH;
				if (weapImg) {
					const col = (w.type * 3) % WEAP_COLS;
					const row = Math.floor((w.type * 3) / WEAP_COLS);
					renderer.drawSprite(
						weapImg,
						col * WEAP_FW,
						row * WEAP_FH,
						WEAP_FW,
						WEAP_FH,
						wx - 9,
						wy,
					);
				}
			}

			// Put_Man: draw each fighter
			const act1 = assets.getImage("ACT1");
			const act2 = assets.getImage("ACT2");
			for (const { f } of sorted) {
				const drawX = Math.floor(f.x - sx) - ACT_FW / 2;
				const drawY = Math.floor(f.y + f.z) - ACT_FH;
				const anim = ANIMS[f.state] ?? ANIMS[St.STAND];
				const frameIdx = anim[0] + (f.frame % anim[1]);
				const sheet = frameIdx < ACT1_MAX ? act1 : act2;
				const localIdx = frameIdx < ACT1_MAX ? frameIdx : frameIdx - ACT1_MAX;
				const col = localIdx % ACT_COLS;
				const row = Math.floor(localIdx / ACT_COLS);
				const flip = f.dir === Dir.LEFT;

				// shadow
				if (f.z < 0) {
					renderer.drawRect(
						Math.floor(f.x - sx) - 8,
						Math.floor(f.y) - 2,
						16,
						4,
						"rgba(0,0,0,0.3)",
					);
				}

				if (sheet && !(f.invuln > 0 && f.invuln % 2 === 0)) {
					renderer.drawSprite(
						sheet,
						col * ACT_FW,
						row * ACT_FH,
						ACT_FW,
						ACT_FH,
						drawX,
						drawY,
						flip,
					);
				}
			}

			// HUD: MENU.GRH at y=144
			const menuImg = assets.getImage("MENU");
			if (menuImg) renderer.drawFullImage(menuImg, 0, HUD_Y);

			// Draw HP/MP bars and head icons per fighter
			const headImg = assets.getImage("HEAD");
			for (let i = 0; i < fighters.length; i++) {
				const f = fighters[i];
				const leftTeam = f.team === 0;
				const slotInTeam = leftTeam
					? i
					: i - fighters.filter((ff) => ff.team === 0).length;
				const baseX = leftTeam
					? 2 + slotInTeam * 80
					: SCREEN_W - 80 - slotInTeam * 80;
				const baseY = HUD_Y + 2;

				// Head icon
				if (headImg && ctx.characters[f.charIdx]) {
					const hid = ctx.characters[f.charIdx].headPic - 1;
					renderer.drawImage(
						headImg,
						hid * HEAD_FW,
						0,
						HEAD_FW,
						HEAD_FH,
						baseX,
						baseY,
					);
				}

				// HP bar
				const barX = baseX + HEAD_FW + 2;
				const barW = 55;
				const hpR = Math.max(0, f.hp / MAX_HP);
				renderer.drawRect(barX, baseY + 1, barW, 5, "#300");
				renderer.drawRect(
					barX,
					baseY + 1,
					Math.floor(barW * hpR),
					5,
					hpR > 0.3 ? "#0c0" : "#f00",
				);

				// MP bar
				const mpR = f.mp / MAX_MP;
				renderer.drawRect(barX, baseY + 8, barW, 4, "#003");
				renderer.drawRect(barX, baseY + 8, Math.floor(barW * mpR), 4, "#00f");
			}

			// Pause overlay
			if (paused) {
				renderer.drawRect(0, 0, SCREEN_W, SCREEN_H, "rgba(0,0,0,0.5)");
				renderer.drawText(
					"PAUSE",
					SCREEN_W / 2 - 16,
					SCREEN_H / 2 - 8,
					"#fff",
					8,
				);
				renderer.drawText(
					"Esc=Resume  Enter=Quit",
					SCREEN_W / 2 - 60,
					SCREEN_H / 2 + 4,
					"#888",
					7,
				);

				if (input.isAsciiPressed(KEYS.ESCAPE)) paused = false;
				if (input.isAsciiPressed(KEYS.ENTER)) {
					done = true;
					resolve();
					return;
				}
			}

			// Match over
			if (matchOver) {
				matchTimer++;
				const winner = fighters.find((f) => f.alive);
				if (winner) {
					const name = ctx.characters[winner.charIdx]?.name ?? "???";
					renderer.drawText(`${name} Wins!`, SCREEN_W / 2 - 30, 70, "#ff0", 8);
				}
				if (matchTimer > 90 || input.anyKeyPressed()) {
					done = true;
					resolve();
					return;
				}
			}
		}

		requestAnimationFrame(frame);
	});
}
