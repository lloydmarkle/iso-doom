import { writable, get } from "svelte/store";
import { type DoomMap, type Sector } from "./Map";
import { Euler, Object3D, Vector3 } from "three";
import { HALF_PI, lineLineIntersect, randInt, signedLineDistance } from "./Math";
import type { MapObject, PlayerMapObject } from "./MapObject";
import { createDoorAction } from "./Specials";

export type Action = () => void;

const lowestLight = (sectors: Sector[], min: number) =>
    sectors.length === 0 ? 0 :
    sectors.map(s => s.source.light).reduce((last, val) => Math.min(last, val), min);

const randomFlicker = (map: DoomMap, sector: Sector) => {
    const max = sector.source.light;
    const min = lowestLight(map.sectorNeighbours(sector), max);
    let val = max;
    let ticks = 1;
    return () => {
        if (--ticks) {
            return;
        }
        if (val === max) {
            ticks = randInt(1, 7);
            val = min;
        } else {
            ticks = randInt(1, 64);
            val = max;
        }
        sector.light.set(val);
    };
};

const strobeFlash =
    (lightTicks: number, darkTicks: number, synchronized = false) =>
    (map: DoomMap, sector: Sector) => {
        const max = sector.source.light;
        const min = lowestLight(map.sectorNeighbours(sector), max);
        let ticks = synchronized ? 1 : randInt(1, 7);
        let val = max;
        return () => {
            if (--ticks) {
                return;
            }
            if (val === max) {
                ticks = darkTicks;
                val = min;
            } else {
                ticks = lightTicks;
                val = max;
            }
            sector.light.set(val);
        };
    };

const glowLight = (map: DoomMap, sector: Sector) => {
    const max = sector.source.light;
    const min = lowestLight(map.sectorNeighbours(sector), max);
    let val = max;
    let step = -8;
    return () => {
        val += step;
        if (val <= min || val >= max) {
            step = -step;
            val += step;
        }
        sector.light.set(val);
    };
};

const fireFlicker = (map: DoomMap, sector: Sector) => {
    const max = sector.source.light;
    const min = lowestLight(map.sectorNeighbours(sector), max) + 16;
    let ticks = 4;
    return () => {
        if (--ticks) {
            return;
        }
        ticks = 4;
        const amount = randInt(0, 2) * 16;
        sector.light.set(Math.max(max - amount, min));
    }
};

const sectorAnimations = {
    1: randomFlicker,
    2: strobeFlash(5, 15),
    3: strobeFlash(5, 35),
    4: strobeFlash(5, 35),
    8: glowLight,
    12: strobeFlash(5, 35, true),
    13: strobeFlash(5, 15, true),
    17: fireFlicker,
};

class Camera {
    private pos = new Vector3();
    private updatePosition: (pos: Vector3, angle: Euler) => void;

    public playerViewHeight = 0; // only applies for mode=='1p'
    readonly rotation = writable(new Euler(0, 0, 0, 'ZXY'));
    readonly position = writable(this.pos);
    mode = writable<'1p' | '3p' | 'bird'>('1p');

    constructor() {
        this.mode.subscribe(mode => {
            if (mode === '3p') {
                const followDist = 200;
                this.updatePosition = (position, angle) => {
                    this.pos.x = -Math.sin(-euler.z) * followDist + position.x;
                    this.pos.y = -Math.cos(-euler.z) * followDist + position.y;
                    this.pos.z = Math.cos(-euler.x) * followDist + position.z;
                    this.position.set(this.pos);
                    this.rotation.set(angle)
                };
            } else if (mode === 'bird') {
                const followDist = 250;
                this.updatePosition = (position, angle) => {
                    this.pos.copy(position);
                    this.pos.z = position.z + followDist;
                    this.position.set(this.pos);
                    angle.x = 0;
                    this.rotation.set(angle);
                }
            } else {
                this.updatePosition = (position, angle) => {
                    this.pos.copy(position);
                    this.pos.z = position.z + this.playerViewHeight;
                    this.position.set(this.pos);
                    this.rotation.set(angle);
                };
            }
        });
    }

