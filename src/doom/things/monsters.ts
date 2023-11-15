import { randInt } from 'three/src/math/MathUtils';
import type { ThingType } from '.';
import { ActionIndex, MFFlags, MapObjectIndex } from '../doom-things-info';
import type { GameTime } from '../game';
import type { MapObject } from '../map-object';
import { EIGHTH_PI, HALF_PI, QUARTER_PI, angleNoise, normalizeAngle } from '../math';
import { hasLineOfSight } from './obstacles';
import { Vector3 } from 'three';
import { hittableThing } from '../map-data';

export const monsters: ThingType[] = [
    { type: 7, class: 'M', description: 'Spiderdemon' },
    { type: 9, class: 'M', description: 'Shotgun guy' },
    { type: 16, class: 'M', description: 'Cyberdemon' },
    { type: 58, class: 'M', description: 'Spectre' },
    { type: 64, class: 'M', description: 'Arch-vile' },
    { type: 65, class: 'M', description: 'Heavy weapon dude' },
    { type: 66, class: 'M', description: 'Revenant' },
    { type: 67, class: 'M', description: 'Mancubus' },
    { type: 68, class: 'M', description: 'Arachnotron' },
    { type: 69, class: 'M', description: 'Hell knight' },
    { type: 71, class: 'M', description: 'Pain elemental' },
    { type: 72, class: 'M', description: 'Commander Keen' },
    { type: 84, class: 'M', description: 'Wolfenstein SS' },
    { type: 3001, class: 'M', description: 'Imp' },
    { type: 3002, class: 'M', description: 'Demon' },
    { type: 3003, class: 'M', description: 'Baron of Hell' },
    { type: 3004, class: 'M', description: 'Zombieman' },
    { type: 3005, class: 'M', description: 'Cacodemon' },
    { type: 3006, class: 'M', description: 'Lost soul' },
];

