import { randInt } from 'three/src/math/MathUtils';
import type { ThingType } from '.';
import { ActionIndex, MFFlags, MapObjectIndex, SoundIndex, StateIndex, states } from '../doom-things-info';
import type { GameTime } from '../game';
import type { MapObject } from '../map-object';
import { EIGHTH_PI, HALF_PI, QUARTER_PI, angleNoise, normalizeAngle, randomChoice } from '../math';
import { hasLineOfSight } from './obstacles';
import { Vector3 } from 'three';
import { hittableThing, zeroVec } from '../map-data';
import { attackRange, meleeRange, shotTracer, spawnPuff } from './weapons';
import { exitLevel, triggerSpecial } from '../specials';

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

const smallDeathSounds = [SoundIndex.sfx_podth1, SoundIndex.sfx_podth2, SoundIndex.sfx_podth3];
const bigDeathSounds = [SoundIndex.sfx_bgdth1, SoundIndex.sfx_bgdth2];

const smallSeeYouSounds = [SoundIndex.sfx_posit1, SoundIndex.sfx_posit2, SoundIndex.sfx_posit3];
const bigSeeYouSounds = [SoundIndex.sfx_bgsit1, SoundIndex.sfx_bgsit2];

const mancubusMissileSpread = HALF_PI / 8;
const halfMancubusMissileSpread = mancubusMissileSpread * .5;

type MonsterAction = (time: GameTime, mobj: MapObject) => void;
type ActionMap = { [key: number]: MonsterAction };

let currentBrainTarget = 0;
let brainTargets: MapObject[] = [];
const brainExplosionVelocity = 512 / (1 << 16);
const doom2BossActions: ActionMap = {
	[ActionIndex.A_BrainDie]: (time, mobj) => {
        exitLevel(mobj, 'normal');
    },
	[ActionIndex.A_BrainPain]: (time, mobj) => {
        mobj.map.game.sound.play(SoundIndex.sfx_bospn);
    },
	[ActionIndex.A_BrainScream]: (time, mobj) => {
        for (let x = mobj.position.val.x - 196; x < mobj.position.val.x + 320; x += 8) {
            const explode = mobj.map.spawn(MapObjectIndex.MT_ROCKET,
                x, mobj.position.val.y - 320, 128 + randInt(0, 510));
            explode.velocity.z = Math.random() * brainExplosionVelocity;
            explode.setState(StateIndex.S_BRAINEXPLODE1, -randInt(0, 7));
        }
        mobj.map.game.sound.play(SoundIndex.sfx_bosdth);
    },
    [ActionIndex.A_BrainExplode]: (time, mobj) => {
        const explode = mobj.map.spawn(MapObjectIndex.MT_ROCKET,
            mobj.position.val.x + randInt(-2048, 2048),
            mobj.position.val.y,
            128 + randInt(0, 510));
        explode.velocity.z = Math.random() * brainExplosionVelocity;
        explode.setState(StateIndex.S_BRAINEXPLODE1, -randInt(0, 7));
    },
	[ActionIndex.A_BrainAwake]: (time, mobj) => {
        mobj.map.game.sound.play(SoundIndex.sfx_bossit);
        // find all brain targets (ideally we could attach this to the map but I guess it's okay to use a global variable)
        currentBrainTarget = 0;
        brainTargets = mobj.map.objs.filter(mo => mo.type === MapObjectIndex.MT_BOSSTARGET);
    },
	[ActionIndex.A_BrainSpit]: (time, mobj) => {
        // easy ^= 1;
        // if (gameskill <= sk_easy && (!easy))
        // return;

        const target = brainTargets[currentBrainTarget];
        currentBrainTarget = (currentBrainTarget + 1) % brainTargets.length;

        const missile = shootMissile(mobj, target, MapObjectIndex.MT_SPAWNSHOT);
        missile.chaseTarget = target;
        missile.reactiontime = Math.floor((target.position.val.y - mobj.position.val.y) / missile.velocity.y / states[missile.info.spawnstate].tics);
        mobj.map.game.sound.play(SoundIndex.sfx_bospit);
    },
	[ActionIndex.A_SpawnSound]: (time, mobj) => {
        mobj.map.game.sound.play(SoundIndex.sfx_boscub, mobj);
        allActions[ActionIndex.A_SpawnFly](time, mobj);
    },
	[ActionIndex.A_SpawnFly]: (time, mobj) => {
        mobj.reactiontime -= 1;
        if (mobj.reactiontime) {
            return;	// still flying
        }

        const target = mobj.chaseTarget;
        const tpos = target.position.val;

        // choose monster type (see https://doomwiki.org/wiki/Monster_spawner)
        const chance = randInt(0, 255);
        const type =
            chance < 50 ? MapObjectIndex.MT_TROOP :
            chance < 90 ? MapObjectIndex.MT_SERGEANT :
            chance < 120 ? MapObjectIndex.MT_SHADOWS :
            chance < 130 ? MapObjectIndex.MT_PAIN :
            chance < 160 ? MapObjectIndex.MT_HEAD :
            chance < 162 ? MapObjectIndex.MT_VILE :
            chance < 172 ? MapObjectIndex.MT_UNDEAD :
            chance < 192 ? MapObjectIndex.MT_BABY :
            chance < 222 ? MapObjectIndex.MT_FATSO :
            chance < 246 ? MapObjectIndex.MT_KNIGHT :
            MapObjectIndex.MT_BRUISER;
        const monster = mobj.map.spawn(type, tpos.x, tpos.y, tpos.z);
        monster.chaseTarget = findPlayerTarget(monster, true);
        if (monster.chaseTarget) {
            monster.setState(monster.info.seestate);
        }
        // call teleport to telefrag anything in the way
        monster.teleport(target, monster.sector.val);

        // teleport flame
        const fog = mobj.map.spawn(MapObjectIndex.MT_SPAWNFIRE, tpos.x, tpos.y, tpos.z);
        mobj.map.game.sound.play(SoundIndex.sfx_telept, fog);
        // remove ourself
        mobj.map.destroy(mobj);
    },
};