    update(position: Vector3, angle: Euler) {
        this.updatePosition(position, angle);
    }
}

export const ticksPerSecond = 35;
const frameTickTime = 1 / ticksPerSecond;
export class DoomGame {
    private nextTickTime = 0; // seconds
    elapsedTime = 0; // seconds
    currentTick = 0;

    readonly player: MapObject;
    readonly camera = new Camera();
    readonly input: GameInput;

    private actions: Action[];

    constructor(private map: DoomMap) {
        this.synchronizeActions();
        this.player = map.objs.find(e => e.source.type === 1);
        this.input = new GameInput(map, this);
    }

    tick(delta: number) {
        // handle input as fast as possible
        this.input.evaluate(delta);
        this.elapsedTime += delta;

        while (this.elapsedTime > this.nextTickTime) {
            this.frameTick();
        }
    }

    frameTick() {
        this.nextTickTime = this.nextTickTime + frameTickTime;
        this.currentTick += 1;

        this.actions.forEach(action => action());

        // update wall/flat animations
        this.map.animatedTextures.forEach(anim => {
            if (this.currentTick % anim.speed === 0) {
                anim.current = (anim.current + 1) % anim.frames.length;
                anim.target.set(anim.frames[anim.current]);
            }
        });

        this.map.objs.forEach(thing => thing.tick());
    }

    addAction(action: Action) {
        if (action) {
            this.actions.push(action);
        }
    }

    removeAction(action: Action) {
        // TODO: perf: recreating an array?
        this.actions = this.actions.filter(e => e !== action);
    }

    // Why a public function? Because "edit" mode can change these while
    // rendering the map and we want them to update
    synchronizeActions() {
        this.actions = [];
        for (const wall of this.map.linedefs) {
            if (wall.special === 48) {
                wall.xOffset = writable(0);
                this.actions.push(() => wall.xOffset.update(n => n += 1));
            } else if (wall.special === 85) {
                wall.xOffset = writable(0);
                this.actions.push(() => wall.xOffset.update(n => n -= 1));
            }
        }

        for (const sector of this.map.sectors) {
            const type = sector.type;
            const action = sectorAnimations[type]?.(this.map, sector);
            if (action) {
                this.actions.push(action);
            }
        }
    }
}

const slideMove = (player: MapObject, x: number, y: number) => {
    // slide along wall instead of moving through it
    vec.set(x, y, 0);
    // we are only interested in cancelling xy movement so preserve z
    const z = player.velocity.z;
    player.velocity.projectOnVector(vec);
    player.velocity.z = z;
};

const playerSpeeds = { // per-tick
    'run': 50,
    'walk': 25,
    'crawl?': 5,
    'gravity': 35,
}

const euler = new Euler(0, 0, 0, 'ZYX');
const vec = new Vector3();
class GameInput {
    public moveForward = false;
    public moveBackward = false;
    public moveLeft = false;
    public moveRight = false;
    public run = false;
    public slow = false;
    public use = false;
    public mouse = { x: 0, y: 0 };

    public freelook = writable(true);
    public noclip = false;
    public freeFly = false;
    public pointerSpeed = 1.0;
    // Set to constrain the pitch of the camera
    // Range is 0 to Math.PI radians
    public minPolarAngle = -HALF_PI;
    public maxPolarAngle = HALF_PI;

    private handledUsePress = false; // only one use per button press
    private get enablePlayerCollisions() { return !this.noclip; }
    private get player() { return this.game.player as PlayerMapObject };
    private obj = new Object3D();
    private direction = new Vector3();

    constructor(private map: DoomMap, private game: DoomGame) {
        const position = get(this.player.position);
        this.obj.position.set(position.x, position.y, position.z);
        this.game.player.position.set(this.obj.position);

        euler.x = HALF_PI;
        euler.z = get(this.player.direction) + HALF_PI;
        this.obj.quaternion.setFromEuler(euler);

        this.freelook.subscribe(val => {
            if (val) {
                this.minPolarAngle = -HALF_PI;
                this.maxPolarAngle = HALF_PI;
            } else {
                this.minPolarAngle = this.maxPolarAngle = 0;
            }
        });
    }

