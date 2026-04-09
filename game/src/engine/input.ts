/**
 * input.ts — Keyboard input matching DOS key bindings
 *
 * From START.EXE data segment DS:0171-0187:
 *   P1: UP=w(0x77) DOWN=x(0x78) LEFT=a(0x61) RIGHT=d(0x64) ATTACK=s(0x73) JUMP=Tab(0x09)
 *   P2: UP=i(0x69) DOWN=,(0x2c) LEFT=j(0x6a) RIGHT=l(0x6c) ATTACK=k(0x6b) JUMP=Space(0x20)
 *   P3: UP=8(0x38) DOWN=2(0x32) LEFT=4(0x34) RIGHT=6(0x36) ATTACK=5(0x35) JUMP=0(0x30)
 *
 * DOS inkey() (FUN_142d_0ee2) returns 0 if no key, else the ASCII char.
 * It only returns one key per call and consumes it.
 */

const KEY_TO_ASCII: Record<string, number> = {
	w: 0x77,
	a: 0x61,
	d: 0x64,
	x: 0x78,
	s: 0x73,
	W: 0x77,
	A: 0x61,
	D: 0x64,
	X: 0x78,
	S: 0x73,
	Tab: 0x09,
	i: 0x69,
	j: 0x6a,
	l: 0x6c,
	",": 0x2c,
	k: 0x6b,
	I: 0x69,
	J: 0x6a,
	L: 0x6c,
	K: 0x6b,
	" ": 0x20,
	"8": 0x38,
	"4": 0x34,
	"6": 0x36,
	"2": 0x32,
	"5": 0x35,
	"0": 0x30,
	Enter: 0x0d,
	Escape: 0x1b,
};

const P1_UP = 0x77,
	P1_LEFT = 0x61,
	P1_RIGHT = 0x64,
	P1_DOWN = 0x78;
const P1_ATTACK = 0x73,
	P1_JUMP = 0x09;
const P2_UP = 0x69,
	P2_LEFT = 0x6a,
	P2_RIGHT = 0x6c,
	P2_DOWN = 0x2c;
const P2_ATTACK = 0x6b,
	P2_JUMP = 0x20;
const P3_UP = 0x38,
	P3_LEFT = 0x34,
	P3_RIGHT = 0x36,
	P3_DOWN = 0x32;
const P3_ATTACK = 0x35,
	P3_JUMP = 0x30;

export const KEYS = {
	UP: [P1_UP, P2_UP, P3_UP],
	DOWN: [P1_DOWN, P2_DOWN, P3_DOWN],
	LEFT: [P1_LEFT, P2_LEFT, P3_LEFT],
	RIGHT: [P1_RIGHT, P2_RIGHT, P3_RIGHT],
	ATTACK: [P1_ATTACK, P2_ATTACK, P3_ATTACK],
	JUMP: [P1_JUMP, P2_JUMP, P3_JUMP],
	ENTER: 0x0d,
	ESCAPE: 0x1b,
} as const;

export class Input {
	private asciiDown = new Set<number>();
	// Queue of keys pressed since last consumed by a tick
	private pressQueue: number[] = [];
	// The key returned by inkey() this tick (consumed once read)
	private currentInkey = 0;
	private tickConsumed = false;

	constructor() {
		window.addEventListener("keydown", (e) => {
			e.preventDefault();
			const ascii = KEY_TO_ASCII[e.key];
			if (ascii !== undefined) {
				if (!this.asciiDown.has(ascii)) {
					this.pressQueue.push(ascii);
				}
				this.asciiDown.add(ascii);
			}
		});

		window.addEventListener("keyup", (e) => {
			const ascii = KEY_TO_ASCII[e.key];
			if (ascii !== undefined) {
				this.asciiDown.delete(ascii);
			}
		});
	}

	/**
	 * Call at the start of each 18.2Hz tick to prepare input for this tick.
	 * Pops the next key from the queue so inkey() can return it.
	 */
	startTick(): void {
		this.currentInkey =
			this.pressQueue.length > 0 ? this.pressQueue.shift()! : 0;
		this.tickConsumed = false;
	}

	/**
	 * Mimics DOS inkey() (FUN_142d_0ee2): returns the ASCII code of the
	 * key pressed this tick, or 0 if none. Only returns a value once per tick.
	 */
	inkey(): number {
		if (this.tickConsumed) return 0;
		this.tickConsumed = true;
		return this.currentInkey;
	}

	/** Check if a specific ASCII key was pressed this tick */
	isAsciiPressed(ascii: number): boolean {
		return this.currentInkey === ascii;
	}

	/** Check if a specific ASCII key is currently held down */
	isAsciiDown(ascii: number): boolean {
		return this.asciiDown.has(ascii);
	}

	/** Check if any of the given ASCII keys were pressed this tick */
	isAnyPressed(keys: readonly number[]): boolean {
		for (const k of keys) {
			if (this.currentInkey === k) return true;
		}
		return false;
	}

	/** Check if any of the given ASCII keys are held */
	isAnyDown(keys: readonly number[]): boolean {
		for (const k of keys) {
			if (this.asciiDown.has(k)) return true;
		}
		return false;
	}

	/** Any key pressed this tick */
	anyKeyPressed(): boolean {
		return this.currentInkey !== 0;
	}

	/**
	 * Call at the end of each browser frame.
	 * Does NOT clear the press queue — keys persist until consumed by a tick.
	 */
	endFrame(): void {
		// Nothing to clear here — the queue is consumed by startTick()
	}
}
