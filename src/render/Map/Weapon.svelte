<script lang="ts">
    import { type Size, T } from "@threlte/core";
    import { weaponTop, type PlayerMapObject } from "../../doom";
    import WeaponSprite from "../Components/WeaponSprite.svelte";
    import { useDoom } from "../DoomContext";

    export let player: PlayerMapObject;
    export let screenSize: Size;
    export let yScale: number;

    const { sector, weapon } = player;

    $: sprite = $weapon.sprite;
    $: flashSprite = $weapon.flashSprite;
    $: pos = $weapon.position;

    const cameraMode = useDoom().game.settings.cameraMode;
    $: scale = $cameraMode === '1p' ? Math.max(2.5, screenSize.height / 200) : 1;
    const screenPosition = { x: 0, y: 0 };
    $: screenPosition.x = $cameraMode === '1p'
        ? $pos.x - (160 * scale) // center screen
        : $pos.x - screenSize.width * .5; // right side
    $: screenPosition.y = scale * ($pos.y + weaponTop) +
        ($cameraMode === '1p'
            // Why 135 and 160?? *shrug* it looks about right
            ? -screenSize.height * .5 + (135 * scale)
            : -screenSize.height * .5 + (160 * yScale / scale));
</script>

<T.Group
    scale.x={scale}
    scale.y={scale / yScale}
    position.x={screenPosition.x}
    position.y={screenPosition.y}
>
    <WeaponSprite
        sprite={$sprite}
        sector={$sector}
    />
    {#if $flashSprite}
        <WeaponSprite
            flash
            sprite={$flashSprite}
            sector={$sector}
        />
    {/if}
</T.Group>