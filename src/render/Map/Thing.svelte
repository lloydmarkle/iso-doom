<script lang="ts" context="module">
    // all things are planes so may as well use the same geometry
    // TODO: actually we can do better than this. We can use instancing per thing type
    // so that we only have one draw call per type. It means we'll need to create a sprite
    // sheet though and uv index to the appropriate frame but it's doable.
    // TODO2: next level... single sprite sheet for all sprites so one draw call for all mobjs?
    const geometry = new PlaneGeometry();
</script>
<script lang="ts">
    import { T } from '@threlte/core';
    import { TransformControls } from '@threlte/extras';
    import { MeshStandardMaterial, PlaneGeometry, ShaderMaterial } from 'three';
    import { useAppContext, useDoom, useDoomMap } from '../DoomContext';
    import { EIGHTH_PI, QUARTER_PI, type MapObject, HALF_PI, MFFlags, normalizeAngle } from '../../doom';
    import { ShadowsShader } from '../Shaders/ShadowsShader';
    import Wireframe from '../Debug/Wireframe.svelte';
    import type { RenderSector } from '../RenderData';

    export let thing: MapObject;
    export let renderSector: RenderSector;

    const { map, camera } = useDoomMap();
    const tick = map.game.time.tick;
    const { editor } = useAppContext();
    const { textures, wad } = useDoom();
    const cameraMode = map.game.settings.cameraMode;
    const extraLight = map.player.extraLight;

    const vis = renderSector.visible;
    $: visible = $vis;
    const { sector, position: tpos, sprite, direction, renderShadow } = thing;
    const invertYOffset = (thing.info.flags & MFFlags.InvertSpriteYOffset);
    const isBillboard = (thing.info.flags & MFFlags.BillboardSprite);
    const isMissile = thing.info.flags & MFFlags.MF_MISSILE;
    const camPos = camera.position;
    const camAngle = camera.angle;

    $: ang = $cameraMode === 'bird' ? $direction + Math.PI : Math.atan2($tpos.y - $camPos.y, $tpos.x - $camPos.x);
    $: rot =  Math.floor((EIGHTH_PI + normalizeAngle(ang - $direction)) / QUARTER_PI) % 8;
    $: frames = wad.spriteFrames($sprite.name);
    $: frame = frames[$sprite.frame][rot] ?? frames[$sprite.frame][0];

    $: texture = textures.get(frame.name, 'sprite');
    // Sprite offset is much more complicated than this but this is simple and looks okay-ish.
    // https://www.doomworld.com/forum/topic/110008-what-is-this-bs-with-gl-hardware-mode
    // and https://www.doomworld.com/forum/topic/68145-source-port-sprites-through-the-floor
    $: vOffset =
        Math.max(texture.userData.yOffset - texture.userData.height, 0) + (texture.userData.height * .5)
        * (invertYOffset ? -1 : 1)
        + (isMissile ? texture.userData.yOffset - texture.userData.height : 0);
    $: hOffset = (texture.userData.xOffset - texture.userData.width) + (texture.userData.width * .5);

    const rotation = { x: 0, y: 0, z: 0 };
    $: if ($cameraMode === 'bird') {
        rotation.x = Math.PI;
        rotation.y = -Math.PI;
        rotation.z = $direction - HALF_PI;
    } else if (isBillboard) {
        rotation.x = $camAngle.x;
        rotation.y = 0;
        rotation.z = $camAngle.z;
    } else {
        rotation.x = HALF_PI;
        rotation.y = $camAngle.z;
        rotation.z = 0;
    }

    $: material = $renderShadow
        ? new ShaderMaterial({ transparent: true, ...ShadowsShader() })
        : new MeshStandardMaterial({ alphaTest: 1, emissive: 'magenta' });

    $: if (material instanceof MeshStandardMaterial) {
        material.emissiveIntensity = ($editor.selected === thing) ? 0.1 : 0;
    }

    $: if (material instanceof ShaderMaterial && $tick) {
        material.uniforms.time.value = map.game.time.elapsed;
    }

    $: if (texture) {
        if (material instanceof ShaderMaterial) {
            material.uniforms.map.value = texture;
        } else {
            material.map = texture;
        }
    }

    $: light = $sector.light;
    $: if ($sprite.fullbright || $light !== undefined) {
        const col = textures.lightColor($sprite.fullbright ? 255 : $light + $extraLight);
        if (material instanceof ShaderMaterial) {
            material.uniforms.light.value = col;
        } else {
            material.color = col;
        }
    }

    function hit(ev) {
        ev.stopPropagation();
        $editor.selected = thing;
    }

    function positionChanged(ev) {
        tpos.val.x = Math.floor(ev.detail.target.worldPosition.x);
        tpos.val.y = Math.floor(ev.detail.target.worldPosition.y);
        tpos.set(tpos.val);
    }
</script>

<T.Mesh
    on:click={hit}
    userData={{ type: 'mobj', moType: thing.type }}
    renderOrder={1}
    {visible}
    {material}
    {geometry}
    scale.x={frame.mirror ? -texture.userData.width : texture.userData.width}
    scale.y={texture.userData.height}
    rotation.x={rotation.x}
    rotation.y={rotation.y}
    rotation.z={rotation.z ?? 0}
    rotation.order={'ZXY'}
    position.x={$tpos.x - Math.sin(ang) * hOffset}
    position.y={$tpos.y + Math.cos(ang) * hOffset}
    position.z={$tpos.z + vOffset}
>
    <!-- {#if $editor.selected === thing}
        <TransformControls
            mode='translate'
            showZ={false}
            on:object-changed={positionChanged}
        />
    {/if} -->
    <Wireframe />
</T.Mesh>
