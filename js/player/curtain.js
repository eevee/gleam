import Actor from "./actor";
import Role from "./role";
import {mk} from "./util";
import {promise_transition} from "./promise-event";

/**
 * Full-screen transition actor
 */
export default class Curtain extends Role {
    generate_initial_state() {
        return {
            // Whether the curtain is currently visible.  Only lasts one beat.
            lowered: false,
        };
    }
    propagate_state(prev) {
        return {
            ...prev,
            lowered: false,
        };
    }
}
Curtain.register('curtain');
Curtain.STEP_KINDS = {
    lower: {
        display_name: 'lower',
        pause: 'wait',
        // TODO this is very...  heuristic, and there's no way to override it, hm.
        is_major_transition: true,
        args: [],
        check() {},
        apply(role, beat, state) {
            state.lowered = true;
        },
    },
};
Curtain.LEGACY_JSON_ACTIONS = {
    lower: ["lower"],
};

Curtain.Actor = class CurtainActor extends Actor {
    constructor(role) {
        // TODO color?

        super(role, mk('div.gleam-actor-curtain'));
    }

    apply_state(state) {
        let old_state = super.apply_state(state);
        this.element.classList.toggle('--lowered', state.lowered);

        if (old_state.lowered !== state.lowered) {
            return promise_transition(this.element);
        }
    }
};
