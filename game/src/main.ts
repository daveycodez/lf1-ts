/**
 * main.ts — Exact port of PLAY.COM (original lf1, no mods)
 *
 * PLAY.COM is a compiled batch file that orchestrates the game executables.
 * Strings from the original lf1/PLAY.COM:
 *
 *   /C CD sys
 *   AGAINSTART
 *   EXIT2
 *   CONTEST
 *   NOCONTESCONTEST
 *   FIGHT
 *   /C CD ..
 *
 * Reconstructed logic:
 *
 *   /C CD sys
 *   :AGAIN
 *     START.EXE
 *     IF ERRORLEVEL 2 GOTO EXIT
 *     IF ERRORLEVEL 1 GOTO CONTEST
 *     GOTO NOCONTEST
 *   :CONTEST
 *     CONTEST.EXE
 *   :NOCONTEST
 *     FIGHT.EXE
 *     GOTO AGAIN
 *   :EXIT
 *     /C CD ..
 */

import { parseDataDat } from "./data/parser";
import type {
	BackgroundDef,
	CharacterDef,
	SpecialAttackDef,
	WeaponDef,
} from "./data/types";
import { ASSET_MANIFEST, Assets } from "./engine/assets";
import { Audio } from "./engine/audio";
import { Input } from "./engine/input";
import { Renderer } from "./engine/renderer";
import { GameTimer } from "./engine/timer";
import { runContestExe } from "./screens/contest";
import { runFightExe } from "./screens/fight";
import { runStartExe } from "./screens/start";

export interface GameContext {
	renderer: Renderer;
	input: Input;
	audio: Audio;
	assets: Assets;
	timer: GameTimer;
	characters: CharacterDef[];
	weapons: WeaponDef[];
	backgrounds: BackgroundDef[];
	specials: SpecialAttackDef[];
	aiTable: number[][];
	shared: Record<string, any>;
	signal: AbortSignal;
}

// Exit codes matching DOS ERRORLEVEL from START.EXE
export const EXIT_FIGHT = 0;
export const EXIT_CONTEST = 1;
export const EXIT_QUIT = 2;

let abortController: AbortController | null = null;
let currentScreen = "start";

async function main(startAt = "start") {
	if (abortController) abortController.abort();
	abortController = new AbortController();
	const { signal } = abortController;

	const canvas = document.getElementById("screen") as HTMLCanvasElement;
	const renderer = new Renderer(canvas);
	const input = new Input();
	const audio = new Audio();
	const assets = new Assets();
	const timer = new GameTimer(18.2);

	renderer.resize();
	window.addEventListener("resize", () => renderer.resize());

	renderer.clear();
	renderer.present();

	await renderer.loadFont();
	await assets.loadAll(ASSET_MANIFEST);

	const datResponse = await fetch("/data/DATA.DAT");
	const datText = await datResponse.text();
	const { characters, weapons, specials, backgrounds, aiTable } =
		parseDataDat(datText);

	const soundFiles = [
		"B1",
		"B2",
		"B3",
		"C1",
		"C2",
		"C3",
		"C4",
		"C5",
		"C6",
		"C7",
		"C8",
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
	for (const sf of soundFiles) {
		await audio.loadSound(sf, `/assets/${sf}.WAV`).catch(() => {});
	}

	window.addEventListener("keydown", () => audio.resume(), { once: true });
	window.addEventListener("click", () => audio.resume(), { once: true });

	const ctx: GameContext = {
		renderer,
		input,
		audio,
		assets,
		timer,
		characters,
		weapons,
		backgrounds,
		specials,
		aiTable,
		shared: {},
		signal,
	};

	// ── PLAY.COM main loop ──
	let screen = startAt;
	while (!signal.aborted) {
		currentScreen = screen;

		if (screen === "start") {
			const exitCode = await runStartExe(ctx);
			if (signal.aborted) break;
			if (exitCode >= EXIT_QUIT) break;
			screen = exitCode === EXIT_CONTEST ? "contest" : "fight";
		} else if (screen === "contest") {
			await runContestExe(ctx);
			if (signal.aborted) break;
			screen = "fight";
		} else if (screen === "fight") {
			await runFightExe(ctx);
			if (signal.aborted) break;
			screen = "start";
		}
	}
}

main().catch(console.error);

if (import.meta.hot) {
	import.meta.hot.accept(() => {
		window.location.reload();
	});
}