const archvileActions: ActionMap = {
    [ActionIndex.A_VileChase]: (time, mobj) => {},
	[ActionIndex.A_VileStart]: (time, mobj) => {},
	[ActionIndex.A_VileTarget]: (time, mobj) => {},
	[ActionIndex.A_VileAttack]: (time, mobj) => {},
	[ActionIndex.A_StartFire]: (time, mobj) => {},
	[ActionIndex.A_Fire]: (time, mobj) => {},
	[ActionIndex.A_FireCrackle]: (time, mobj) => {},
}

export const monsterAiActions: ActionMap = {
    ...archvileActions,

    // Movement actions
    [ActionIndex.A_Look]: (time, mobj) => {
        if (!mobj.position) {
            // TODO: this only happens during MapObject constructor because we call A_Look before we set position. Can we avoid this check?
            // (see also A_Tracer)
            return;
        }
        mobj.chaseThreshold = 0;

        // TODO: check for sound targets?
        // TODO: also MF_AMBUSH flag (related to sound)
        mobj.chaseTarget = findPlayerTarget(mobj);
        if (!mobj.chaseTarget) {
            return;
        }

        const sound =
            smallSeeYouSounds.includes(mobj.info.seesound) ? randomChoice(smallSeeYouSounds) :
            bigSeeYouSounds.includes(mobj.info.seesound) ? randomChoice(bigSeeYouSounds) :
            mobj.info.seesound;
        const soundActor = mobj.type === MapObjectIndex.MT_SPIDER || mobj.type === MapObjectIndex.MT_CYBORG ? null : mobj;
        mobj.map.game.sound.play(sound, soundActor);
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

        // make a small turns when mobj.direction !== mobj.movedir
        if (mobj.movedir !== MoveDirection.None) {
            const diff = normalizeAngle((mobj.direction.val + Math.PI) - mobj.movedir) - Math.PI;
            if (Math.abs(diff) > EIGHTH_PI) { // only update if we're off by large-ish amount
                mobj.direction.update(val => val + ((diff < 0) ? QUARTER_PI : -QUARTER_PI));
            }
        }

        // no target or target is not shootable (dead)? find a new one
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
            mobj.map.game.sound.play(mobj.info.attacksound, mobj);
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

        // in net games, try to find another target when we can no longer see the current one
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

        // sometimes play "active" sound
        if (randInt(0, 255) < 3) {
            mobj.map.game.sound.play(mobj.info.activesound, mobj);
        }
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

    // Attack actions
    // TODO: it would be a fun exercise to write some unit tests for these and then see if these could be
    // written in a functional way by combining smaller functions
    [ActionIndex.A_PosAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        mobj.map.game.sound.play(SoundIndex.sfx_pistol, mobj);

        const slope = shotTracer.zAim(mobj, attackRange, mobj.direction.val);
        const angle = mobj.direction.val + angleNoise(25);
        const damage = 3 * randInt(1, 5);
        shotTracer.fire(mobj, damage, angle, slope, attackRange);
    },
	[ActionIndex.A_SPosAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        mobj.map.game.sound.play(SoundIndex.sfx_shotgn, mobj);

        const slope = shotTracer.zAim(mobj, attackRange, mobj.direction.val);
        for (let i = 0; i < 3; i++) {
            const angle = mobj.direction.val + angleNoise(25);
            const damage = 3 * randInt(1, 5);
            shotTracer.fire(mobj, damage, angle, slope, attackRange);
        }
    },
    [ActionIndex.A_SkelWhoosh]: (time, mobj) => {
        if (!mobj.chaseTarget) {
            return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        mobj.map.game.sound.play(SoundIndex.sfx_skeswg, mobj);
    },
	[ActionIndex.A_SkelFist]: (time, mobj) => {
        if (!mobj.chaseTarget) {
            return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        if (canMeleeAttack(mobj, mobj.chaseTarget)) {
            const damage = 6 * randInt(1, 10);
            mobj.chaseTarget.damage(damage, mobj, mobj);
            mobj.map.game.sound.play(SoundIndex.sfx_skepch, mobj);
        }
    },
	[ActionIndex.A_SkelMissile]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        const tracer = shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_TRACER);
        tracer.tracerTarget = mobj.chaseTarget;
        // revenant missiles are spawned a little higher than most things so adjust the z and re-launch the projectile
        tracer.position.update(pos => pos.setZ(pos.z + 16));
        launchMapObject(tracer, mobj.chaseTarget, shotZOffset, tracer.info.speed);
    },
	[ActionIndex.A_CPosAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        mobj.map.game.sound.play(SoundIndex.sfx_shotgn, mobj);

        const angle = mobj.direction.val + angleNoise(25);
        const damage = 3 * randInt(1, 5);
        const slope = shotTracer.zAim(mobj, attackRange, mobj.direction.val);
        shotTracer.fire(mobj, damage, angle, slope, attackRange);
    },
	[ActionIndex.A_CPosRefire]: (time, mobj) => {
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        if (randInt(0, 255) < 40) {
            return; // only check for active target occasionally (about 16% of the time)
        }
        const stopShooting = !mobj.chaseTarget || mobj.chaseTarget.isDead || !hasLineOfSight(mobj, mobj.chaseTarget)
        if (stopShooting) {
            mobj.setState(mobj.info.seestate);
        }
    },
	[ActionIndex.A_TroopAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);

        if (canMeleeAttack(mobj, mobj.chaseTarget)) {
            const damage = 3 * randInt(1, 8);
            mobj.chaseTarget.damage(damage, mobj, mobj);
            mobj.map.game.sound.play(SoundIndex.sfx_claw, mobj);
            return;
        }
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_TROOPSHOT);
    },
	[ActionIndex.A_SargAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
            return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);

        if (canMeleeAttack(mobj, mobj.chaseTarget)) {
            const damage = 4 * randInt(1, 10);
            mobj.chaseTarget.damage(damage, mobj, mobj);
        }
    },
	[ActionIndex.A_HeadAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);

        if (canMeleeAttack(mobj, mobj.chaseTarget)) {
            const damage = 10 * randInt(1, 6);
            mobj.chaseTarget.damage(damage, mobj, mobj);
            return;
        }
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_HEADSHOT);
    },
	[ActionIndex.A_BruisAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);

        if (canMeleeAttack(mobj, mobj.chaseTarget)) {
            const damage = 10 * randInt(1, 8);
            mobj.chaseTarget.damage(damage, mobj, mobj);
            mobj.map.game.sound.play(SoundIndex.sfx_claw, mobj);
            return;
        }
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_BRUISERSHOT);
    },
	[ActionIndex.A_SkullAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);

        mobj.info.flags |= MFFlags.MF_SKULLFLY;
        mobj.map.game.sound.play(mobj.info.attacksound, mobj);
        launchMapObject(mobj, mobj.chaseTarget, mobj.chaseTarget.info.height * .5, 20);
    },
    [ActionIndex.A_FatRaise]: (time, mobj) => {
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        mobj.map.game.sound.play(SoundIndex.sfx_manatk, mobj);
    },
	[ActionIndex.A_FatAttack1]: (time, mobj) => {
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_FATSHOT);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_FATSHOT, mobj.direction.val + mancubusMissileSpread);
    },
	[ActionIndex.A_FatAttack2]: (time, mobj) => {
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_FATSHOT);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_FATSHOT, mobj.direction.val - mancubusMissileSpread);
    },
	[ActionIndex.A_FatAttack3]: (time, mobj) => {
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_FATSHOT, mobj.direction.val - halfMancubusMissileSpread);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_FATSHOT, mobj.direction.val + halfMancubusMissileSpread);
    },
	[ActionIndex.A_SpidRefire]: (time, mobj) => {
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        if (randInt(0, 255) < 10) {
            return; // only check for active target occasionally (about 4% of the time)
        }
        const stopShooting = !mobj.chaseTarget || mobj.chaseTarget.isDead || !hasLineOfSight(mobj, mobj.chaseTarget)
        if (stopShooting) {
            mobj.setState(mobj.info.seestate);
        }
    },
	[ActionIndex.A_BspiAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
            return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_ARACHPLAZ);
    },
	[ActionIndex.A_CyberAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
	        return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        shootMissile(mobj, mobj.chaseTarget, MapObjectIndex.MT_ROCKET);
    },
	[ActionIndex.A_PainAttack]: (time, mobj) => {
        if (!mobj.chaseTarget) {
            return;
        }
        allActions[ActionIndex.A_FaceTarget](time, mobj);
        spawnLostSoul(time, mobj, mobj.direction.val);
    },

    // revenant missiles (tracking and smoke)
    [ActionIndex.A_Tracer]: (time, missile) => {
        // I actually never noticed that some revenant missiles do not emit smoke and do not track the player. Wow!
        // This condition creates a really subtle behaviour. https://zdoom.org/wiki/A_Tracer
        if ( !missile.position) {
            return;
        }

        // decorations like puff and smoke
        spawnPuff(missile, missile.position.val);
        const smoke = missile.map.spawn(MapObjectIndex.MT_SMOKE,
                missile.position.val.x - missile.velocity.x,
                missile.position.val.y - missile.velocity.y,
                missile.position.val.z);
        smoke.velocity.z = 1;
        smoke.setState(smoke.info.spawnstate, -randInt(0, 2));

        // adjust direction
        const target = missile.tracerTarget;
        if (!target || target.isDead) {
            return;
        }

        // adjust x/y direction
        const adjustment = -1.1; // this constant isn't quite what doom uses (I not 100% confident in the integer angle math...) but it feels close
        const angle = Math.atan2(target.position.val.y - missile.position.val.y, target.position.val.x - missile.position.val.x);
        let missileAngle = missile.direction.val;
        if (normalizeAngle(angle - missileAngle) > Math.PI) {
            missileAngle -= adjustment;
            missile.direction.set(normalizeAngle(angle - missileAngle) < Math.PI ? angle : missileAngle);
        } else {
            missileAngle += adjustment;
            missile.direction.set(normalizeAngle(angle - missileAngle) > Math.PI ? angle : missileAngle);
        }
        missile.velocity.x = Math.cos(missile.direction.val) * missile.info.speed;
        missile.velocity.y = Math.sin(missile.direction.val) * missile.info.speed;

        // adjust z
        const zAdjust = .125;
        _deltaVec.copy(target.position.val).sub(missile.position.val);
        const dist = Math.sqrt(_deltaVec.x * _deltaVec.x + _deltaVec.y * _deltaVec.y);
        const slope = ((target.position.val.z + 40) - missile.position.val.z) / dist * missile.info.speed;
        missile.velocity.z += slope < missile.velocity.z ? -zAdjust : zAdjust;
    },
}

