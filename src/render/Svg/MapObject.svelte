<script lang="ts">
    import { Color } from "three";
    import { type MapObject, hittableThing, MapObjectIndex, ToDegrees } from "../../doom";

    export let mobj: MapObject;

    const { position, direction } = mobj;
    const radius = mobj.info.radius;
    const tRadius = radius * Math.sqrt(2) / 2;
    const doubleRadius = radius * 2;

    function thingColor(mobj: MapObject) {
        const c =
            mobj.type === MapObjectIndex.MT_PLAYER ? Color.NAMES.green :
            mobj.class === 'M' ? Color.NAMES.red :
            mobj.class === 'W' ? Color.NAMES.orange :
            mobj.class === 'A' ? Color.NAMES.yellow :
            mobj.class === 'I' ? Color.NAMES.blue :
            mobj.class === 'P' ? Color.NAMES.magenta :
            mobj.class === 'K' ? Color.NAMES.violet :
            mobj.class === 'O' ? Color.NAMES.gray :
            mobj.class === 'D' ? Color.NAMES.brown :
            mobj.class === 'S' ? Color.NAMES.indigo :
            Color.NAMES.white;
        return '#' + c.toString(16).padStart(6, '0');
    }

    let showSquare = (mobj.info.flags & hittableThing) !== 0;
    let showTriangle = mobj.class === 'S' || mobj.class === 'M' || mobj.type === MapObjectIndex.MT_PLAYER;
    let showCircle = showTriangle || mobj.class === 'I' || mobj.class === 'A' || mobj.class === 'P' || !mobj.description;

    $: thingOpacity = mobj.info.flags & hittableThing ? 1 : .3;
</script>

<g
    opacity={thingOpacity}
    fill='transparent'
    stroke={thingColor(mobj)}
>
    {#if showSquare}
        <rect
            x={$position.x - radius} y={$position.y - radius}
            width={doubleRadius} height={doubleRadius}
        />
    {/if}

    {#if showCircle}
        <circle cx={$position.x} cy={$position.y} r={radius} />
    {/if}

    {#if showTriangle}
        <polygon
            transform="
                rotate({$direction * ToDegrees - 90} {$position.x} {$position.y})
                translate({$position.x} {$position.y})
            "
            points="0 -{radius}, {tRadius} {tRadius}, -{tRadius} {tRadius}"/>
    {/if}

    <!-- <line
        x1={$position.x}
        y1={$position.y}
        y2={radius * Math.sin($direction) + $position.y}
        x2={radius * Math.cos($direction) + $position.x}
        fill={thingColor(mobj)}
        marker-end="url(#arrow)"
    /> -->

    <text
        x={$position.x - radius} y={-$position.y}
        stroke='none'
        fill={thingColor(mobj)}
    >{mobj.description ?? ''} {mobj.id}</text>
</g>

<style>
    text {
        font-size: small;
        width: 10em;
        transform: scaleY(-1);
    }
</style>