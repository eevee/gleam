/**
 * Roles are choreographed by Steps, which are then applied to Actors
 */
export default class Step {
    /**
     * @param {Role} role
     */
    constructor(role, kind_name, args) {
        this.role = role;
        this.kind_name = kind_name;
        this.args = args;

        this.kind = role.constructor.STEP_KINDS[kind_name];
        if (! this.kind) {
            throw new Error(`No such step '${kind_name}' for role '${role}'`);
        }

        // Populated when the Step is added to a Script
        this.index = null;
        this.beat_index = null;
    }

    /**
     * @param {Beat} beat
     */
    update_beat(beat) {
        this.kind.apply(this.role, beat, beat.get(this.role), ...this.args);
    }
}
