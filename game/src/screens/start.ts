/**
 * start.ts — Exact port of START.EXE from Ghidra decompiled C
 *
 * Source: game/tools/start_decompiled.c
 * Key functions ported:
 *   FUN_1520_375b = _main
 *   FUN_1520_090c = MainMenu
 *   FUN_1520_04d0 = init_title_resources (tile background)
 *   FUN_1520_079c = title animation (palette cycling)
 *   FUN_1520_0206 = blit CWORD region (getm + addput)
 *   FUN_1520_0054 = play_sound (b?.wav: B1=join, B2=confirm, B3=navigate)
 *   FUN_1520_0c8e = SetMode
 *   FUN_1520_12e6 = ChooseGroup
 */

import { KEYS } from "../engine/input";
import { SCREEN_H, SCREEN_W } from "../engine/renderer";
import type { GameContext } from "../main";
import { EXIT_CONTEST, EXIT_FIGHT, EXIT_QUIT } from "../main";

let _cancelPrevious: (() => void) | null = null;

// Tile data loaded at runtime from title_tile.json
let tileData: {
	tile_w: number;
	tile_h: number;
	tile: number[];
	pal_181_186: number[][];
	pal_250: number[];
	pal_107: number[];
} | null = null;

// Runtime palette: 256 entries of [r8, g8, b8] from PAL with +1 DAC shift
let gamePalette: [number, number, number][] | null = null;

// Raw indexed pixel data for GRH files used with runtime palette effects
let modePixels: Uint8Array | null = null;
const keyPixels: (Uint8Array | null)[] = [null, null, null];
let cgroupPixels: Uint8Array | null = null; // CGROUP.GRH indexed data (state 2 panel)

// ── Decompiled globals ──
// DAT_1f35_0131: menu selection (1=Start, 2=Versus, 3=Quit, 4=timeout)
// DAT_1f35_00e4: versus mode (0 or 5)
// DAT_1f35_00e6: quit flag
// DAT_1f35_0096: color offset for addput (0=normal, 0x2F=dimmed)
// DAT_1f35_00e2: blink toggle
// DAT_1f35_018b: animation phase (1,2,3)
// DAT_1f35_018d: animation R channel (0-40)
// DAT_1f35_018f: animation G channel (0-40)
// DAT_1f35_0191: animation B channel (0-40)
// DAT_1f35_0193: animation offset counter (1-5)
// DAT_1f35_00d8: game mode category
// DAT_1f35_00da-00e0: sub-mode params

