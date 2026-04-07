export class Audio {
	private ctx: AudioContext | null = null;
	private sounds = new Map<string, AudioBuffer>();
	private muted = false;
	private bgmElement: HTMLAudioElement | null = null;

	private getCtx(): AudioContext {
		if (!this.ctx) {
			this.ctx = new AudioContext();
		}
		return this.ctx;
	}

	async loadSound(name: string, url: string): Promise<void> {
		try {
			const response = await fetch(url);
			const data = await response.arrayBuffer();
			const buffer = await this.getCtx().decodeAudioData(data);
			this.sounds.set(name, buffer);
		} catch {
			console.warn(`Failed to load sound: ${name}`);
		}
	}

	play(name: string, volume = 1.0): void {
		if (this.muted) return;
		const buffer = this.sounds.get(name);
		if (!buffer) return;
		const ctx = this.getCtx();
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		if (volume < 1.0) {
			const gain = ctx.createGain();
			gain.gain.value = volume;
			source.connect(gain);
			gain.connect(ctx.destination);
		} else {
			source.connect(ctx.destination);
		}
		source.start();
	}

	async playBGM(url: string): Promise<void> {
		this.stopBGM();
		try {
			this.bgmElement = new HTMLAudioElement();
			this.bgmElement = document.createElement("audio");
			this.bgmElement.src = url;
			this.bgmElement.loop = true;
			this.bgmElement.volume = 0.5;
			if (!this.muted) {
				await this.bgmElement.play().catch(() => {});
			}
		} catch {
			console.warn(`Failed to play BGM: ${url}`);
		}
	}

	stopBGM(): void {
		if (this.bgmElement) {
			this.bgmElement.pause();
			this.bgmElement.src = "";
			this.bgmElement = null;
		}
	}

	toggleMute(): void {
		this.muted = !this.muted;
		if (this.bgmElement) {
			if (this.muted) {
				this.bgmElement.pause();
			} else {
				this.bgmElement.play().catch(() => {});
			}
		}
	}

	isMuted(): boolean {
		return this.muted;
	}

	resume(): void {
		this.ctx?.resume();
	}
}