export const monsterActions: ActionMap = {
    ...doom2BossActions,

    // Death Actions
	[ActionIndex.A_PainDie]: (time, mobj) => {
        allActions[ActionIndex.A_Fall](time, mobj);
        spawnLostSoul(time, mobj, mobj.direction.val + HALF_PI);
        spawnLostSoul(time, mobj, mobj.direction.val + Math.PI);
        spawnLostSoul(time, mobj, mobj.direction.val - HALF_PI);
    },
    [ActionIndex.A_Scream]: (time, mobj) => {
        const sound = smallDeathSounds.includes(mobj.info.deathsound) ? randomChoice(smallDeathSounds) :
            bigDeathSounds.includes(mobj.info.deathsound) ? randomChoice(bigDeathSounds) :
            mobj.info.deathsound;
        // don't set location for bosses so the sound plays at full volume
        const location = (mobj.type === MapObjectIndex.MT_SPIDER || mobj.type === MapObjectIndex.MT_CYBORG) ? null : mobj;
        mobj.map.game.sound.play(sound, location);
    },
    // These two are related to sector tags 666 and 667
	[ActionIndex.A_KeenDie]: (time, mobj) => {
        allActions[ActionIndex.A_Fall](time, mobj);
        if (anyMonstersOfSameTypeAlive(mobj)) {
            return;
        }
        const fakeLine: any = { tag: 666, special: 2 };
        triggerSpecial(mobj.map.player, fakeLine, 'W', -1);
    },
	[ActionIndex.A_BossDeath]: (time, mobj) => {
        let fakeLine: any = null;

        if (mobj.map.name === 'MAP07' && (mobj.type === MapObjectIndex.MT_FATSO || mobj.type === MapObjectIndex.MT_BABY)) {
            fakeLine =
                (mobj.type === MapObjectIndex.MT_FATSO) ? { tag: 666, special: 38 } :
                (mobj.type === MapObjectIndex.MT_BABY) ? { tag: 667, special: 30 } :
                null; // <-- we should never get here
        }
        if (mobj.map.name === 'E1M8' && mobj.type === MapObjectIndex.MT_BRUISER) {
            fakeLine = { tag: 666, special: 38 };
        }
        if (mobj.map.name === 'E2M8' && mobj.type === MapObjectIndex.MT_CYBORG) {
            fakeLine = { special: 52 };
        }
        if (mobj.map.name === 'E3M8' && mobj.type === MapObjectIndex.MT_SPIDER) {
            fakeLine = { special: 52 };
        }
        if (mobj.map.name === 'E4M6' && mobj.type === MapObjectIndex.MT_CYBORG) {
            fakeLine = { tag: 666, special: 109 };
        }
        if (mobj.map.name === 'E4M8' && mobj.type === MapObjectIndex.MT_SPIDER) {
            fakeLine = { tag: 666, special: 38 };
        }

        if (!fakeLine) {
            return;
        }
        // TODO: multiplayer needs to have at least one player alive
        if (mobj.map.player.isDead) {
            return;
        }
        if (anyMonstersOfSameTypeAlive(mobj)) {
            return;
        }
        triggerSpecial(mobj.map.player, fakeLine, 'W', -1);
    },

    // Mostly about playing a sound
    [ActionIndex.A_Metal]: (time, mobj) => {
        mobj.map.game.sound.play(SoundIndex.sfx_metal, mobj);
        allActions[ActionIndex.A_Chase](time, mobj);
    },
	[ActionIndex.A_BabyMetal]: (time, mobj) => {
        mobj.map.game.sound.play(SoundIndex.sfx_bspwlk, mobj);
        allActions[ActionIndex.A_Chase](time, mobj);
    },
	[ActionIndex.A_Hoof]: (time, mobj) => {
        mobj.map.game.sound.play(SoundIndex.sfx_hoof, mobj);
        allActions[ActionIndex.A_Chase](time, mobj);
    },
    [ActionIndex.A_Pain]: (time, mobj) => {
        mobj.map.game.sound.play(mobj.info.painsound, mobj);
    },
	[ActionIndex.A_Fall]: (time, mobj) => {
        mobj.info.flags &= ~MFFlags.MF_SOLID;
    },
	[ActionIndex.A_XScream]: (time, mobj) => {
        mobj.map.game.sound.play(SoundIndex.sfx_slop, mobj);
    },
    // player only so maybe it could be moved to a player specific place?
	[ActionIndex.A_PlayerScream]: (time, player) => {
        const sound = player.health.val < -50 && !player.map.game.episodic
            ? SoundIndex.sfx_pdiehi : SoundIndex.sfx_pldeth;
        player.map.game.sound.play(sound, player);
    },
};

