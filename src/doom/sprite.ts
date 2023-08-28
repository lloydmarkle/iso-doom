import { ActionIndex, SpriteNames, StateIndex, states, type State } from "./doom-things-info";
import { randInt } from "./math";
import { store } from "./store";

const FF_FULLBRIGHT = 0x8000;
const FF_FRAMEMASK = 0x7fff;

export interface Sprite {
    name: string;
    frame: number;
    fullbright: boolean;
}

export class SpriteStateMachine {
    private ticks: number;
    private stateIndex: StateIndex;
    private state: State;
    readonly sprite = store<Sprite>(null);
    get index() { return this.stateIndex; }

    constructor(
        private stateAction: (action: ActionIndex) => void,
        // TODO: it would be nice not to need an action where state is null but we have at least two behaviours and I'm
        // not sure how to unify them
        private onNull: (self: SpriteStateMachine) => void,
    ) {}

    tick() {
        if (!this.state || this.ticks < 0) {
            return;
        }
        this.ticks -= 1;
        if (this.ticks === 0) {
            this.setState(this.state.nextState);
        }
    }

    setState(stateIndex: StateIndex) {
        const lastState = this.state;
        do {
            this.stateIndex = stateIndex;
            if (stateIndex === StateIndex.S_NULL) {
                this.onNull(this);
                return;
            }

            this.state = states[stateIndex];
            this.ticks = this.state.tics;
            this.stateAction(this.state.action);
            stateIndex = this.state.nextState;
        } while (!this.ticks)

        if (this.state === lastState) {
            // don't change sprite if the state hasn't changed
            return;
        }
        const name = SpriteNames[this.state.sprite];
        const frame = this.state.frame & FF_FRAMEMASK;
        const fullbright = (this.state.frame & FF_FULLBRIGHT) !== 0;
        this.sprite.set({ name, frame, fullbright });
    }

    randomizeTicks() {
        if (this.ticks > 0) {
            this.ticks = randInt(1, this.ticks);
        }
    }
}