export const SCREEN_W = 320;
export const SCREEN_H = 200;
const SCALE_FACTOR = 3;

export class Renderer {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
	private offscreen: HTMLCanvasElement;
	private offCtx: CanvasRenderingContext2D;
	private fontReady = false;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		this.canvas.width = SCREEN_W * SCALE_FACTOR;
		this.canvas.height = SCREEN_H * SCALE_FACTOR;
		this.ctx = canvas.getContext("2d")!;
		this.ctx.imageSmoothingEnabled = false;

		this.offscreen = document.createElement("canvas");
		this.offscreen.width = SCREEN_W;
		this.offscreen.height = SCREEN_H;
		this.offCtx = this.offscreen.getContext("2d")!;
		this.offCtx.imageSmoothingEnabled = false;
	}

	async loadFont(): Promise<void> {
		const font = new FontFace("DOS", "url(/Px437_IBM_VGA_8x14.ttf)");
		await font.load();
		document.fonts.add(font);
		this.fontReady = true;
	}

	clear(color = "#000"): void {
		this.offCtx.fillStyle = color;
		this.offCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
	}

	drawImage(
		img: HTMLImageElement,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw?: number,
		dh?: number,
	): void {
		this.offCtx.drawImage(img, sx, sy, sw, sh, dx, dy, dw ?? sw, dh ?? sh);
	}

	drawFullImage(img: HTMLImageElement, x = 0, y = 0): void {
		this.offCtx.drawImage(img, x, y);
	}

	drawSprite(
		img: HTMLImageElement,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		flipped = false,
	): void {
		if (flipped) {
			this.offCtx.save();
			this.offCtx.translate(dx + sw, dy);
			this.offCtx.scale(-1, 1);
			this.offCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
			this.offCtx.restore();
		} else {
			this.offCtx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
		}
	}

	drawRect(x: number, y: number, w: number, h: number, color: string): void {
		this.offCtx.fillStyle = color;
		this.offCtx.fillRect(x, y, w, h);
	}

	drawText(text: string, x: number, y: number, color = "#fff", size = 8): void {
		this.offCtx.fillStyle = color;
		if (this.fontReady) {
			this.offCtx.font = `${size}px DOS`;
		} else {
			this.offCtx.font = `${size}px monospace`;
		}
		this.offCtx.textBaseline = "top";
		this.offCtx.fillText(text, x, y);
	}

	present(): void {
		this.ctx.drawImage(
			this.offscreen,
			0,
			0,
			SCREEN_W,
			SCREEN_H,
			0,
			0,
			SCREEN_W * SCALE_FACTOR,
			SCREEN_H * SCALE_FACTOR,
		);
	}

	resize(): void {
		const windowW = window.innerWidth;
		const windowH = window.innerHeight;
		const aspect = SCREEN_W / SCREEN_H;
		let w: number, h: number;
		if (windowW / windowH > aspect) {
			h = windowH;
			w = h * aspect;
		} else {
			w = windowW;
			h = w / aspect;
		}
		this.canvas.style.width = `${Math.floor(w)}px`;
		this.canvas.style.height = `${Math.floor(h)}px`;
	}

	getOffscreenCtx(): CanvasRenderingContext2D {
		return this.offCtx;
	}
}