    evaluate(delta: number) {
        // handle rotation movements
        euler.setFromQuaternion(this.obj.quaternion);
        euler.z -= this.mouse.x * 0.002 * this.pointerSpeed;
        euler.x -= this.mouse.y * 0.002 * this.pointerSpeed;
        euler.x = Math.max(HALF_PI - this.maxPolarAngle, Math.min(HALF_PI - this.minPolarAngle, euler.x));
        this.obj.quaternion.setFromEuler(euler);
        this.obj.updateMatrix();
        this.game.player.direction.set(euler.z);

        // clear for next eval
        this.mouse.x = 0;
        this.mouse.y = 0;

        // handle direction movements
        this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
        this.direction.y =  Number(this.moveForward) - Number(this.moveBackward);
        this.direction.normalize(); // ensure consistent movements in all directions
        // ^^^ this isn't very doom like but I don't want to change it

        const dt = delta * delta / frameTickTime;
        const speed = this.slow ? playerSpeeds['crawl?'] : this.run ? playerSpeeds['run'] : playerSpeeds['walk'];
        if (this.player.onGround || this.freeFly) {
            if (this.moveForward || this.moveBackward) {
                this.player.velocity.addScaledVector(this.forwardVec(), this.direction.y * speed * dt);
            }
            if (this.moveLeft || this.moveRight) {
                this.player.velocity.addScaledVector(this.rightVec(), this.direction.x * speed * dt);
            }
            if (this.freeFly) {
                // apply z-friction during freefly
                this.player.velocity.z *= 0.96;
            }
        } else {
            this.player.velocity.z -= playerSpeeds['gravity'] * dt;
        }

        if (this.enablePlayerCollisions) {
            this.map.xyCollisions(this.player, this.player.velocity,
                mobj => {
                    const pos = get(mobj.position);
                    const dx = this.obj.position.x - pos.x;
                    const dy = this.obj.position.y - pos.y;
                    slideMove(this.player, -dy, dx);
                    return true;
                },
                linedef => {
                    slideMove(this.player, linedef.v[1].x - linedef.v[0].x, linedef.v[1].y - linedef.v[0].y);
                    return true;
                });
        }

        if (this.use && !this.handledUsePress) {
            this.handledUsePress = false;

            const ang = euler.z + HALF_PI;
            vec.set(Math.cos(ang) * 64, Math.sin(ang) * 64, 0);
            const collisions = this.map.blockmap.trace(this.obj.position, 0, vec);
            vec.add(this.obj.position);
            const useLine = [this.obj.position, vec];
            for (const linedef of collisions.linedefs) {
                if (signedLineDistance(linedef.v, this.obj.position) < 0) {
                    // don't hit walls from behind
                    continue;
                }

                const hit = lineLineIntersect(linedef.v, useLine, true);
                if (!hit) {
                    continue;
                }

                if (linedef.special) {
                    createDoorAction(this.game, this.map, linedef);
                    break;
                }
            }
        }
        this.handledUsePress = this.use;

        this.obj.position.add(this.player.velocity);
        this.game.player.position.set(this.obj.position);

        this.game.camera.playerViewHeight = this.player.computeViewHeight(this.game, delta);
        this.game.camera.update(this.obj.position, euler);
    }

    private rightVec() {
        return vec.setFromMatrixColumn(this.obj.matrix, 0);
    }

    private forwardVec() {
        if (this.freeFly) {
            // freelook https://stackoverflow.com/questions/63405094
            vec.set(0, 0, -1).applyQuaternion(this.obj.quaternion);
        } else {
            // move forward parallel to the xy-plane (camera.up is z-up)
            vec.setFromMatrixColumn(this.obj.matrix, 0);
            vec.crossVectors(this.obj.up, vec);
        }
        return vec;
    }
}