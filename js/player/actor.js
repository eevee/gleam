export default class Actor {
    /**
     * @param role {Role}
     * @param element {HTMLElement}
     */
    constructor(role, element) {
        this.role = role;
        this.state = role.generate_initial_state();

        this.element = element;
    }

    update(dt) {}

    // Return false to interrupt the advance
    advance() {}

    // Update this Actor to the given state, which is a mapping of twiddle
    // names to values, and return the old state.  The default implementation
    // just assigns `this.state` to the given value, which means you can start
    // out overloads with:
    //   let old_state = super.apply_state(state);
    // and then compare new and old states.
    apply_state(state) {
        let old_state = this.state;
        this.state = state;
        return old_state;
    }

    // TODO figure this out.
    /**
     * @param {Director} director
     */
    sync_with_role(director) {}

    // TODO? kind of a state issue here: what happens if you apply_state while paused?  that can happen in the editor, and also when jumping around from the pause screen, though it seems to incidentally work out alright, and anyway only jukebox is affected
    pause() {}

    unpause() {}
}
// Must also be defined on subclasses:
Actor.STEP_KINDS = null;
Actor.LEGACY_JSON_ACTIONS = null;
