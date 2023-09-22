<script lang="ts">
    import { Mesh } from "@threlte/core";
    import { BackSide, BufferGeometry, FrontSide, MeshStandardMaterial } from "three";
    import { useDoom, useDoomMap } from "../DoomContext";
    import Wireframe from "../Debug/Wireframe.svelte";
    import type { RenderSector } from "../RenderData";

    export let renderSector: RenderSector;
    export let geometry: BufferGeometry;
    export let textureName: string;
    export let vertical: number;
    export let color: number;
    export let ceiling = false;

    const { map } = useDoomMap();
    const { textures, settings, editor } = useDoom();
    const { position: cameraPosition } = map.camera;
    const extraLight = map.player.extraLight;

    $: visible = (ceiling && $cameraPosition.z <= vertical)
            || (!ceiling && $cameraPosition.z >= vertical);
    const { light } = renderSector.sector;

    $: material = new MeshStandardMaterial({ color, emissive: 'magenta', side: ceiling ? BackSide : FrontSide });
    $: material.emissiveIntensity = ($editor.selected === renderSector.sector) ? 0.1 : 0;
    $: if (textureName && settings.useTextures) {
        material.map = textures.get(textureName, 'flat');
    }
    $: if ($light !== undefined) {
        material.color = textures.lightColor($light + $extraLight);
    }

    $: isSky = textureName === 'F_SKY1';
    $: if (isSky) {
        material.colorWrite = false;
        material.depthWrite = true;
    }

    function hit() {
        $editor.selected = renderSector.sector;
    }
</script>

<Mesh
    {visible}
    interactive={$editor.active}
    {geometry}
    {material}
    renderOrder={isSky ? 0 : 1}
    position={{ z: vertical }}
    on:click={hit}
>
    <Wireframe />
</Mesh>