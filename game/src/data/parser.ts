import type {
	BackgroundDef,
	CharacterDef,
	SpecialAttackDef,
	SpecialMove,
	WeaponDef,
} from "./types";

export function parseDataDat(text: string): {
	characters: CharacterDef[];
	weapons: WeaponDef[];
	specials: SpecialAttackDef[];
	backgrounds: BackgroundDef[];
	aiTable: number[][];
} {
	const characters: CharacterDef[] = [];
	const weapons: WeaponDef[] = [];
	const specials: SpecialAttackDef[] = [];
	const backgrounds: BackgroundDef[] = [];
	const aiTable: number[][] = [];

	const lines = text.split("\n");
	let i = 0;

	while (i < lines.length) {
		const line = lines[i].trim();

		// Character definition: starts with "N. Name"
		const charMatch = line.match(/^(\d+)\.\s+(\w+)/);
		if (charMatch) {
			const char = parseCharacter(
				lines,
				i,
				parseInt(charMatch[1]),
				charMatch[2],
			);
			characters.push(char.def);
			i = char.nextLine;
			continue;
		}

		// AI table rows (lines of space-separated numbers after characters)
		if (
			line.match(/^\d+\s+\d+\s+\d+\s+\d+\s+\d+/) &&
			characters.length === 11
		) {
			const nums = line.split(/\s+/).map(Number);
			aiTable.push(nums);
			i++;
			continue;
		}

		if (line.startsWith("Background:")) {
			i += 2; // skip header lines
			while (i < lines.length && lines[i].trim().match(/^[a-z]\./i)) {
				const bg = parseBackground(lines[i].trim(), backgrounds.length);
				if (bg) backgrounds.push(bg);
				i++;
			}
			continue;
		}

		// Special attacks: lines like "  1.BallKat   110  95  08 0"
		const spMatch = line.match(
			/^\s*(\d+)\.(\w+)\s+([-\d]+)\s+(\d+)\s+(\d+)\s+(\d+)/,
		);
		if (
			spMatch &&
			!line.includes("Sword") &&
			!line.includes("Stick") &&
			backgrounds.length > 0 &&
			weapons.length === 0
		) {
			specials.push({
				id: parseInt(spMatch[1]),
				name: spMatch[2],
				damageX: parseInt(spMatch[3]),
				damageY: parseInt(spMatch[4]),
				hitboxSize: parseInt(spMatch[5]),
				mpGain: parseInt(spMatch[6]),
			});
			i++;
			continue;
		}

		// Weapon definitions
		const weapMatch = line.match(
			/^\s*(\w[\w\-+]*)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/,
		);
		if (weapMatch && line.includes("  ") && specials.length > 0) {
			weapons.push({
				id: weapons.length,
				name: weapMatch[1],
				holdType: parseInt(weapMatch[2]),
				throwType: parseInt(weapMatch[3]),
				breakType: parseInt(weapMatch[4]),
				weaponClass: parseInt(weapMatch[5]),
				damage: parseInt(weapMatch[6]),
				pickable: parseInt(weapMatch[7]),
				pics: [
					parseInt(weapMatch[8]),
					parseInt(weapMatch[9]),
					parseInt(weapMatch[10]),
				],
				elasticity: parseInt(weapMatch[11]),
			});
			i++;
			continue;
		}

		i++;
	}

	return { characters, weapons, specials, backgrounds, aiTable };
}

function parseCharacter(
	lines: string[],
	startLine: number,
	id: number,
	name: string,
): { def: CharacterDef; nextLine: number } {
	let i = startLine + 1;
	let headPic = 0,
		faceRow = 0,
		faceCol = 0;
	let skinColors: [number, number] = [0, 0];
	let shirtColors: [number, number] = [0, 0];
	let trouserColors: [number, number] = [0, 0];
	const specials: SpecialMove[] = [];

	while (i < lines.length) {
		const line = lines[i].trim();

		if (line.match(/^\d+\.\s/)) break; // next character
		if (line.startsWith("Background:")) break;
		if (
			line.match(/^\d+\s+\d+\s+\d+\s+\d+\s+\d+/) &&
			!line.includes("Sp:") &&
			!line.includes(":")
		)
			break;

		const headMatch = line.match(/Head:\s*(\d+)/);
		if (headMatch) headPic = parseInt(headMatch[1]);

		const faceMatch = line.match(/Face:\s*(\d+)\s+(\d+)/);
		if (faceMatch) {
			faceRow = parseInt(faceMatch[1]);
			faceCol = parseInt(faceMatch[2]);
		}

		const skinMatch = line.match(/Skn:\s*(\d+)\s+(\d+)/);
		if (skinMatch)
			skinColors = [parseInt(skinMatch[1]), parseInt(skinMatch[2])];

		const shirtMatch = line.match(/Sht:\s*(\d+)\s+(\d+)/);
		if (shirtMatch)
			shirtColors = [parseInt(shirtMatch[1]), parseInt(shirtMatch[2])];

		const trouserMatch = line.match(/Trs:\s*(\d+)\s+(\d+)/);
		if (trouserMatch)
			trouserColors = [parseInt(trouserMatch[1]), parseInt(trouserMatch[2])];

		// Special moves: "Sp: A  61  43  12   0   1   25" or "  B  63  64  65  66   2  175"
		const spMatch = line.match(
			/(?:Sp:\s*)?([A-H])\s+([-\d]+)\s+([-\d]+)\s+([-\d]+)\s+([-\d]+)\s+([-\d]+)\s+([-\d]+)/,
		);
		if (spMatch) {
			specials.push({
				type: spMatch[1],
				frames: [
					parseInt(spMatch[2]),
					parseInt(spMatch[3]),
					parseInt(spMatch[4]),
					parseInt(spMatch[5]),
				],
				projectileType: parseInt(spMatch[6]),
				mpCost: parseInt(spMatch[7]),
			});
		}

		i++;
	}

	return {
		def: {
			id,
			name,
			headPic,
			faceRow,
			faceCol,
			skinColors,
			shirtColors,
			trouserColors,
			specials,
		},
		nextLine: i,
	};
}

function parseBackground(line: string, index: number): BackgroundDef | null {
	// "a.Plateau       27 293    123 185    -07 327"
	const match = line.match(
		/[a-z]\.(\w+)\s+([-\d]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([-\d]+)\s+(\d+)/i,
	);
	if (!match) return null;
	return {
		id: index,
		name: match[1],
		bgx1: parseInt(match[2]),
		bgx2: parseInt(match[3]),
		bgy1: parseInt(match[4]),
		bgy2: parseInt(match[5]),
		bgw1: parseInt(match[6]),
		bgw2: parseInt(match[7]),
	};
}
