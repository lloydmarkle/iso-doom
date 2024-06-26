<script lang="ts">
    import { DoomWad, Game, MapRuntime, type Skill, WadFile } from './doom';
    import Doom from './render/Doom.svelte';
    import AABBSweepDebug from './render/Debug/AABBSweepDebug.svelte';
    import AppInfo from './render/Components/AppInfo.svelte';
    import { createAppContext } from './render/DoomContext';
    import { setContext } from 'svelte';
    import WadScreen from './WadScreen.svelte';
    import { WadStore } from './WadStore';
    import WipeContainer from './render/Components/WipeContainer.svelte';
    import { fly } from 'svelte/transition';

    const wadStore = new WadStore();
    const context = createAppContext();
    setContext('doom-app-context', context);

    const { audio } = context;
    function enableSoundOnce() {
        audio.resume();
    }
    const { musicVolume, soundVolume, muted, mainVolume } = context.settings;

    const mainGain = audio.createGain();
    mainGain.connect(audio.destination);
    $: mainGain.gain.value = $muted ? 0 : $mainVolume;

    const soundGain = audio.createGain();
    soundGain.connect(mainGain);
    $: soundGain.gain.value = $soundVolume * .1;

    const musicGain = audio.createGain();
    musicGain.connect(mainGain);
    $: musicGain.gain.value = $musicVolume;

    let wad: DoomWad;
    let game: Game;
    let difficulty: Skill = null;
    let urlMapName: string;

    // TODO: this function probably needs more validation (like upper/lower case, bounds checks, etc)
    async function parseUrlParams() {
        const params = new URLSearchParams(window.location.hash.substring(1));

        const wadNames = params.getAll('wad');
        const urlWads = wadNames.map(wad => `wad=${wad}`).join('&');
        if (urlWads !== wad?.name) {
            if (urlWads) {
                const wadResolvers = wadNames.map(name => wadStore.fetchWad(name).then(buff => new WadFile(name, buff)));
                const wads = await Promise.all(wadResolvers);
                wad = new DoomWad(urlWads, wads);
            } else {
                wad = null;
            }
        }

        const urlSkill = parseInt(params.get('skill'));
        const clippedSkill = Math.min(5, Math.max(1, isFinite(urlSkill) ? urlSkill : difficulty)) as Skill;
        const validUrlSkill = isFinite(urlSkill) && urlSkill === clippedSkill;
        if ((game && urlSkill !== game.skill) || (!game && validUrlSkill)) {
            difficulty = clippedSkill;
            game = null;
        }

        urlMapName = params.get('map');
        if (urlMapName && validUrlSkill && (!game || game.map.val?.name !== urlMapName)) {
            game = new Game(wad, difficulty, context.settings);
            game.startMap(new MapRuntime(urlMapName, game));
        }
    }
    parseUrlParams();

    // keep url in sync with game
    $: map = game?.map;
    $: if ($map && urlMapName !== $map.name) {
        history.pushState(null, null, `#${game.wad.name}&skill=${game.skill}&map=${$map.name}`);
    }

    $: screenName = game ? 'game' : 'start';
</script>

<svelte:window on:popstate={parseUrlParams} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<main
    on:click|once={enableSoundOnce}
    use:context.pointerLock.pointerLockControls
    use:context.fullscreen.fullscreenControls
>
    <!-- <AABBSweepDebug /> -->

    <WipeContainer key={screenName}>
        {#if game}
            {#key game}
                <Doom {game} {musicGain} {soundGain} />
            {/key}
        {:else}
            <WadScreen {wad} {wadStore} />
            <AppInfo />
        {/if}
    </WipeContainer>
</main>

<style>
    :root {
        --line-width: 12px;
        --honeycomb-size: 40px;
        background: var(--honeycomb-gradient);
        background-size: var(--honeycomb-size-x) var(--honeycomb-size-y);
        width: 100vw;
        height: 100vh;
    }

    /*
        safari hack to make sure we can scroll to hide the address bar...
        See also the note in Doom.svelte
    */
    @supports (-webkit-touch-callout: none) {
        @media only screen and (orientation: landscape) {
            main {
                padding-top: 60px;
            }
        }
    }
</style>