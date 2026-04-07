/**
 * contest.ts — Port of CONTEST.EXE
 *
 * From disassembly:
 *   Assets: c1board.grh (213x150), c2board.grh, ccon.grh, condata.grh,
 *           winner.grh, cword.grh, HEAD2.GRH, FACE.GRH, Contest.dat
 *
 *   Functions: _PrintBoard (draw bracket), _brick (bracket cell render),
 *     _routecol (bracket line routing), _choosecon (char select for contest),
 *     _concon (controls config), _winneris, _whowin, _nowround
 *
 *   Flow:
 *     1. Read Contest.dat for bracket state
 *     2. Show bracket (C1BOARD or C2BOARD based on mode)
 *     3. Show current matchup
 *     4. Return to PLAY.COM → FIGHT.EXE runs the match
 *     5. After FIGHT.EXE returns, PLAY.COM loops back to START.EXE
 *        which re-enters contest to advance the bracket
 *
 *   For initial entry: set up bracket from character selections,
 *   display first matchup, then return so FIGHT.EXE runs it.
 */

import { KEYS } from "../engine/input";
import { SCREEN_H, SCREEN_W } from "../engine/renderer";
import type { GameContext } from "../main";

const HEAD2_W = 18;
const HEAD2_H = 16;

export function runContestExe(ctx: GameContext): Promise<void> {
	return new Promise((resolve) => {
		const { renderer, input, assets, timer } = ctx;

		const selections: number[] = ctx.shared.selections ?? [0, 1];
		let done = false;

		timer.start();

		function frame() {
			if (done) return;

			const ticks = timer.update();
			for (let t = 0; t < ticks; t++) {
				if (done) break;
				input.startTick();
				const k = input.inkey();
				if (
					k === KEYS.ENTER ||
					k === KEYS.ATTACK[0] ||
					k === KEYS.ATTACK[1] ||
					k === KEYS.ATTACK[2] ||
					k === KEYS.ESCAPE
				) {
					done = true;
					resolve();
					return;
				}
			}

			render();
			renderer.present();
			input.endFrame();
			requestAnimationFrame(frame);
		}

		function render() {
			renderer.clear();

			const boardImg = assets.getImage("C1BOARD");
			if (boardImg) {
				const dx = (SCREEN_W - 213) / 2;
				const dy = (SCREEN_H - 150) / 2;
				renderer.drawFullImage(boardImg, dx, dy);
			}

			const head2 = assets.getImage("HEAD2");
			if (head2) {
				const slotX = [67, 67, 67, 67, 147, 147, 147, 147];
				const slotY = [85, 100, 115, 130, 85, 100, 115, 130];
				const bx = (SCREEN_W - 213) / 2;
				const by = (SCREEN_H - 150) / 2;

				for (let i = 0; i < Math.min(selections.length, 8); i++) {
					const ch = ctx.characters[selections[i]];
					if (ch) {
						const sx = (ch.headPic - 1) * HEAD2_W;
						renderer.drawImage(
							head2,
							sx,
							0,
							HEAD2_W,
							HEAD2_H,
							bx + slotX[i % slotX.length],
							by + slotY[i % slotY.length],
						);
					}
				}
			}

			renderer.drawText(
				"Press Attack to begin",
				SCREEN_W / 2 - 60,
				SCREEN_H - 12,
				"#0f0",
				7,
			);
		}

		requestAnimationFrame(frame);
	});
}
