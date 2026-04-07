// DOS PIT timer runs at 18.2 Hz by default (1193182 / 65536)
const DEFAULT_TICK_RATE = 18.2;

export class GameTimer {
	private tickRate: number;
	private msPerTick: number;
	private accumulator = 0;
	private lastTime = 0;
	private ticks = 0;
	private started = false;

	constructor(tickRate = DEFAULT_TICK_RATE) {
		this.tickRate = tickRate;
		this.msPerTick = 1000 / tickRate;
	}

	setTickRate(rate: number): void {
		this.tickRate = rate;
		this.msPerTick = 1000 / rate;
	}

	start(): void {
		this.lastTime = performance.now();
		this.accumulator = 0;
		this.started = true;
	}

	update(): number {
		if (!this.started) {
			this.start();
			return 0;
		}
		const now = performance.now();
		const dt = now - this.lastTime;
		this.lastTime = now;
		this.accumulator += dt;

		let ticksThisFrame = 0;
		while (this.accumulator >= this.msPerTick) {
			this.accumulator -= this.msPerTick;
			ticksThisFrame++;
			this.ticks++;
		}

		// Cap at 4 ticks per frame to prevent spiral of death
		return Math.min(ticksThisFrame, 4);
	}

	getTotalTicks(): number {
		return this.ticks;
	}

	getTickRate(): number {
		return this.tickRate;
	}
}