export async function runStartExe(ctx: GameContext): Promise<number> {
	if (!tileData) {
		const resp = await fetch("/data/title_tile.json");
		tileData = await resp.json();
	}
	if (!gamePalette) {
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
	if (!modePixels) {
		const grhBuf = await (await fetch("/assets/MODE.GRH")).arrayBuffer();
		modePixels = new Uint8Array(grhBuf).subarray(300);
	}
	for (let i = 0; i < 3; i++) {
		if (!keyPixels[i]) {
			const buf = await (await fetch(`/assets/KEY${i + 1}.GRH`)).arrayBuffer();
			const raw = new Uint8Array(buf);
			const w = (raw[0] << 8) | raw[1];
			const h = (raw[2] << 8) | raw[3];
			keyPixels[i] = raw.subarray(300, 300 + w * h);
		}
	}
	if (!cgroupPixels) {
		const buf = await (await fetch("/assets/CGROUP.GRH")).arrayBuffer();
		cgroupPixels = new Uint8Array(buf).subarray(300);
	}

	return new Promise((resolve) => {
		if (_cancelPrevious) _cancelPrevious();
		const { renderer, input, audio, assets, timer } = ctx;

		// Port of FUN_1520_0054 — sound files: b?.wav (B1, B2, B3)
		// Volume: (param_2 * 3) / 5, normalized to 0.0–1.0
		const DAT_0189 = 3;
		function playAudio(param_1: number, param_2: number) {
			if (param_1 <= DAT_0189) {
				const vol = (param_2 * 3) / 5 / 25;
				audio.play(`B${param_1}`, vol);
			}
		}

		// ── Decompiled state variables ──
		let DAT_0131 = 1; // menu selection
		let DAT_00e4 = 0; // versus mode toggle
		let DAT_00e6 = 0; // quit flag
		const DAT_0096 = 0; // palette color offset

		// Animation state (FUN_1520_079c)
		// Initial values from data segment at DS:018b-0193:
		let DAT_00e2 = 0; // blink toggle
		let DAT_018b = 1; // phase — DS:018b = 1
		let DAT_018d = 0; // R channel — DS:018d = 0
		let DAT_018f = 0; // G channel — DS:018f = 0
		let DAT_0191 = 60; // B channel — DS:0191 = 0x3C = 60
		let DAT_0193 = 0; // offset counter — DS:0193 = 0

		// Screen state
		type State = "title" | "mode" | "charsel" | "superinfo";
		let state: State = "title";
		let selections: number[] = [];
		let totalSlots = 2;
		let contestMode = false;
		let showSuper = -1;
		let done = false;
		_cancelPrevious = () => {
			done = true;
		};
		let lastInputTime = performance.now();
		let animTickCounter = 0;

		// Mode screen state (FUN_1520_1be8)
		let DAT_00d8 = 1; // category: 1=fighters, 2=game mode, 3=contest
		let DAT_00da = 2; // number of fighters (2-8)
		let DAT_00dc = 2; // scroll position for category 2
		let DAT_00de = 1; // selected sub-mode (1-5)
		let DAT_00e0 = 1; // contest type (1 or 2)

		// Offscreen canvas for indexed MODE rendering
		const modeCanvas = document.createElement("canvas");
		modeCanvas.width = SCREEN_W;
		modeCanvas.height = SCREEN_H;
		const modeCtx = modeCanvas.getContext("2d")!;

		// Pre-build tile canvas for animation
		const TILE_W = tileData!.tile_w;
		const TILE_H = tileData!.tile_h;
		const tileCanvas = document.createElement("canvas");
		tileCanvas.width = TILE_W;
		tileCanvas.height = TILE_H;
		const tileCtx = tileCanvas.getContext("2d")!;
		const tileIndices = tileData!.tile;

		const animPal: number[][] = [
			[0, 0, 0],
			[0, 0, 0],
			[0, 0, 0],
			[0, 0, 0],
			[0, 0, 0],
			[0, 0, 0],
		];
		stepAnimation();

		timer.start();

		function frame() {
			if (done || ctx.signal.aborted) return;

			// Run logic at exactly 18.2Hz (DOS PIT timer rate)
			// timer.update() returns how many 18.2Hz ticks elapsed since last call
			const ticks = timer.update();
			for (let t = 0; t < ticks; t++) {
				if (done) break;
				input.startTick();
				switch (state) {
					case "title":
						updateTitle();
						break;
					case "mode":
						updateMode();
						break;
					case "charsel":
						updateCharSel();
						break;
					case "superinfo":
						updateSuperInfo();
						break;
				}
			}

			// Render at display refresh rate (smooth), but logic is 18.2Hz
			switch (state) {
				case "title":
					renderTitle();
					break;
				case "mode":
					renderMode();
					break;
				case "charsel":
					renderCharSel();
					break;
				case "superinfo":
					renderSuperInfo();
					break;
			}

			renderer.present();
			input.endFrame();
			requestAnimationFrame(frame);
		}

		// ══════════════════════════════════════════════════════
		// FUN_1520_090c: MainMenu
		// ══════════════════════════════════════════════════════
		function updateTitle() {
			// FUN_1520_079c wait loop: animation steps every 2 ticks (lines 7088-7095)
			animTickCounter++;
			if (animTickCounter >= 2) {
				animTickCounter = 0;
				stepAnimation();
			}

			const now = performance.now();

			// TODO: demo timeout disabled for now
			// if (now - lastInputTime > 11000) {
			// 	DAT_0131 = 4;
			// 	done = true;
			// 	resolve(EXIT_QUIT);
			// 	return;
			// }

			// FUN_142d_0ee2: local_3 = inkey()
			const local_3 = inkey();
			if (local_3 !== 0) lastInputTime = now;

			// Line 7193: if local_3 == DAT_017d || DAT_017e || DAT_017f (down)
			if (isDownKey(local_3)) {
				playAudio(3, 0x19);
				DAT_0131 = DAT_0131 + 1;
				if (DAT_0131 > 3) DAT_0131 = 1;
			}

			// Line 7200: if local_3 == DAT_0171 || DAT_0172 || DAT_0173 (up)
			if (isUpKey(local_3)) {
				playAudio(3, 0x19);
				DAT_0131 = DAT_0131 - 1;
				if (DAT_0131 < 1) DAT_0131 = 3;
			}

			// Line 7207: if local_3 == '\r' || DAT_0181 || DAT_0182 || DAT_0183
			if (isConfirmKey(local_3)) {
				if (DAT_0131 === 1) {
					playAudio(2, 0x19);
					state = "mode";
					DAT_00d8 = 1;
					DAT_00da = 2;
					DAT_00de = 1;
					DAT_00dc = 2;
					DAT_00e0 = 1;
					return;
				}
				if (DAT_0131 === 2) {
					playAudio(1, 0x19);
					DAT_00e4 = 5 - DAT_00e4;
				}
				if (DAT_0131 === 3) {
					playAudio(2, 0x19);
					DAT_00e6 = 1;
					done = true;
					resolve(EXIT_QUIT);
					return;
				}
			}
		}

		// Shared: draw the animated tile background (always visible in START.EXE)
		function renderTileBackground() {
			renderer.clear();
			const imgData = tileCtx.createImageData(TILE_W, TILE_H);
			for (let i = 0; i < tileIndices.length; i++) {
				const palIdx = tileIndices[i];
				const slot = palIdx - 181;
				const rgb = animPal[slot] ?? [0, 0, 0];
				imgData.data[i * 4 + 0] = rgb[0];
				imgData.data[i * 4 + 1] = rgb[1];
				imgData.data[i * 4 + 2] = rgb[2];
				imgData.data[i * 4 + 3] = 255;
			}
			tileCtx.putImageData(imgData, 0, 0);
			const offCtx = renderer.getOffscreenCtx();
			for (let ty = 0; ty < 4; ty++) {
				for (let tx = 0; tx < 4; tx++) {
					offCtx.drawImage(tileCanvas, tx * TILE_W, ty * TILE_H);
				}
			}
		}

		function renderTitle() {
			renderTileBackground();

			// ── Draw MAIN.GRH on top (index 0 = transparent) ──
			const mainImg = assets.getImage("MAIN");
			if (mainImg) renderer.drawFullImage(mainImg, 0, 0);

			// ── Render 3 menu items: FUN_1520_0206(sx,sy,w,h,dx,dy) ──
			const cwImg = assets.getImage("CWORD");
			const dimImg = assets.getImage("CWORD_DIM");
			if (!cwImg) return;

			// Item 1 "Start": [0x96]=0 if selected, else 0x2F
			//   FUN_1520_0206(0x50, 0x38, 0x40, 0x0E, 0x80, 0x70)
			blitCword(
				cwImg,
				dimImg,
				DAT_0131 === 1,
				0x50,
				0x38,
				0x40,
				0x0e,
				0x80,
				0x70,
			);

			// Item 2 "Versus" variant based on DAT_00e4
			//   e4==0:  FUN_1520_0206(0x50, 0x00, 0x58, 0x0E, 0x74, 0x85)
			//   e4==5:  FUN_1520_0206(0x50, 0x0E, 0x58, 0x0E, 0x74, 0x85)
			//   e4==10: FUN_1520_0206(0x50, 0x1C, 0x58, 0x0E, 0x74, 0x85)
			let vsy = 0;
			if (DAT_00e4 === 5) vsy = 0x0e;
			else if (DAT_00e4 === 10) vsy = 0x1c;
			blitCword(
				cwImg,
				dimImg,
				DAT_0131 === 2,
				0x50,
				vsy,
				0x58,
				0x0e,
				0x74,
				0x85,
			);

			// Item 3 "Quit":
			//   FUN_1520_0206(0x50, 0x2A, 0x40, 0x0E, 0x80, 0x9A)
			blitCword(
				cwImg,
				dimImg,
				DAT_0131 === 3,
				0x50,
				0x2a,
				0x40,
				0x0e,
				0x80,
				0x9a,
			);
		}

		// Port of FUN_1520_0206: get from CWORD + addput to screen
		function blitCword(
			cwImg: HTMLImageElement,
			dimImg: HTMLImageElement | undefined,
			selected: boolean,
			sx: number,
			sy: number,
			sw: number,
			sh: number,
			dx: number,
			dy: number,
		) {
			// DAT_0096 = 0 when selected, 0x2F when not
			const src = selected ? cwImg : (dimImg ?? cwImg);
			renderer.drawImage(src, sx, sy, sw, sh, dx, dy);
		}

		// ══════════════════════════════════════════════════════
		// FUN_1520_079c: title palette animation (exact port)
		// ══════════════════════════════════════════════════════
		function stepAnimation() {
			// Toggle blink: DAT_00e2 = 1 - DAT_00e2
			DAT_00e2 = 1 - DAT_00e2;

			// Line 7113: save phase BEFORE modification (phases 2/3 check saved value)
			const savedPhase = DAT_018b;

			if (DAT_018b === 1) {
				DAT_0191 -= 2;
				DAT_018d += 2;
				if (DAT_018d === 0x28) DAT_018b = 2;
			}
			if (savedPhase === 2) {
				DAT_018d -= 2;
				DAT_018f += 2;
				if (DAT_018f === 0x28) DAT_018b = 3;
			}
			if (savedPhase === 3) {
				DAT_018f -= 2;
				DAT_0191 += 2;
				if (DAT_0191 === 0x28) DAT_018b = 1;
			}

			DAT_0193 -= 1;
			if (DAT_0193 < 1) DAT_0193 = 5;

			// Line 7141-7151: compute 6 palette entries (181-186)
			// iVar6 = -i, scale = iVar6 + 0xd = 13 - i (range 12..7)
			let DAT_2b9c = DAT_0193;
			for (let i = 1; i < 7; i++) {
				const scale = 13 - i; // decompiled: (-i) + 0xd
				DAT_2b9c += 1;
				if (DAT_2b9c > 6) DAT_2b9c = 1;

				const r6 = Math.floor((scale * DAT_018d) / 0xc);
				const g6 = Math.floor((scale * DAT_018f) / 0xc);
				const b6 = Math.floor((scale * DAT_0191) / 0xc);

				const slot = DAT_2b9c - 1;
				animPal[slot] = [
					(r6 << 2) | (r6 >> 4),
					(g6 << 2) | (g6 >> 4),
					(b6 << 2) | (b6 >> 4),
				];
			}
		}

		// ══════════════════════════════════════════════════════
		// Input: exact match of decompiled FUN_1520_090c key checks
		//
		// local_3 = FUN_142d_0ee2()  → inkey() returns ASCII char
		// Down: local_3 == DAT_017d || DAT_017e || DAT_017f
		// Up:   local_3 == DAT_0171 || DAT_0172 || DAT_0173
		// Confirm: local_3 == '\r' || DAT_0181 || DAT_0182 || DAT_0183
		// ══════════════════════════════════════════════════════
		function inkey(): number {
			return input.inkey();
		}
		function isDownKey(key: number): boolean {
			return (
				key === KEYS.DOWN[0] || key === KEYS.DOWN[1] || key === KEYS.DOWN[2]
			);
		}
		function isUpKey(key: number): boolean {
			return key === KEYS.UP[0] || key === KEYS.UP[1] || key === KEYS.UP[2];
		}
		function isConfirmKey(key: number): boolean {
			return (
				key === KEYS.ENTER ||
				key === KEYS.ATTACK[0] ||
				key === KEYS.ATTACK[1] ||
				key === KEYS.ATTACK[2]
			);
		}
		function isLeftKey(key: number): boolean {
			return (
				key === KEYS.LEFT[0] || key === KEYS.LEFT[1] || key === KEYS.LEFT[2]
			);
		}
		function isRightKey(key: number): boolean {
			return (
				key === KEYS.RIGHT[0] || key === KEYS.RIGHT[1] || key === KEYS.RIGHT[2]
			);
		}

		// ══════════════════════════════════════════════════════
		// FUN_1520_1be8: Mode Select (3-category navigation)
		//
		// Category 1 (DAT_00d8=1): number of fighters (DAT_00da, 2-8)
		// Category 2 (DAT_00d8=2): game sub-mode (DAT_00de, 1-5)
		// Category 3 (DAT_00d8=3): contest type (DAT_00e0, 1 or 2)
		// ══════════════════════════════════════════════════════
		function updateMode() {
			animTickCounter++;
			if (animTickCounter >= 2) {
				animTickCounter = 0;
				stepAnimation();
			}

			const k = inkey();
			if (k === 0) return;

			if (isConfirmKey(k)) {
				playAudio(2, 0x19);
				totalSlots = DAT_00da;
				contestMode = DAT_00e0 === 2;
				initCharSel();
				state = "charsel";
				return;
			}
			if (k === KEYS.ESCAPE) {
				state = "title";
				return;
			}

			// Per-player key checks (any of 3 players can navigate)
			// DS offsets: 0x171=UP, 0x175=LEFT, 0x179=RIGHT, 0x17d=DOWN
			for (let p = 0; p < 3; p++) {
				if (DAT_00d8 === 1) {
					if (KEYS.LEFT[p] === k) {
						playAudio(3, 0x19);
						DAT_00da -= 1;
					}
					if (KEYS.RIGHT[p] === k) {
						playAudio(3, 0x19);
						DAT_00da += 1;
					}
					if (KEYS.UP[p] === k) {
						playAudio(3, 0x19);
						DAT_00d8 = 3;
					}
					if (KEYS.DOWN[p] === k) {
						playAudio(3, 0x19);
						DAT_00de = 1;
						DAT_00dc = 2;
						DAT_00d8 = 2;
					}
					if (DAT_00da < 2) DAT_00da = 8;
					if (DAT_00da > 8) DAT_00da = 2;
				} else if (DAT_00d8 === 2) {
					if (KEYS.UP[p] === k) {
						playAudio(3, 0x19);
						const v = DAT_00de - 1;
						if (v < 4) {
							DAT_00dc = 2;
							DAT_00de = v;
						} else {
							DAT_00dc = DAT_00de - 2;
							DAT_00de = v;
						}
					}
					if (KEYS.DOWN[p] === k) {
						playAudio(3, 0x19);
						const v = DAT_00de + 1;
						if (v < 4) {
							DAT_00dc = 2;
							DAT_00de = v;
						} else {
							DAT_00dc = DAT_00de;
							DAT_00de = v;
						}
					}
					if (DAT_00de < 1) DAT_00d8 = 1;
					if (DAT_00de > 5) DAT_00d8 = 3;
				} else if (DAT_00d8 === 3) {
					if (KEYS.LEFT[p] === k || KEYS.RIGHT[p] === k) {
						playAudio(3, 0x19);
						DAT_00e0 = 3 - DAT_00e0;
					}
					if (KEYS.UP[p] === k) {
						playAudio(3, 0x19);
						DAT_00de = 5;
						DAT_00dc = 4;
						DAT_00d8 = 2;
					}
					if (KEYS.DOWN[p] === k) {
						playAudio(3, 0x19);
						DAT_00d8 = 1;
					}
				}
			}
		}

		// FUN_1520_0179: replace colorA with colorB in rectangle (x1,y1)-(x2,y2)
		// Operates on indexed pixel buffer
		function colorReplace(
			buf: Uint8Array,
			w: number,
			x1: number,
			y1: number,
			x2: number,
			y2: number,
			findIdx: number,
			replaceIdx: number,
		) {
			for (let y = y1; y <= y2; y++) {
				for (let x = x1; x <= x2; x++) {
					if (buf[y * w + x] === findIdx) buf[y * w + x] = replaceIdx;
				}
			}
		}

		function renderMode() {
			if (!modePixels || !gamePalette) return;

			renderTileBackground();

			const buf = new Uint8Array(modePixels.length);
			buf.set(modePixels);

			if (DAT_00d8 === 1) {
				colorReplace(buf, SCREEN_W, 0x24, 0xa6, 0x67, 0xbc, 0x62, 0x76);
				colorReplace(buf, SCREEN_W, 0x69, 0xa6, 0x118, 0xbc, 0x22, 0x23);
				colorReplace(buf, SCREEN_W, 0x24, 0xa6, 0x118, 0xbc, 0x0f, 0x0d);
				colorReplace(buf, SCREEN_W, 0x24, 0x45, 0x67, 0xa4, 0x62, 0x76);
				colorReplace(buf, SCREEN_W, 0x69, 0x45, 0x118, 0xa4, 0x22, 0x23);
				colorReplace(buf, SCREEN_W, 0x24, 0x45, 0x118, 0xa4, 0x0f, 0x0d);
				const cx = (DAT_00da - 2) * 0x18 + 0x72;
				colorReplace(buf, SCREEN_W, cx, 0x36, cx + 0x0e, 0x42, 0x22, 0x1f);
			} else if (DAT_00d8 === 2) {
				colorReplace(buf, SCREEN_W, 0x24, 0xa6, 0x67, 0xbc, 0x62, 0x76);
				colorReplace(buf, SCREEN_W, 0x69, 0xa6, 0x118, 0xbc, 0x22, 0x23);
				colorReplace(buf, SCREEN_W, 0x24, 0xa6, 0x118, 0xbc, 0x0f, 0x0d);
				colorReplace(buf, SCREEN_W, 0x24, 0x24, 0x67, 0x43, 0x62, 0x76);
				colorReplace(buf, SCREEN_W, 0x69, 0x24, 0x118, 0x43, 0x22, 0x23);
				colorReplace(buf, SCREEN_W, 0x24, 0x24, 0x118, 0x43, 0x0f, 0x0d);
				const cy = (DAT_00de - 1) * 0x12 + 0x49;
				colorReplace(buf, SCREEN_W, 0x80, cy, 0x101, cy + 0x11, 0x22, 0x1f);
			} else if (DAT_00d8 === 3) {
				colorReplace(buf, SCREEN_W, 0x24, 0x45, 0x67, 0xa4, 0x62, 0x76);
				colorReplace(buf, SCREEN_W, 0x69, 0x45, 0x118, 0xa4, 0x22, 0x23);
				colorReplace(buf, SCREEN_W, 0x24, 0x45, 0x118, 0xa4, 0x0f, 0x0d);
				colorReplace(buf, SCREEN_W, 0x24, 0x24, 0x67, 0x43, 0x62, 0x76);
				colorReplace(buf, SCREEN_W, 0x69, 0x24, 0x118, 0x43, 0x22, 0x23);
				colorReplace(buf, SCREEN_W, 0x24, 0x24, 0x118, 0x43, 0x0f, 0x0d);
				const cx = (DAT_00e0 - 1) * 0x5a + 0x72;
				colorReplace(buf, SCREEN_W, cx, 0xa8, cx + 0x42, 0xb9, 0x22, 0x1f);
			}

			// Convert indexed buffer to RGBA — index 0 = transparent (tile bg shows through)
			const imgData = modeCtx.createImageData(SCREEN_W, SCREEN_H);
			const pal = gamePalette!;
			for (let i = 0; i < SCREEN_W * SCREEN_H; i++) {
				const idx = buf[i];
				if (idx === 0) {
					imgData.data[i * 4 + 3] = 0;
				} else {
					const c = pal[idx];
					imgData.data[i * 4 + 0] = c[0];
					imgData.data[i * 4 + 1] = c[1];
					imgData.data[i * 4 + 2] = c[2];
					imgData.data[i * 4 + 3] = 255;
				}
			}
			modeCtx.putImageData(imgData, 0, 0);
			renderer.getOffscreenCtx().drawImage(modeCanvas, 0, 0);
		}

		// ══════════════════════════════════════════════════════
		// FUN_1520_0c8e: Character Selection (exact port)
		//
		// 3 player panels (107px wide each) at y=32.
		// Per-player state: 0=idle, 1=selecting char, 2=selecting group, 3=confirmed
		// DS:0x165+p*2 = state, DS:0x16b+p*2 = charIdx (1-based)
		// DS:0x133+p*2 = groupIdx (1-4, used in state 2 only)
		// ══════════════════════════════════════════════════════
		const PANEL_W = 0x6b; // 107
		const MAX_CHARS = 11; // DAT_00e8
		const SUPER_NAMES = [
			"SUPERA",
			"SUPERB",
			"SUPERC",
			"SUPERD",
			"SUPERE",
			"SUPERF",
			"SUPERG",
			"SUPERH",
			"SUPERI",
			"SUPERJ",
			"SUPERK",
		];
		const playerState = [0, 0, 0]; // 0=idle, 1=selecting, 2=group, 3=confirmed
		const playerChar = [1, 2, 3]; // 1-based character index
		const playerGroup = [1, 1, 1]; // DS:0x133+p*2, group selection (1-4)
		const groupAvail = ["N", "T", "T", "T", "T"]; // DS:0x102, index 0 unused
		const groupCount = [0, 0, 0, 0, 0]; // DS:0x127+i*2, members per group
		let charSelJoinCount = 0;
		let charSelMaxSlots = 8;
		let charSelAnyJoined = false;
		let charSelAnimFrame = 1;
		let charSelExitCountdown = -1;

		function initCharSel() {
			playerState[0] = 0;
			playerState[1] = 0;
			playerState[2] = 0;
			playerChar[0] = 1;
			playerChar[1] = 2;
			playerChar[2] = 3;
			playerGroup[0] = 1;
			playerGroup[1] = 1;
			playerGroup[2] = 1;
			groupAvail[0] = "N";
			groupAvail[1] = "T";
			groupAvail[2] = "T";
			groupAvail[3] = "T";
			groupAvail[4] = "T";
			groupCount[0] = 0;
			groupCount[1] = 0;
			groupCount[2] = 0;
			groupCount[3] = 0;
			groupCount[4] = 0;
			charSelJoinCount = 0;
			charSelAnyJoined = false;
			charSelAnimFrame = 1;
			charSelExitCountdown = -1;
			charSelMaxSlots = DAT_00d8 === 1 ? DAT_00da : 8;
		}

		function updateCharSel() {
			animTickCounter++;
			if (animTickCounter >= 2) {
				animTickCounter = 0;
				stepAnimation();
			}

			// Post-confirmation countdown (15 animation ticks ≈ 1.6s)
			if (charSelExitCountdown > 0) {
				charSelExitCountdown--;
				return;
			}
			if (charSelExitCountdown === 0) {
				selections = [];
				for (let p = 0; p < 3; p++) {
					if (playerState[p] === 3) selections.push(playerChar[p] - 1);
				}
				while (selections.length < totalSlots) {
					selections.push(Math.floor(Math.random() * MAX_CHARS));
				}
				ctx.shared.selections = selections;
				ctx.shared.humanPlayers = charSelJoinCount;
				ctx.shared.totalSlots = totalSlots;
				done = true;
				resolve(contestMode ? EXIT_CONTEST : EXIT_FIGHT);
				return;
			}

			// local_15 check: computed BEFORE state transitions (line 7323-7332)
			// Done when at least one joined AND all players are idle(0) or confirmed(3)
			let local_15 = charSelAnyJoined;
			for (let p = 0; p < 3; p++) {
				if (playerState[p] !== 0 && playerState[p] !== 3) local_15 = false;
			}
			if (local_15) {
				charSelExitCountdown = 15; // wait 15 anim steps then exit
			}

			const k = inkey();

			updateGroupAvail();

			if (k === 0) return;

			charSelAnimFrame++;
			if (charSelAnimFrame > 4) charSelAnimFrame = 1;

			let local_13 = k;
			for (let p = 0; p < 3; p++) {
				// ATTACK: state 2 confirm (line 7376)
				if (KEYS.ATTACK[p] === local_13 && playerState[p] === 2) {
					playAudio(2, 0x19);
					playerState[p] = 3;
					groupCount[playerGroup[p]]++;
				}
				// ATTACK: state 1 confirm (line 7382)
				if (KEYS.ATTACK[p] === local_13 && playerState[p] === 1) {
					playAudio(2, 0x19);
					playerState[p] = 2;
					if (DAT_00d8 !== 2) {
						playerState[p] = 3;
					}
				}
				// Auto-advance: if in state 2 and current group unavailable (line 7389-7391)
				if (playerState[p] === 2 && groupAvail[playerGroup[p]] === "F") {
					local_13 = KEYS.DOWN[p];
				}
				// ATTACK: state 0 join (line 7393)
				if (
					KEYS.ATTACK[p] === local_13 &&
					playerState[p] === 0 &&
					charSelJoinCount < charSelMaxSlots
				) {
					playAudio(1, 0x19);
					playerState[p] = 1;
					charSelAnyJoined = true;
					charSelJoinCount++;
					local_13 = KEYS.RIGHT[p]; // consume key (line 7398)
				}

				// LEFT (DS:0x175): prev character (state 1, line 7401)
				if (KEYS.LEFT[p] === local_13 && playerState[p] === 1) {
					playAudio(3, 0x19);
					do {
						playerChar[p]--;
						if (playerChar[p] < 1) playerChar[p] = MAX_CHARS;
					} while (isCharTaken(p));
				}
				// RIGHT (DS:0x179): next character (state 1, line 7419)
				if (KEYS.RIGHT[p] === local_13 && playerState[p] === 1) {
					playAudio(3, 0x19);
					do {
						playerChar[p]++;
						if (playerChar[p] > MAX_CHARS) playerChar[p] = 1;
					} while (isCharTaken(p));
				}

				// UP (DS:0x171): prev group (state 2, line 7437)
				if (KEYS.UP[p] === local_13 && playerState[p] === 2) {
					playAudio(3, 0x19);
					do {
						playerGroup[p]--;
						if (playerGroup[p] < 1) playerGroup[p] = 4;
					} while (groupAvail[playerGroup[p]] === "F");
				}
				// DOWN (DS:0x17d): next group (state 2, line 7451)
				if (KEYS.DOWN[p] === local_13 && playerState[p] === 2) {
					playAudio(3, 0x19);
					do {
						playerGroup[p]++;
						if (playerGroup[p] > 4) playerGroup[p] = 1;
					} while (groupAvail[playerGroup[p]] === "F");
				}
			}
		}

		// FUN_1520_0be6: update group availability flags each frame (lines 7265-7278)
		function updateGroupAvail() {
			for (let g = 1; g < 5; g++) {
				groupAvail[g] = "T";
				if (DAT_00d8 === 2 && g > DAT_00dc) {
					groupAvail[g] = "F";
				}
				if (
					DAT_00d8 === 2 &&
					(DAT_00de === 1 || DAT_00de === 4 || DAT_00de === 5) &&
					groupCount[g] >= 2
				) {
					groupAvail[g] = "F";
				}
			}
		}

		function isCharTaken(p: number): boolean {
			for (let other = 0; other < 3; other++) {
				if (
					other !== p &&
					playerChar[p] === playerChar[other] &&
					playerState[other] > 0
				) {
					return true;
				}
			}
			return false;
		}

		function renderCharSel() {
			renderTileBackground();

			const cwImg = assets.getImage("CWORD");
			const dimImg = assets.getImage("CWORD_DIM");
			const faceImg = assets.getImage("FACE");

			// Status bar from CWORD (FUN_1520_0206 calls)
			if (cwImg) {
				blitCword(cwImg, dimImg, true, 0, 0x6a, 0x40, 0x0e, 0x80, 0);
				blitCword(cwImg, dimImg, true, 0, 0x78, 0x40, 0x0e, 0x15, 0x10);
				blitCword(cwImg, dimImg, true, 0, 0x86, 0x40, 0x0e, 0x7f, 0x10);
				blitCword(cwImg, dimImg, true, 0, 0x94, 0x40, 0x0e, 0xe9, 0x10);
			}

			for (let p = 0; p < 3; p++) {
				const px = p * PANEL_W;
				const py = 0x20;

				// Panel background based on state
				if (playerState[p] === 0) {
					renderKeyPanel(p, px, py);
				} else if (playerState[p] === 1) {
					const charIdx = playerChar[p];
					const superImg =
						charIdx >= 1 && charIdx <= SUPER_NAMES.length
							? assets.getImage(SUPER_NAMES[charIdx - 1])
							: null;
					if (superImg) renderer.drawFullImage(superImg, px, py);
				} else if (playerState[p] === 2) {
					renderGroupPanel(p, px, py);
				} else if (playerState[p] === 3) {
					const endcImg = assets.getImage("ENDC");
					if (endcImg) renderer.drawFullImage(endcImg, px, py);
				}

				// Face preview (state 1 only): at panel_x + 0x35, y = 0x23
				if (playerState[p] === 1 && faceImg) {
					const ch = ctx.characters[playerChar[p] - 1];
					if (ch) {
						renderer.drawImage(
							faceImg,
							(ch.faceRow - 1) * 50,
							(ch.faceCol - 1) * 50,
							50,
							50,
							px + 0x35,
							0x23,
						);
					}
				}
			}
		}

		// Render group selection panel (state 2) with CGROUP.GRH (106x152)
		// FUN_1520_0be6 dims unavailable groups,
		// FUN_1520_0179 highlights selected group cursor (line 7372-7374)
		// Color replacement coords in decompiled are screen-relative;
		// subtract panel origin (px, 0x20) to get buffer-relative coords
		function renderGroupPanel(p: number, dx: number, dy: number) {
			if (!cgroupPixels || !gamePalette) return;

			const pw = 106;
			const ph = 152;
			const buf = new Uint8Array(cgroupPixels.length);
			buf.set(cgroupPixels);

			for (let g = 1; g < 5; g++) {
				if (groupAvail[g] === "F") {
					const y1 = (g - 1) * 0x11 + 0x52 - 0x20;
					const y2 = (g - 1) * 0x11 + 0x60 - 0x20;
					colorReplace(buf, pw, 0x15, y1, 0x54, y2, 0x0f, 0x0c);
				}
			}

			const g = playerGroup[p];
			const cy1 = (g - 1) * 0x11 + 0x52 - 0x20;
			const cy2 = (g - 1) * 0x11 + 0x60 - 0x20;
			colorReplace(buf, pw, 0x15, cy1, 0x54, cy2, 0x6c, 0x6a);

			const panelCanvas = document.createElement("canvas");
			panelCanvas.width = pw;
			panelCanvas.height = ph;
			const pCtx = panelCanvas.getContext("2d")!;
			const imgData = pCtx.createImageData(pw, ph);
			const pal = gamePalette;
			for (let i = 0; i < pw * ph && i < buf.length; i++) {
				const idx = buf[i];
				if (idx === 0) {
					imgData.data[i * 4 + 3] = 0;
				} else {
					const c = pal[idx];
					imgData.data[i * 4 + 0] = c[0];
					imgData.data[i * 4 + 1] = c[1];
					imgData.data[i * 4 + 2] = c[2];
					imgData.data[i * 4 + 3] = 255;
				}
			}
			pCtx.putImageData(imgData, 0, 0);
			renderer.getOffscreenCtx().drawImage(panelCanvas, dx, dy);
		}

		// Render KEY?.GRH panel with indexed pixels + palette 250 blink
		function renderKeyPanel(p: number, dx: number, dy: number) {
			const pixels = keyPixels[p];
			if (!pixels || !gamePalette) return;

			const pw = 106; // KEY?.GRH is 106x152
			const ph = 152;
			const panelCanvas = document.createElement("canvas");
			panelCanvas.width = pw;
			panelCanvas.height = ph;
			const pCtx = panelCanvas.getContext("2d")!;
			const imgData = pCtx.createImageData(pw, ph);

			// Build runtime palette with entry 250 toggled by blink
			// DAT_00e2 toggles each animation step: 0=white, 1=normal color
			const pal = gamePalette;
			const blink250: [number, number, number] =
				DAT_00e2 === 0
					? [255, 255, 255] // white phase
					: pal[250]; // normal color phase

			for (let i = 0; i < pw * ph && i < pixels.length; i++) {
				const idx = pixels[i];
				if (idx === 0) {
					imgData.data[i * 4 + 3] = 0; // transparent
				} else {
					const c = idx === 250 ? blink250 : pal[idx];
					imgData.data[i * 4 + 0] = c[0];
					imgData.data[i * 4 + 1] = c[1];
					imgData.data[i * 4 + 2] = c[2];
					imgData.data[i * 4 + 3] = 255;
				}
			}
			pCtx.putImageData(imgData, 0, 0);
			renderer.getOffscreenCtx().drawImage(panelCanvas, dx, dy);
		}

		function updateSuperInfo() {
			if (input.anyKeyPressed()) {
				state = "charsel";
				showSuper = -1;
			}
		}
		function renderSuperInfo() {
			renderCharSel();
			if (showSuper >= 0 && showSuper < SUPER_NAMES.length) {
				const img = assets.getImage(SUPER_NAMES[showSuper]);
				if (img)
					renderer.drawFullImage(
						img,
						(SCREEN_W - 106) / 2,
						(SCREEN_H - 152) / 2,
					);
			}
		}

		requestAnimationFrame(frame);
	});
}
