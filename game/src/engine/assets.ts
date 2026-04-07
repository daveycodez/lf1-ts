export class Assets {
	private images = new Map<string, HTMLImageElement>();
	private loading = 0;
	private loaded = 0;

	async loadImage(name: string, url: string): Promise<HTMLImageElement> {
		if (this.images.has(name)) return this.images.get(name)!;
		this.loading++;
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				this.images.set(name, img);
				this.loaded++;
				resolve(img);
			};
			img.onerror = () => {
				console.warn(`Failed to load image: ${name} from ${url}`);
				this.loaded++;
				reject(new Error(`Failed to load ${url}`));
			};
			img.src = url;
		});
	}

	getImage(name: string): HTMLImageElement | undefined {
		return this.images.get(name);
	}

	get progress(): number {
		return this.loading === 0 ? 1 : this.loaded / this.loading;
	}

	async loadAll(manifest: Record<string, string>): Promise<void> {
		const promises = Object.entries(manifest).map(([name, url]) =>
			this.loadImage(name, url).catch(() => null),
		);
		await Promise.all(promises);
	}
}

export const ASSET_MANIFEST: Record<string, string> = {
	// Backgrounds
	BACK21: "/assets/BACK21.png",
	BACK22: "/assets/BACK22.png",
	BACK31: "/assets/BACK31.png",
	BACK32: "/assets/BACK32.png",
	BACK41: "/assets/BACK41.png",
	BACK42: "/assets/BACK42.png",
	BACK51: "/assets/BACK51.png",
	BACK52: "/assets/BACK52.png",
	BACK61: "/assets/BACK61.png",
	BACK62: "/assets/BACK62.png",

	// Sprite sheets
	ACT1: "/assets/ACT1.png",
	ACT2: "/assets/ACT2.png",
	WEAPON: "/assets/WEAPON.png",
	HEAD: "/assets/HEAD.png",
	HEAD2: "/assets/HEAD2.png",
	FACE: "/assets/FACE.png",
	MENU: "/assets/MENU.png",

	// Full screens
	MAIN: "/assets/MAIN.png",
	MODE: "/assets/MODE.png",
	RIGHT: "/assets/RIGHT.png",
	CONDATA: "/assets/CONDATA.png",
	CWORD: "/assets/CWORD.png",
	CWORD_DIM: "/assets/CWORD_DIM.png",
	CCON: "/assets/CCON.png",

	// Character select / contest
	CGROUP: "/assets/CGROUP.png",
	EBOARD: "/assets/EBOARD.png",
	ENDC: "/assets/ENDC.png",
	C1BOARD: "/assets/C1BOARD.png",
	C1HM: "/assets/C1HM.png",
	C2BOARD: "/assets/C2BOARD.png",
	C2HM: "/assets/C2HM.png",
	WINNER: "/assets/WINNER.png",

	// Key config screens
	KEY1: "/assets/KEY1.png",
	KEY2: "/assets/KEY2.png",
	KEY3: "/assets/KEY3.png",

	// Super move display
	SUPERA: "/assets/SUPERA.png",
	SUPERB: "/assets/SUPERB.png",
	SUPERC: "/assets/SUPERC.png",
	SUPERD: "/assets/SUPERD.png",
	SUPERE: "/assets/SUPERE.png",
	SUPERF: "/assets/SUPERF.png",
	SUPERG: "/assets/SUPERG.png",
	SUPERH: "/assets/SUPERH.png",
	SUPERI: "/assets/SUPERI.png",
	SUPERJ: "/assets/SUPERJ.png",
	SUPERK: "/assets/SUPERK.png",

	// Font
	NEWFONTS: "/assets/NEWFONTS.png",
	WORDS: "/assets/WORDS.png",
};

// Symlink assets so Vite serves them from /assets/
// The converted PNGs are already in game/assets/
// We need to copy them to public/assets or configure Vite
