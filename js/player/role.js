/**
 * The definition of an actor, independent of the actor itself.  Holds initial
 * configuration.
 */
export default class Role {
    /**
     * @param {string} name
     */
    constructor(name) {
        this.name = name;
    }

    /**
     * Call me after creating a Role subclass to make it loadable.
     * @param {string} type_name
     */
    static register(type_name) {
        this.type_name = type_name;
        Role._ROLE_TYPES[type_name] = this;
    }

    /**
     * @param {string} name
     * @param {{}} json
     * @returns {Role}
     */
    static from_legacy_json(name, json) {
        if (this.type_name !== json.type) {
            throw new Error(`Role class ${this.name} can't load a role of type '${json.type}'`);
        }
        return new this(name);
    }

    /**
     * @param {{}} json
     * @returns {Role}
     */
    static from_json(json) {
        return new this(json.name);
    }

    // Called after all roles are loaded, for restoring cross-references
    post_load(script) {}

    /**
     * @returns {{}}
     */
    to_json() {
        return {
            name: this.name,
            type: this.constructor.type_name,
        };
    }

    // Create an object representing the initial default state (and also documenting its keys),
    // which should put the role in a "blank" state
    generate_initial_state() {
        console.warn("Role did not define generate_initial_state:", this);
        return {};
    }

    // Given a previous beat's state, create a starting state for the next beat.  Note that this
    // will be mutated by the next beat's construction, so it should NEVER return its argument!
    // By default this returns a shallow copy.
    propagate_state(prev) {
        return {...prev};
    }

    // Create an Actor to play out this Role
    cast(director) {
        return new this.constructor.Actor(this, director);
    }
}
Role._ROLE_TYPES = {};
Role.Actor = null;
