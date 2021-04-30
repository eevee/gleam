import {mk} from "./util";
import DialogueBox from "./dialogue-box";
import Stage from "./stage";
import Curtain from "./curtain";
import Jukebox from "./jukebox";
import PictureFrame from "./picture-frame";
import Character from "./character";
import Step from "./step";
import Role from "./role";
import Beat from "./beat";

export default class Script {
    subtitle = null;
    // A Script describes the entirety of a play (VN).  It has some number of
    // Actors (dialogue boxes, picture frames, etc.), and is defined by some
    // number of Steps -- discrete commands which control those actors.  The
    // steps are compiled into a set of beats, which are the states of the
    // actors at a given moment in time.  A Beat is followed by a pause,
    // usually to wait for the audience to click or press a key, but
    // occasionally for a fixed amount of time or until some task is complete.

    constructor() {
        // Metadata
        this.title = null;
        this.author = null;
        this.created_date = Date.now();
        this.modified_date = Date.now();
        this.published_date = null;

        this.width = 800;
        this.height = 600;

        this.roles = [];
        this.role_index = {};

        // [beat index, label]
        this.bookmarks = [];

        this._set_steps([]);

        // This is an event target mostly used for editing, so that objects
        // wrapping us (e.g.  Director, Editor) can know when the step list
        // changes
        this.intercom = mk('i');
    }

    /**
     * @param {Role} role
     */
    _add_role(role) {
        // Internal only!
        this.roles.push(role);
        this.role_index[role.name] = role;
    }

    /**
     * @param {{}} json
     * @returns {Script}
     */
    static from_legacy_json(json) {
        let script = new this();
        script._load_legacy_json(json);
        return script;
    }

    /**
     * @param {{}} json
     * @returns {Script}
     */
    _load_legacy_json(json) {
        // Metadata
        this.title = json.title || null;
        this.subtitle = json.subtitle || null;
        // FIXME relying on Date to parse dates is ill-advised
        this.published_date = json.date ? new Date(json.date) : null;

        // Legacy JSON has an implicit dialogue box
        let dialogue_box = new DialogueBox('dialogue');
        this._add_role(dialogue_box);

        // And an implicit stage
        let stage = new Stage('stage');
        this._add_role(stage);

        // FIXME ???  how do i do... registration?  hmm
        let ROLE_TYPES = {
            curtain: Curtain,
            jukebox: Jukebox,
            spot: PictureFrame,
            character: Character,
        };

        for (let [name, role_def] of Object.entries(json.actors)) {
            let type = ROLE_TYPES[role_def.type];
            if (! type) {
                throw new Error(`No such role type: ${role_def.type}`);
            }

            let role = type.from_legacy_json(name, role_def);
            if (role_def.type === 'character') {
                // JSON characters implicitly use the implicit dialogue box
                // TODO i wonder if this could be in Character.from_legacy_json
                role.dialogue_box = dialogue_box;
            }

            this._add_role(role);
        }

        let steps = [];
        for (let json_step of json.script) {
            if (! json_step.actor) {
                // FIXME special actions like roll_credits
                if (json_step.action == 'pause') {
                    steps.push(new Step(stage, 'pause', []));
                }
                else {
                    console.warn("ah, not yet implemented:", json_step);
                }
                continue;
            }

            let role = this.role_index[json_step.actor];
            let role_type = role.constructor;
            let [step_key, ...arg_keys] = role_type.LEGACY_JSON_ACTIONS[json_step.action];
            steps.push(new Step(role, step_key, arg_keys.map(key => json_step[key])));
        }

        this._set_steps(steps);
        /*
        if actordef.type == "character"
            actor = Character.from_json speech, relative_to, actordef
        else if actordef.type == "spot"
            # TODO i don't really like this way of specifying the class.
            # probably because, um, why do char classes have "imagespot" in the
            # class and this doesn't
            # TODO i even hacked around this for the frame in the prompt augh
            actor = new ImageSpot "cutscene--#{actordef.position}"
            for name, args of actordef.views
                # TODO this sucks.
                if typeof args == "object" and Object.getPrototypeOf(args) == Array.prototype
                    actor.add_animation name, ( url: relative_to + arg.url, delay: arg.delay for arg in args )
                else
                    actor.add_view name, relative_to + args
        else if actordef.type == "jukebox"
            actor = new Boombox
            for name, args of actordef.tracks
                actor.add_song name, url: relative_to + args
        else if actordef.type == "curtain"
            actor = new Curtain
        */

        return this;
    }

