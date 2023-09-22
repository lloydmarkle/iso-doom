<script lang="ts">
    import type { PlayerInventory, PlayerMapObject } from "../../doom";
    import { angleBetween, normalizeAngle, randInt } from "../../doom";
    import Picture from "../Components/Picture.svelte";
    import { useDoom } from "../DoomContext";

    export let player: PlayerMapObject;

    const { game } = useDoom();
    const { tick } = game.time;
    const { health, inventory } = player;

    const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
    const ticksPerSecond = 35;
    const painFaces = 5;
    const painDivisor = painFaces / 100;

    // adaptation of ST_updateFaceWidget from st_stuff.c
    let priority = 0;
    let nextFaceTicks = 0;
    let variation = 0;
    let rampageTime = 0;

    $: healthIndex = clamp(painFaces - Math.trunc($health * painDivisor), 1, painFaces) - 1; // -1 because index is from 0 to 4
    let state = 'STFST00';

    $: if ($tick) {
        rampageTime = game.input.attack ? rampageTime + 1 : -0;
        const angle = badGuyAngle();

        state =
            $health <= 0 ? faceState('STFDEAD0', 10, 1) : // dead
            hasNewWeapon($inventory) ? faceState(`STFEVL${healthIndex}`, 9, 2 * ticksPerSecond) : // grin
            player.damageCount && bigHurt() ? faceState(`STFOUCH${healthIndex}`, 7, ticksPerSecond) :
            player.damageCount && player.attacker && player.attacker !== player ? (
                angle === 'left' ? faceState(`STFTL${healthIndex}`, 7, ticksPerSecond) :
                angle === 'right' ? faceState(`STFR${healthIndex}`, 7, ticksPerSecond) :
                faceState(`STFKILL${healthIndex}`, 7, ticksPerSecond)
            ) :
            player.damageCount ? faceState(`STFKILL${healthIndex}`, 6, ticksPerSecond) :
            // TODO: pain from enemy => left/right/ouch/mad (`STFTL${healthIndex}0` or `STFR${healthIndex}0` or see below)
            // TODO: pain from self => ouch/mad () or `STFKILL${healthIndex}`)
            rampageTime > 2 * ticksPerSecond ? faceState(`STFKILL${healthIndex}`, 5, 1) :
            $inventory.items.invincibilityTicks ? faceState('STFGOD0', 4, 1) : // invincibility
            faceState(`STFST${healthIndex}${variation}`, 0, Math.trunc(ticksPerSecond * 0.5)); // straight or left/right eye brow
    }

    let oldWeapons = [...$inventory.weapons];
    function hasNewWeapon(inv: PlayerInventory) {
        let newWeapon = false;
        for (let i = 0; i < inv.weapons.length; i++) {
            newWeapon = newWeapon || (oldWeapons[i] !== inv.weapons[i]);
            oldWeapons[i] = inv.weapons[i];
        }
        return newWeapon;
    }

    let lastHealth = $health;
    function bigHurt() {
        let last = lastHealth;
        lastHealth = $health;
        return (last - $health > 20);
    }

    function badGuyAngle(): 'left' | 'right' | 'other' {
        // maybe after we get some ai working...
        // const dir = player.direction.val;
        // const ang = angleBetween(player, player.attacker);
        // const angle = normalizeAngle(ang - dir);
        return 'other';
    }

    function faceState(face: string, order: number, ticks: number) {
        if (order > priority) {
            priority = order;
            nextFaceTicks = ticks;
            return face;
        }

        if (!nextFaceTicks) {
            priority = 0;
            variation = randInt(0, 3);
            nextFaceTicks = ticks;
            return face;
        }

        nextFaceTicks--;
        return state;
    }
</script>

<Picture name={state} />