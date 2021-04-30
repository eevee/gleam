export default class Beat {
  /**
   * @param {number} first_step_index
   */
  constructor(states, first_step_index) {
    // The interesting bit!  Map of Role to a twiddle state
    this.states = states;

    // Pause type for this beat, which should be updated by the caller
    this.pause = false;

    // This metadata is only really used for editing the steps live
    this.first_step_index = first_step_index;
    this.last_step_index = first_step_index;
  }

  // Produce the first Beat in a Script, based on its Roles
  static create_first(roles) {
    let states = new Map();
    for (let role of roles) {
      states.set(role, role.generate_initial_state());
    }
    return new this(states, 0);
  }

  /**
   * Create the next beat, as a duplicate of this one
   * @returns {Beat}
   */
  create_next() {
    // Eagerly-clone, in case of propagation
    // TODO what if...  we did not eagerly clone?
    let states = new Map();
    for (let [role, prev_state] of this.states) {
      states.set(role, role.propagate_state(prev_state));
    }

    return new Beat(states, this.last_step_index + 1);
  }

  set(role, state) {
    this.states.set(role, state);
  }

  get(role) {
    return this.states.get(role);
  }

  set_twiddle(role, key, value) {
    this.states.get(role)[key] = value;
  }
}