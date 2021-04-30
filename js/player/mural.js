import Role from "./role";
import Actor from "./actor";
import {mk} from "./util";

// FIXME this is very hardcodey but should be in backstage
// FIXME also less generic, more templated, subclasses or something idk, make it safe
// FIXME make roll_credits on old things work
// FIXME "powered by GLEAM"!  i guess.  but that only makes sense for credits, maybe a mural is useful for something else too
/**
 * Full-screen arbitrary markup
 */
export default class Mural extends Role {
    /**
     * @param {string} name
     */
    constructor(name, markup) {
        super(name);
        markup = `
            <dl class="gleam-mural-credits">
                <dt><a href="https://glitchedpuppet.com/">glitchedpuppet</a></dt>
                <dd>art, music, script</dd>
                <dt><a href="https://eev.ee/">Eevee</a></dt>
                <dd>programming</dd>
            </dl>
            <p><a href="https://floraverse.com/">Floraverse</a></p>
            <p><a href="https://floraverse.bandcamp.com/">Bandcamp</a></p>
            <p>🙚 <em>fin</em> 🙘</p>
        `;
        this.markup = markup;
    }

    static from_json(json) {
        let mural = super.from_json(json);
        // FIXME this is extremely bad actually
        mural.markup = json.markup;
        return mural;
    }

    to_json() {
        let json = super.to_json();
        json.markup = this.markup;
        return json;
    }

    generate_initial_state() {
        return {
            visible: false,
        };
    }
    propagate_state(prev) {
        return {
            ...prev,
            visible: false,
        };
    }
}
Mural.register('mural');
Mural.STEP_KINDS = {
    show: {
        display_name: 'show',
        pause: true,
        args: [],
        check() {},
        apply(role, beat, state) {
            state.visible = true;
        },
    },
};
Mural.LEGACY_JSON_ACTIONS = {
    show: ["show"],
};

Mural.Actor = class MuralActor extends Actor {
    /**
     * @param {Role} role
     */
    constructor(role) {
        super(role, mk('div.gleam-actor-mural'));

        this.element.innerHTML = role.markup;
    }

    apply_state(state) {
        let old_state = super.apply_state(state);
        this.element.classList.toggle('--visible', state.visible);
    }
};