type MonsterAction = (time: GameTime, mobj: MapObject) => void
export const monsterActions: { [key: number]: MonsterAction } = {
    [ActionIndex.A_Look]: (time, mobj) => {
        if (!mobj.position) {
            // TODO: this only happens during MapObject constructor because we call A_Look before we set position. Can we avoid this check?
            return;
        }
        mobj.chaseThreshold = 0;

        // TODO: check for sound targets?
        // TODO: also MF_AMBUSH flag (related to sound)
        mobj.chaseTarget = findPlayerTarget(mobj);
        if (!mobj.chaseTarget) {
            return;
        }

        // SND: seesound ?
        mobj.setState(mobj.info.seestate);
    },

    [ActionIndex.A_Chase]: (time, mobj) => {
        const game = mobj.map.game;
        const fastMonsters = game.skill === 5 || game.settings.monsterAI.val === 'fast';

        mobj.reactiontime = mobj.reactiontime > 0 ? mobj.reactiontime - 1 : 0;

        if (mobj.chaseThreshold) {
            if (!mobj.chaseTarget || mobj.chaseTarget.isDead) {
                mobj.chaseThreshold = 0;
            } else {
                mobj.chaseThreshold -= 1;
            }
        }

        // make a quarter turn if mobj.direction !== mobj.movedir
        if (mobj.movedir !== CompassDirection.None) {
            const diff = normalizeAngle((mobj.direction.val + Math.PI) - mobj.movedir) - Math.PI;
            if (Math.abs(diff) > EIGHTH_PI) { // only update if we're off by 1/8 of a turn
                mobj.direction.update(val => val + ((diff < 0) ? QUARTER_PI : -QUARTER_PI));
            }
        }

        if (!mobj.chaseTarget || !(mobj.chaseTarget.info.flags & MFFlags.MF_SHOOTABLE)) {
            // no target or target is no longer shootable (dead?) so find a new target
            mobj.chaseTarget = findPlayerTarget(mobj, true);
            if (!mobj.chaseTarget) {
                // no target? go back to default state
                mobj.setState(mobj.info.spawnstate);
            }
            return;
        }

        // do not attack twice in a row
        if (mobj.info.flags & MFFlags.MF_JUSTATTACKED) {
            mobj.info.flags &= ~MFFlags.MF_JUSTATTACKED;
            if (!fastMonsters) {
                newChaseDir(mobj, mobj.chaseTarget);
            }
            return;
        }

        // melee attack
        if (mobj.info.meleestate && canMeleeAttack(mobj, mobj.chaseTarget)) {
            // SND: attacksound
            mobj.setState(mobj.info.meleestate);
            return;
        }

        // missile attack
        const canShoot = mobj.info.missilestate && (fastMonsters || !mobj.movecount) && canShootAttack(mobj, mobj.chaseTarget);
        if (canShoot) {
            mobj.setState(mobj.info.missilestate);
            mobj.info.flags |= MFFlags.MF_JUSTATTACKED;
            return;
        }

        // possibly choose another target
        if (game.mode !== 'solo' && !mobj.chaseThreshold && !hasLineOfSight(mobj, mobj.chaseTarget)) {
            const newTarget = findPlayerTarget(mobj, true);
            if (newTarget) {
                mobj.chaseTarget = newTarget;
                return;	// got a new target
            }
        }

        // continue chase
        mobj.movecount -= 1;
        if (mobj.movecount < 0 || moveBlocked(mobj, mobj.position.val, _moveVec)) {
            newChaseDir(mobj, mobj.chaseTarget);
        }

        // move
        if (canMove(mobj, mobj.movedir)) {
            // TODO: trigger doors
            _moveVec.set(
                Math.cos(mobj.movedir + Math.PI) * mobj.info.speed,
                Math.sin(mobj.movedir + Math.PI) * mobj.info.speed,
                0);
            mobj.position.update(pos => pos.add(_moveVec));
        }

        // SND: activesound on random() < 3/255
    },

    [ActionIndex.A_FaceTarget]: (time, mobj) => {
        if (!mobj.chaseTarget) {
            return;
        }

        mobj.info.flags &= ~MFFlags.MF_AMBUSH;
        let angle = Math.atan2(mobj.chaseTarget.position.val.y - mobj.position.val.y, mobj.chaseTarget.position.val.x - mobj.position.val.x);
        if (mobj.chaseTarget.info.flags & MFFlags.MF_SHADOW) {
            angle += angleNoise(5);
        }
        mobj.direction.set(angle);
    },
};

const meleeRange = 1 * 64;
function findPlayerTarget(mobj: MapObject, allAround = false) {
    // TODO: in multiplayer, there are multiple players to look for
    const dist = mobj.position.val.distanceTo(mobj.map.player.position.val);
    if (dist < meleeRange) {
        return mobj.map.player;
    }

    const lineOfSight = hasLineOfSight(mobj, mobj.map.player);
    if (lineOfSight) {
        const delta = Math.atan2(mobj.map.player.position.val.y - mobj.position.val.y, mobj.map.player.position.val.x - mobj.position.val.x);
        const angle = normalizeAngle(delta - mobj.direction.val) - Math.PI;
        if (allAround || (angle > -HALF_PI && angle < HALF_PI)) {
            return mobj.map.player;
        }
    }
    return null;
}