const anyMonstersOfSameTypeAlive = (mobj: MapObject) =>
    mobj.map.objs.filter(mo => mo.type === mobj.type).some(mo => !mo.isDead);

const allActions = { ...monsterActions, ...monsterAiActions, ...doom2BossActions, ...archvileActions };

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

enum MoveDirection {
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
    [MoveDirection.West]: MoveDirection.East,
    [MoveDirection.SouthWest]: MoveDirection.NorthEast,
    [MoveDirection.South]: MoveDirection.North,
    [MoveDirection.SouthEast]: MoveDirection.NorthWest,
    [MoveDirection.East]: MoveDirection.West,
    [MoveDirection.NorthEast]: MoveDirection.SouthWest,
    [MoveDirection.North]: MoveDirection.South,
    [MoveDirection.NorthWest]: MoveDirection.SouthEast,
    [MoveDirection.None]: MoveDirection.None
}
const searchDirections = [
    MoveDirection.East, MoveDirection.NorthEast, MoveDirection.North, MoveDirection.NorthWest,
    MoveDirection.West, MoveDirection.SouthWest, MoveDirection.South, MoveDirection.SouthEast,
];
const reverseSearchDirections = searchDirections.toReversed();
// A table like these feels more doom-like than a conditional expression
const compassDiagonals = {
    [MoveDirection.East]: {
        [MoveDirection.North]: MoveDirection.NorthEast,
        [MoveDirection.South]: MoveDirection.SouthEast,
    },
    [MoveDirection.West]: {
        [MoveDirection.North]: MoveDirection.NorthWest,
        [MoveDirection.South]: MoveDirection.SouthWest,
    }
};
const swapDirectionChance = 200 / 255;
let _moveDir = [0, 0];
function newChaseDir(mobj: MapObject, target: MapObject) {
    // Kind of P_NewChaseDir but also helped along by a doomworld discussion
    // https://www.doomworld.com/forum/topic/122794-source-code-monster-behavior-moving-around-objects/

    // set search direction baesd on location of target and mobj
    const dx = target.position.val.x - mobj.position.val.x;
    const dy = target.position.val.y - mobj.position.val.y;
    _moveDir[0] = dx > 10 ? MoveDirection.East : dx < -10 ? MoveDirection.West : MoveDirection.None;
    _moveDir[1] = dy > 10 ? MoveDirection.North : dy < -10 ? MoveDirection.South : MoveDirection.None;
    const originalDir = mobj.movedir;
    const oppositeDir = compassOpposite[originalDir];

    // diagonal is best, let's try that first
    if (_moveDir[0] !== MoveDirection.None && _moveDir[1] !== MoveDirection.None) {
        const moveDir = compassDiagonals[_moveDir[0]][_moveDir[1]];
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

    // nothing works, stop moving(?)
    mobj.movedir = MoveDirection.None;
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
    if (dir === MoveDirection.None) {
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

const shotZOffset = 32;
type MissileType =
    // doom
    MapObjectIndex.MT_TROOPSHOT | MapObjectIndex.MT_HEADSHOT | MapObjectIndex.MT_BRUISERSHOT | MapObjectIndex.MT_ROCKET |
    // doom 2
    MapObjectIndex.MT_ARACHPLAZ | MapObjectIndex.MT_FATSHOT | MapObjectIndex.MT_TRACER | MapObjectIndex.MT_SPAWNSHOT;
// TODO: similar (but also different) from player shootMissile in weapon.ts. Maybe we can combine these?
function shootMissile(shooter: MapObject, target: MapObject, type: MissileType, angle?: number) {
    const pos = shooter.position.val;
    const mobj = shooter.map.spawn(type, pos.x, pos.y, pos.z + shotZOffset);
    let an = angle ?? Math.atan2(target.position.val.y - shooter.position.val.y, target.position.val.x - shooter.position.val.x);
    if (target.info.flags & MFFlags.MF_SHADOW) {
        // shadow objects (invisibility) should add error to angle
        an += angleNoise(25);
    }
    mobj.direction.set(an);
    // this is kind of an abuse of "chaseTarget" but missles won't ever chase anyone anyway. It's used when a missile
    // hits a target to know who fired it.
    mobj.chaseTarget = shooter;

    launchMapObject(mobj, target, shotZOffset, mobj.info.speed);
    mobj.map.game.sound.play(mobj.info.seesound, mobj);
    return mobj;
}

const _deltaVec = new Vector3;
function launchMapObject(mobj: MapObject, target: MapObject, zOffset: number, speed: number) {
    _deltaVec.copy(target.position.val).sub(mobj.position.val);
    const dist = Math.sqrt(_deltaVec.x * _deltaVec.x + _deltaVec.y * _deltaVec.y);
    mobj.velocity.set(
        Math.cos(mobj.direction.val) * speed,
        Math.sin(mobj.direction.val) * speed,
        (_deltaVec.z + zOffset) / dist * speed);
}

function spawnLostSoul(time: GameTime, parent: MapObject, angle: number) {
    const lostSoulCount = parent.map.objs.reduce((count, m) => count + (m.type === MapObjectIndex.MT_SKULL ? 1 : 0), 0);
    // TODO: add a config to override this. It can be fun to see a huge flock of lost souls floating around
    if (lostSoulCount > 20) {
	    return;
    }

    const lostSoul = parent.map.spawn(MapObjectIndex.MT_SKULL, parent.position.val.x, parent.position.val.y, parent.position.val.z);
    const offset = 4 + 1.5 * (parent.info.radius + lostSoul.info.radius);
    lostSoul.position.update(pos => {
        pos.x += Math.cos(angle) * offset;
        pos.y += Math.sin(angle) * offset;
        pos.z += 8;
        return pos;
    });
    // if the lost soul can't move, destroy it
    if (!moveBlocked(lostSoul, lostSoul.position.val, zeroVec)) {
        lostSoul.damage(10_000, parent, parent);
        return;
    }

    lostSoul.chaseTarget = parent.chaseTarget;
    monsterAiActions[ActionIndex.A_SkullAttack](time, lostSoul);
}