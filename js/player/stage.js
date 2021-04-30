import Actor from "./actor";
import Role from "./role";
import {mk} from "./util";

export default class Stage extends Role {
  generate_initial_state() {
    return {};
  }
}
Stage.register('stage');
Stage.STEP_KINDS = {
  pause: {
    display_name: "pause",
    hint: "pause and wait for a click",
    pause: true,
    args: [],
    check() {},
    apply() {},
  },
  bookmark: {
    display_name: "bookmark",
    hint: "mark this as a named point in the pause menu",
    args: [{
      display_name: "label",
      type: 'string',
    }],
    check() {},
    apply() {},
  },
  note: {
    display_name: "note",
    hint: "leave a note to yourself without affecting the script",
    args: [{
      display_name: "comment",
      type: 'string',
    }],
    check() {},
    apply() {},
  },
};

// TODO from legacy json, and target any actorless actions at us?

Stage.Actor = class StageActor extends Actor {
  constructor(role) {
    super(role, mk('div'));
  }
};