enum CompassDirection {
    West = 0,
    SouthWest = QUARTER_PI,
    South = HALF_PI,
    SouthEast = HALF_PI + QUARTER_PI,
    East = Math.PI,
    NorthEast = Math.PI + QUARTER_PI,
    North = Math.PI + HALF_PI,
    NorthWest = Math.PI + HALF_PI + QUARTER_PI,
    None = -1,
}
const compassOpposite = {
    [CompassDirection.West]: CompassDirection.East,
    [CompassDirection.SouthWest]: CompassDirection.NorthEast,
    [CompassDirection.South]: CompassDirection.North,
    [CompassDirection.SouthEast]: CompassDirection.NorthWest,
    [CompassDirection.East]: CompassDirection.West,
    [CompassDirection.NorthEast]: CompassDirection.SouthWest,
    [CompassDirection.North]: CompassDirection.South,
    [CompassDirection.NorthWest]: CompassDirection.SouthEast,
    [CompassDirection.None]: CompassDirection.None
}
const searchDirections = [
    CompassDirection.East, CompassDirection.NorthEast, CompassDirection.North, CompassDirection.NorthWest,
    CompassDirection.West, CompassDirection.SouthWest, CompassDirection.South, CompassDirection.SouthEast,
];
const reverseSearchDirections = searchDirections.toReversed();
const swapDirectionChance = 200 / 255;
let _moveDir = [0, 0];
function newChaseDir(mobj: MapObject, target: MapObject) {
    // Kind of P_NewChaseDir but also helped along by a doomworld discussion
    // https://www.doomworld.com/forum/topic/122794-source-code-monster-behavior-moving-around-objects/

    // set search direction baesd on location of target and mobj
    const dx = target.position.val.x - mobj.position.val.x;
    const dy = target.position.val.y - mobj.position.val.y;
    _moveDir[0] = dx > 10 ? CompassDirection.East : dx < 10 ? CompassDirection.West : CompassDirection.None;
    _moveDir[1] = dy > 10 ? CompassDirection.North : dy < 10 ? CompassDirection.South : CompassDirection.None;
    const originalDir = mobj.movedir;
    const oppositeDir = compassOpposite[originalDir];

    // diagonal is best, let's try that first
    if (_moveDir[0] !== CompassDirection.None && _moveDir[1] !== CompassDirection.None) {
        // TODO: doom used a pretty cool lookup table... can we do that too?
        const moveDir =
            _moveDir[0] === CompassDirection.East && _moveDir[1] === CompassDirection.South ? CompassDirection.SouthEast :
            _moveDir[0] === CompassDirection.West && _moveDir[1] === CompassDirection.South ? CompassDirection.SouthWest :
            _moveDir[0] === CompassDirection.East && _moveDir[1] === CompassDirection.North ? CompassDirection.NorthEast :
            CompassDirection.NorthWest;
        if (moveDir !== oppositeDir && setMovement(mobj, moveDir)) {
            return;
        }
    }

    // diagonal didn't work, let's try the longer of x or y movement
    // NOTE: horizontal/vertical are sometimes swapped too - just to keep things interesting.
    if (Math.abs(dy) > Math.abs(dx) || Math.random() > swapDirectionChance) {
        const t = _moveDir[0];
        _moveDir[0] = _moveDir[1];
        _moveDir[1] = t;
    }
    for (let i = 0; i < _moveDir.length; i++) {
        if (_moveDir[i] !== oppositeDir && setMovement(mobj, _moveDir[i])) {
            return;
        }
    }

    // new direction does not seem to work so try the original direction
    if (setMovement(mobj, originalDir)) {
        return;
    }

    // still can't find a good direction? move in the first direction we can
    const dirs = Math.random() < 0.5 ? searchDirections : reverseSearchDirections;
    for (let i = 0; i < dirs.length; i++) {
        if (dirs[i] !== oppositeDir && setMovement(mobj, dirs[i])) {
            return;
        }
    }

    // as a last resort, maybe we can 180?
    if (setMovement(mobj, oppositeDir)) {
        return;
    }

    mobj.movedir = CompassDirection.None;
}

function setMovement(mobj: MapObject, dir: number) {
    if (!canMove(mobj, dir)) {
        return false;
    }
    mobj.movedir = dir;
    // don't set direction immediately, we do it gradually in A_Chase
    mobj.movecount = randInt(0, 15);
    return true;
}

const _moveVec = new Vector3();
function canMove(mobj: MapObject, dir: number) {
    if (dir === CompassDirection.None) {
        return false; // this means no movement so don't bother checking anything
    }
    dir += Math.PI;
    const start = mobj.position.val;
    _moveVec.set(
        Math.cos(dir) * mobj.info.speed,
        Math.sin(dir) * mobj.info.speed,
        0);
    return !moveBlocked(mobj, start, _moveVec);
}

