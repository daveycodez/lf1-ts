export interface SpecialMove {
	type: string; // A-H letter code
	frames: [number, number, number, number]; // animation frame indices
	projectileType: number;
	mpCost: number;
}

export interface CharacterDef {
	id: number;
	name: string;
	headPic: number;
	faceRow: number;
	faceCol: number;
	skinColors: [number, number];
	shirtColors: [number, number];
	trouserColors: [number, number];
	specials: SpecialMove[];
}

export interface WeaponDef {
	id: number;
	name: string;
	holdType: number;
	throwType: number;
	breakType: number;
	weaponClass: number;
	damage: number;
	pickable: number;
	pics: [number, number, number];
	elasticity: number;
}

export interface SpecialAttackDef {
	id: number;
	name: string;
	damageX: number;
	damageY: number;
	hitboxSize: number;
	mpGain: number;
}

export interface BackgroundDef {
	id: number;
	name: string;
	bgx1: number;
	bgx2: number;
	bgy1: number;
	bgy2: number;
	bgw1: number;
	bgw2: number;
}

export enum FighterState {
	STANDING = 0,
	WALKING = 1,
	RUNNING = 2,
	PUNCHING = 3,
	JUMPING = 4,
	DEFENDING = 5,
	FALLING = 6,
	LYING = 7,
	GETTING_UP = 8,
	PICKING = 9,
	THROWING = 10,
	SPECIAL_A = 11,
	SPECIAL_B = 12,
	SPECIAL_C = 13,
	CAUGHT = 14,
	CATCHING = 15,
	ANGEL = 16,
	WOUNDED = 17,
}

export enum Direction {
	RIGHT = 0,
	LEFT = 1,
}

export interface Fighter {
	id: number;
	charId: number;
	team: number;
	x: number;
	y: number;
	z: number; // vertical (jump height)
	vx: number;
	vy: number;
	vz: number;
	hp: number;
	maxHp: number;
	mp: number;
	maxMp: number;
	state: FighterState;
	frame: number;
	frameTimer: number;
	direction: Direction;
	isAI: boolean;
	weapon: number; // -1 = no weapon
	combo: number;
	hitStun: number;
	invincible: number;
	score: number;
}

export interface Weapon {
	id: number;
	type: number;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	vz: number;
	owner: number; // fighter id, -1 = none
	state: number; // 0=ground, 1=held, 2=thrown, 3=flying
	frame: number;
	hp: number;
	active: boolean;
}

export interface Projectile {
	type: number;
	x: number;
	y: number;
	z: number;
	vx: number;
	vy: number;
	owner: number;
	frame: number;
	frameTimer: number;
	damage: number;
	active: boolean;
}

export interface Explosion {
	x: number;
	y: number;
	frame: number;
	frameTimer: number;
	type: number;
	active: boolean;
}

export type GameScreen =
	| "intro"
	| "title"
	| "select"
	| "fight"
	| "contest"
	| "mods";

export interface GameState {
	screen: GameScreen;
	players: number; // 1-3
	fighters: Fighter[];
	weapons: Weapon[];
	projectiles: Projectile[];
	explosions: Explosion[];
	bgIndex: number;
	bgScrollX: number;
	timer: number;
	paused: boolean;
}
