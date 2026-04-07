// Sprite sheet layout constants derived from GRH file dimensions

// ACT1.GRH / ACT2.GRH: Character animation sprites
// 312x130 pixels, 13 columns x 5 rows = 65 frames per sheet
export const ACT_COLS = 13;
export const ACT_ROWS = 5;
export const ACT_FRAME_W = 24; // 312 / 13
export const ACT_FRAME_H = 26; // 130 / 5
export const ACT1_FRAMES = 65; // frames 0-64
// ACT2 frames start at index 65

export function getActFrame(index: number): {
	sheet: "ACT1" | "ACT2";
	sx: number;
	sy: number;
} {
	const sheet = index < ACT1_FRAMES ? "ACT1" : "ACT2";
	const localIdx = index < ACT1_FRAMES ? index : index - ACT1_FRAMES;
	const col = localIdx % ACT_COLS;
	const row = Math.floor(localIdx / ACT_COLS);
	return { sheet, sx: col * ACT_FRAME_W, sy: row * ACT_FRAME_H };
}

// FACE.GRH: Character face portraits
// 300x100 pixels, 6 columns x 2 rows
export const FACE_W = 50;
export const FACE_H = 50;
export const FACE_COLS = 6;

export function getFacePos(
	row: number,
	col: number,
): { sx: number; sy: number } {
	return { sx: (row - 1) * FACE_W, sy: (col - 1) * FACE_H };
}

// HEAD.GRH: In-game head sprites
// 198x65 pixels, 11 columns
export const HEAD_COLS = 11;
export const HEAD_W = 18; // 198 / 11
export const HEAD_H = 13; // 65 / 5
export const HEAD_ROWS = 5;

export function getHeadPos(
	headId: number,
	row = 0,
): { sx: number; sy: number } {
	return { sx: (headId - 1) * HEAD_W, sy: row * HEAD_H };
}

// HEAD2.GRH: Small head icons (single row)
// 198x16
export const HEAD2_W = 18;
export const HEAD2_H = 16;

export function getHead2Pos(headId: number): { sx: number; sy: number } {
	return { sx: (headId - 1) * HEAD2_W, sy: 0 };
}

// WEAPON.GRH: Weapon sprites
// 270x112, approximately 15 columns x 7 rows of 18x16 cells
export const WEAPON_FRAME_W = 18;
export const WEAPON_FRAME_H = 16;
export const WEAPON_COLS = 15; // 270 / 18

export function getWeaponFrame(index: number): { sx: number; sy: number } {
	const col = index % WEAPON_COLS;
	const row = Math.floor(index / WEAPON_COLS);
	return { sx: col * WEAPON_FRAME_W, sy: row * WEAPON_FRAME_H };
}

// MENU.GRH: Fight HUD (320x56)
// Two rows of HP/MP bars
export const MENU_W = 320;
export const MENU_H = 56;
export const MENU_BAR_H = 28; // each team's section

// BACK*.GRH: Backgrounds (320x144)
export const BG_W = 320;
export const BG_H = 144;

// NEWFONTS: Bitmap font (96x128)
// 16 columns x 16 rows of 6x8 character cells
export const FONT_CELL_W = 6;
export const FONT_CELL_H = 8;
export const FONT_COLS = 16;

export function getFontCharPos(charCode: number): { sx: number; sy: number } {
	const col = charCode % FONT_COLS;
	const row = Math.floor(charCode / FONT_COLS);
	return { sx: col * FONT_CELL_W, sy: row * FONT_CELL_H };
}

// Animation frame sequences for common states
// These define which ACT sprite indices correspond to which animation states
// Standing: frames that cycle for idle
// Walking: movement frames
// These are approximate based on typical LF1 sprite layout

export const ANIM = {
	STAND: [0, 1],
	WALK: [2, 3, 4, 5],
	RUN: [6, 7, 8, 9],
	PUNCH1: [10, 11, 12],
	PUNCH2: [13, 14, 15],
	PUNCH3: [16, 17, 18],
	JUMP: [19, 20],
	JUMP_ATTACK: [21, 22],
	DEFEND: [23],
	FALL: [24, 25],
	LIE: [26],
	GET_UP: [27, 28],
	PICK: [29],
	THROW: [30, 31],
	CAUGHT: [32, 33],
	ANGEL: [34, 35, 36, 37],
	DASH_ATTACK: [38, 39, 40],
};

// Background file mappings (index -> filenames)
export const BG_FILES: [string, string][] = [
	["BACK21", "BACK22"], // Plateau
	["BACK31", "BACK32"], // Grassland
	["BACK41", "BACK42"], // Road
	["BACK51", "BACK52"], // Tower
	["BACK61", "BACK62"], // Kung Fu / Bridge
];

// Super info screens per character
export const SUPER_FILES = [
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