const maxStepSize = 24;
function moveBlocked(mobj: MapObject, start: Vector3, move: Vector3) {
    let hitSomething = false;
    // a simplified version of the move trace from MapObject.updatePosition()
    mobj.map.data.traceMove(start, move, mobj.info.radius, hit => {
        if ('mobj' in hit) {
            const ignore = false
                || (hit.mobj === mobj) // don't collide with yourself
                || (!(hit.mobj.info.flags & hittableThing)) // not hittable
                || (hit.mobj.info.flags & MFFlags.MF_SPECIAL) // skip pickupable things because monsters don't pick things up
                || (start.z + mobj.info.height < hit.mobj.position.val.z) // passed under target
                || (start.z > hit.mobj.position.val.z + hit.mobj.info.height) // passed over target
            if (ignore) {
                return true;
            }
            hitSomething = true;
        } else if ('line' in hit) {
            const twoSided = Boolean(hit.line.left);
            const blocking = Boolean(hit.line.flags & (0x0002 | 0x0001)); // blocks monsters or players and monsters
            if (twoSided && !blocking) {
                const endSect = hit.side < 0 ? hit.line.left.sector : hit.line.right.sector;

                // FIXME: we probably need something slightly different for floating monsters
                const floorChangeOk = (endSect.zFloor.val - start.z <= maxStepSize);
                const transitionGapOk = (endSect.zCeil.val - start.z >= mobj.info.height);
                const newCeilingFloorGapOk = (endSect.zCeil.val - endSect.zFloor.val >= mobj.info.height);
                const dropOffOk =
                    (mobj.info.flags & (MFFlags.MF_DROPOFF | MFFlags.MF_FLOAT)) ||
                    (start.z - endSect.zFloor.val <= maxStepSize);

                if (newCeilingFloorGapOk && transitionGapOk && floorChangeOk && dropOffOk) {
                    return true; // step/ceiling/drop-off collision is okay so try next line
                }
            }
            hitSomething = true;
        }
        return !hitSomething;
    });
    return hitSomething;
}

function canMeleeAttack(mobj: MapObject, target: MapObject) {
    const dist = mobj.position.val.distanceTo(target.position.val);
    // hmmm... why 20?
    if (dist >= meleeRange - 20 + target.info.radius) {
        return false;
    }
    if (!hasLineOfSight(mobj, target)) {
        // we are in range but we can't see the target (maybe we're behind a door or on a platform?)
        return false;
    }
    return true;
}

function canShootAttack(mobj: MapObject, target: MapObject) {
    if (!hasLineOfSight(mobj, target)) {
        // don't shoot if we can't see the target
        return false;
    }
    if (mobj.info.flags & MFFlags.MF_JUSTHIT) {
        // we were just hit so attack!
        mobj.info.flags &= ~MFFlags.MF_JUSTHIT;
        return true;
    }
    if (mobj.reactiontime) {
        return false;
    }

    // fire or not based on a complex heuristic...
    // why 64?
    let chance = mobj.position.val.distanceTo(target.position.val) - 64;
    if (!mobj.info.meleestate) {
	    chance -= 128; // no melee attack, so increase the chance of firing
    }
    if (mobj.type === MapObjectIndex.MT_VILE && chance > 14*64) {
        return false; // too far away
    }
    if (mobj.type === MapObjectIndex.MT_UNDEAD) {
        if (chance < 196) {
            return false;	// close for fist attack
        }
        chance *= 0.5;
    }
    if (mobj.type === MapObjectIndex.MT_CYBORG || mobj.type === MapObjectIndex.MT_SPIDER || mobj.type === MapObjectIndex.MT_SKULL) {
        chance *= 0.5;
    }
    if (chance > 200) {
        chance = 200;
    }
    if (mobj.type === MapObjectIndex.MT_CYBORG && chance > 160) {
	    chance = 160;
    }
    return (randInt(0, 255) > chance);
}