    /**
     * @param {{}} json
     * @returns {Script}
     */
    static from_json(json) {
        let script = new this();
        // TODO check validity
        // TODO maybe catch immediate errors (like from Step constructor), continue, and aggregate them before failing

        // Metadata
        script.title = json.meta.title;
        script.subtitle = json.meta.subtitle;
        script.author = json.meta.author;
        script.width = json.meta.width || script.width;
        script.height = json.meta.height || script.height;
        // FIXME published vs modified
        script.created_date = json.meta.created ? new Date(json.meta.created) : Date.now();
        script.modified_date = json.meta.modified ? new Date(json.meta.modified) : Date.now();
        script.published_date = json.meta.published ? new Date(json.meta.published) : null;

        for (let role_def of json.roles) {
            let type = Role._ROLE_TYPES[role_def.type];
            if (! type) {
                throw new Error(`No such role type: ${role_def.type}`);
            }

            script._add_role(type.from_json(role_def));
        }
        for (let role of script.roles) {
            role.post_load(script);
        }

        let steps = [];
        for (let json_step of json.steps) {
            let [role_name, kind_name, ...args] = json_step;
            let role = script.role_index[role_name];
            steps.push(new Step(role, kind_name, args));
        }

        script._set_steps(steps);

        return script;
    }

    // Return a JSON-compatible object representing this Script.
    // Obviously this is only used by the editor, but it's not much code and it
    // makes sense to keep it here next to the code for loading from JSON.
    to_json() {
        let json = {
            meta: {
                //asset_root?
                //name?
                title: this.title || null,
                subtitle: this.subtitle || null,
                author: this.author || null,
                created: this.created,
                modified: Date.now(),  // TODO actually set this correctly
                published: this.published,
                gleam_version: VERSION,
                //preview?
                //credits????
                width: this.width,
                height: this.height,
            },
            roles: [],
            steps: [],
        };

        for (let role of this.roles) {
            json.roles.push(role.to_json());
        }

        for (let step of this.steps) {
            json.steps.push([step.role.name, step.kind_name, ...step.args]);
        }

        return json;
    }

    _set_steps(steps) {
        this.steps = steps;
        this._refresh_beats(0);
    }

    /**
     * Recreate beats, starting from the given step.  Called both when initializing the script and
     * when making step edits in the editor.
     * @param {number} initial_step_index
     */
    _refresh_beats(initial_step_index) {
        if (this.steps.length === 0) {
            this.beats = [];
            this.bookmarks = [];
            return;
        }

        let first_beat_index;
        if (! this.beats || initial_step_index <= 1) {
            first_beat_index = 0;
        }
        else {
            first_beat_index = this.steps[initial_step_index - 1].beat_index;
        }
        console.log("rebeating from", initial_step_index, first_beat_index);

        // Consolidate steps into beats -- maps of role => state
        let beat;
        if (first_beat_index === 0) {
            beat = Beat.create_first(this.roles);
            this.beats = [beat];
            this.bookmarks = [];
        }
        else {
            this.beats.length = first_beat_index;
            beat = this.beats[first_beat_index - 1].create_next();
            this.beats.push(beat);
            // TODO could partial-reconstruct this and start the loop below at a later point!
            this.bookmarks = [];
        }

        // Iterate through steps and fold them into beats
        let beat_index = 0;
        for (let [i, step] of this.steps.entries()) {
            step.index = i;
            step.beat_index = beat_index;

            // Make note of labels and bookmarks
            // TODO seems hacky, is this the right way to identify the stage
            if (step.role instanceof Stage && step.kind_name === 'bookmark') {
                this.bookmarks.push([beat_index, step.args[0]]);
            }

            // Construct the beat
            if (beat_index >= first_beat_index) {
                step.update_beat(beat);
                beat.last_step_index = i;

                // If this step pauses, the next step goes in a new beat
                if (step.kind.pause) {
                    beat.pause = step.kind.pause;

                    // If this is the last step, there is no next beat
                    if (i === this.steps.length - 1)
                        break;

                    beat = beat.create_next();
                    this.beats.push(beat);
                    beat_index++;
                }
            }
            else {
                // Not yet at the update point, so do a softer version of the above
                if (step.kind.pause) {
                    beat_index++;
                }
            }
        }
    }

    /**
     * @param {Step} step
     */
    _assert_own_step(step) {
        if (this.steps[step.index] !== step) {
            console.error(step);
            throw new Error("Step is not a part of this Script");
        }
    }

    /**
     * @param {Step} step
     * @return {Beat}
     */
    get_beat_for_step(step) {
        this._assert_own_step(step);
        return this.beats[step.beat_index];
    }
}
