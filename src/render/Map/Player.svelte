<script lang="ts">
    import { HierarchicalObject, T, useTask, useThrelte } from "@threlte/core";
    import Thing from "./Thing.svelte";
    import { Camera, CircleGeometry, MeshStandardMaterial, OrthographicCamera, Scene } from "three";
    import { useDoomMap } from "../DoomContext";
    import { ticksPerSecond } from "../../doom";
    import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader';
    import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
    import { ScreenColorShader } from "../Shaders/ScreenColorShader";
    import OrthoCam from "./Camera/Orthographic.svelte";
    import FirstPersonCam from "./Camera/FirstPerson.svelte";
    import OverheadCam from "./Camera/Overhead.svelte";
    import FollowCam from "./Camera/Follow.svelte";
    // TODO: does pmndrs/postprocessing offer an advantage here?
    import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
    import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
    import Weapon from "./Weapon.svelte";

    const { map, renderSectors } = useDoomMap();
    const { cameraMode } = map.game.settings;
    const player = map.player;

    const { position: playerPosition, damageCount, bonusCount, inventory, sector } = player;
    $: renderSector = $sector && renderSectors.find(e => e.sector === $sector)
    $: zFloor = $sector.zFloor;

    // not sure this is correct but it looks about right https://doomwiki.org/wiki/Aspect_ratio
    const yScale = (4 / 3) / (16 / 10);

    const cPass = new ShaderPass(ScreenColorShader);
    $: cPass.uniforms.invunlTime.value = $inventory.items.invincibilityTicks / ticksPerSecond;
    $: cPass.uniforms.radiationTime.value = $inventory.items.radiationSuitTicks / ticksPerSecond;
    $: cPass.uniforms.berserkTime.value = $inventory.items.berserkTicks / ticksPerSecond;
    $: cPass.uniforms.damageCount.value = $damageCount;
    $: cPass.uniforms.bonusCount.value = $bonusCount;

    let hudScene: Scene;
    let hudCam: OrthographicCamera;
    // Using a shader pass requires a bit more work now with threlte6
    // https://threlte.xyz/docs/learn/advanced/migration-guide#usethrelteroot-has-been-removed
    const { scene, renderer, camera, size, renderStage } = useThrelte();
    const composer = new EffectComposer(renderer);

    const setupEffectComposer = (camera: Camera, hudScene: Scene) => {
        composer.passes.length = 0;
        composer.addPass(new RenderPass(scene, camera))
        if (hudScene) {
            const p = new RenderPass(hudScene, hudCam);
            p.clear = false;
            p.clearDepth = true;
            composer.addPass(p);
        }
        composer.addPass(new ShaderPass(GammaCorrectionShader));
        composer.addPass(cPass);
    }
    $: setupEffectComposer($camera, hudScene);
    $: composer.setSize($size.width, $size.height);

    useTask(delta => {
        composer.render(delta);
    }, { stage: renderStage });
</script>

{#if $cameraMode !== "1p"}
    <Thing {renderSector} thing={player} />

    <T.Mesh
        geometry={new CircleGeometry(player.info.radius)}
        position.x={$playerPosition.x}
        position.y={$playerPosition.y}
        position.z={$zFloor + 1}
        material={new MeshStandardMaterial({ color: "black", opacity: 0.6, transparent: true })}
    />
{/if}

{#if $cameraMode === "ortho"}
    <OrthoCam {yScale} />
{:else if $cameraMode === "bird"}
    <OverheadCam {yScale} />
{:else if $cameraMode === '3p' || $cameraMode === '3p-noclip'}
    <FollowCam {yScale} />
{:else}
    <FirstPersonCam {yScale} />
{/if}

<!--
    Don't add this scene to the parent scene (the root) because we are only rendering the HUD
    which is composited by a RenderPass
-->
<HierarchicalObject
    onChildMount={() => {}}
>
    <T.OrthographicCamera bind:ref={hudCam} />
    <T.Scene bind:ref={hudScene}>
        <T.AmbientLight color={'white'} intensity={4} />
        <Weapon {player} {yScale} screenSize={$size}/>
    </T.Scene>
</HierarchicalObject>