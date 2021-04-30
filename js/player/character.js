import PictureFrame from "./picture-frame";

// FIXME do not love this hierarchy, the picture frame should very be its own thing
export default class Character extends PictureFrame {
    constructor(...args) {
        super(...args);

        // Character delegates to a dialogue box, which must be assigned here, ASAP
        // TODO need editor ui for this!
        this.dialogue_box = null;
    }

    static from_legacy_json(name, json) {
        json.views = json.poses || {};
        let role = super.from_legacy_json(name, json);
        role.dialogue_name = json.name || null;
        role.dialogue_color = json.color || null;
        // FIXME what IS this, it's really the box style to use...
        role.dialogue_position = json.position || null;
        return role;
    }

    static from_json(json) {
        let character = super.from_json(json);
        character._dialogue_box_name = json.dialogue_box;
        character.dialogue_name = json.dialogue_name;
        character.dialogue_color = json.dialogue_color;
        return character;
    }

    post_load(script) {
        super.post_load(script);
        this.dialogue_box = script.role_index[this._dialogue_box_name];
    }

    to_json() {
        let json = super.to_json();
        json.dialogue_box = this.dialogue_box.name;
        json.dialogue_name = this.dialogue_name;
        json.dialogue_color = this.dialogue_color;
        return json;
    }

    // FIXME i think i should also be saving the dialogue box name?  and, dialogue name/color/etc which don't even appear in the constructor
}
Character.register('character');
Character.STEP_KINDS = {
    pose: PictureFrame.STEP_KINDS.show,
    leave: PictureFrame.STEP_KINDS.hide,
    say: {
        display_name: 'say',
        pause: true,
        args: [{
            display_name: 'phrase',
            type: 'prose',
            nullable: false,
        }],
        check() {
            // TODO check it's a string?  check for dialogue box?
        },
        apply(role, beat, state, phrase) {
            let dbox = role.dialogue_box;
            if (! dbox) {
                console.warn("No dialogue box configured");
                return;
            }

            let dstate = beat.get(dbox);
            dstate.color = role.dialogue_color;
            dstate.speaker = role.dialogue_name;
            dstate.position = role.dialogue_position;
            dstate.phrase = phrase;
        },
    },
};
Character.LEGACY_JSON_ACTIONS = {
    say: ["say", 'text'],
    pose: ["pose", 'view'],
    leave: ["leave"],
};
// TODO? Character.Actor = ...
