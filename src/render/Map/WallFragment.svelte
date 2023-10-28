<script lang="ts" context="module">
    // all walls are planes so may as well use the same geometry
    const geometry = new PlaneGeometry();
</script>
<script lang="ts">
    import { MeshStandardMaterial, PlaneGeometry, Color } from "three";
    import { Mesh } from "@threlte/core";
    import { HALF_PI, type LineDef, type SideDef, type Vertex } from "../../doom";
    import Wireframe from "../Debug/Wireframe.svelte";
    import { useAppContext, useDoom, useDoomMap } from "../DoomContext";

    export let linedef: LineDef;
    export let useLeft = false;
    export let type: 'upper' | 'lower' | 'middle' = 'middle';

    // geometry
    export let skyHack = false;
    export let visible: boolean;
    export let angle: number;
    export let width: number;
    export let height: number;
    export let top: number;
    export let mid: Vertex;
    export let doubleSidedMiddle = false;

    const sidedef = useLeft ? linedef.left : linedef.right;
    // In MAP29 in Doom2, the teleports in the blood only have right texture but seg.direction 1 so we get nothing.
    // https://doomwiki.org/wiki/MAP29:_The_Living_End_(Doom_II)#Bugs
    // There may be other places this happens but we correct it by doing a little hack
    // Actually gzdoom has lots of little corrections https://github.com/ZDoom/gzdoom/blob/master/wadsrc/static/zscript/level_compatibility.zs
    $: textureL = linedef.left?.[type];
    $: textureR = linedef.right[type];
    $: texture = useLeft ? ($textureL ?? $textureR) : ($textureR ?? $textureL);

    const { yOffset, xOffset } = sidedef;
    const { xOffset: animOffset, flags } = linedef;

    const { settings, editor } = useAppContext();
    const { wad, textures } = useDoom();
    const { map } = useDoomMap();

    const extraLight = map.player.extraLight;
    const { light } = sidedef.sector;
    const { zFloor : zFloorL } = linedef.left?.sector ?? {};
    const { zFloor : zFloorR, zCeil : zCeilR, skyHeight } = linedef.right.sector

    // TODO: We could actually use MeshBasic here (and in Thing and Flat) because we don't have any dynamic lighting
    // and we get a ~25% performance boost. I'd rather keep this and use the BSP to cull walls
    $: material = new MeshStandardMaterial({ color: lineStroke() });
    $: texture2 = texture && settings.useTextures ? textures.get(texture, 'wall').clone() : null;
    $: if (texture2) {
        if (doubleSidedMiddle) {
            // double sided linedefs (generally for semi-transparent textures) do not repeat vertically
            height = Math.min(height, texture2.userData.height);
        }
        texture2.repeat.x = width * texture2.userData.invWidth;
        texture2.repeat.y = height * texture2.userData.invHeight;
        material.map = texture2;
    }
    $: if (texture2 && (flags || $xOffset || $yOffset || ($animOffset ?? 0))) {
        // texture alignment is complex https://doomwiki.org/wiki/Texture_alignment
        // threejs uses 0,0 in bottom left but doom uses 0,0 for top left so we by default
        // "peg" the corner to the top left by offsetting by height
        let pegging = -height;
        if (flags & 0x0004) {
            // two-sided segs with a middle texture need alpha test
            if (type === 'middle') {
                material.alphaTest = 1;
            }

            if (type === 'lower' && (flags & 0x0010)) {
                // unpegged so subtract higher floor from ceiling to get real offset
                // NOTE: we use skyheight (if available) instead of zCeil because of the blue wall switch in E3M6.
                pegging -= (skyHeight ?? $zCeilR) - Math.max($zFloorL, $zFloorR);
            } else if (type === 'upper' && !(flags & 0x0008)) {
                pegging = 0;
            } else if (type === 'middle') {
                if (doubleSidedMiddle && (flags & 0x0010)) {
                    // see cages in plutonia MAP24
                    top = Math.max($zFloorL, $zFloorR) + texture2.userData.height;
                }
                pegging = 0;
            }
        } else if (flags & 0x0010) {
            // peg to floor (bottom left)
            pegging = 0;
        }
        material.map.offset.x = (($animOffset ?? 0) + $xOffset) * texture2.userData.invWidth;
        material.map.offset.y = (-$yOffset + pegging) * texture2.userData.invHeight;
    }
    $: if ($light !== undefined) {
        material.color = textures.lightColor($light + $extraLight);
    }

    $: if ($editor.selected === linedef) {
        material.emissive = new Color('magenta');
        material.emissiveIntensity = 0.1;
    } else {
        material.emissiveIntensity = 0;
    }

    $: if (skyHack) {
        material.colorWrite = false;
        material.depthWrite = true;
    }

    function lineStroke() {
        return !linedef.left ? wad.palettes[0][176] :
            (linedef.left.sector.zFloor !== linedef.right.sector.zFloor) ? wad.palettes[0][64] :
            (linedef.left.sector.zCeil !== linedef.right.sector.zCeil) ?  wad.palettes[0][231] :
            wad.palettes[0][96];
    }

    function hit() {
        $editor.selected = linedef;
    }
</script>

<Mesh
    interactive={$editor.active}
    on:click={hit}
    visible={visible}
    renderOrder={skyHack ? 0 : 1}
    position={{ x: mid.x, y: mid.y, z: top - height * .5 }}
    rotation={{ z: angle, x: HALF_PI, order:'ZXY' }}
    scale={{ x: width, y: height }}
    {geometry}
    material={material}
>
    <Wireframe />
</Mesh>