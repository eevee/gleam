import Role from "./role";
import Actor from "./actor";
import {mk} from "./util";
import {promise_transition} from "./promise-event";

/**
 * Stored format is defined as follows:
 * An 'animation' is:
 * - a single path
 * - a list of { path, duration }
 * And a pose is:
 * - an animation
 * - { type: 'static', path },
 * - { type: 'animated', frames: [{path, duration}] },
 * - { type: 'composite', order: [ layer names... ], layers: { optional?, variants: { name: animation } } }
 */
export default class PictureFrame extends Role {
    // TODO feels a bit weird to do this when 'anchor' and 'offset' are really, like, attributes of the position
    constructor(name, position = 'default', anchor = 'middle', offset = 0) {
        super(name);
        this.poses = {};
        this.position = position;
        this.anchor = anchor;
        this.offset = offset;
    }

    static from_legacy_json(name, json) {
        let pf = new this(name, json.position ?? 'default');
        for (let [key, value] of Object.entries(json.views)) {
            pf.poses[key] = this.inflate_pose(value);
        }
        return pf;
    }

    static from_json(json) {
        let pf = new this(json.name, json.position, json.anchor, json.offset);
        for (let [key, value] of Object.entries(json.poses)) {
            pf.poses[key] = this.inflate_pose(value);
        }
        return pf;
    }

    static inflate_pose(posedef) {
        if (typeof posedef === 'string' || posedef instanceof String) {
            // Single string: static pose
            return { type: 'static', path: posedef };
        }
        else if (posedef.type) {
            return posedef;
        }
        else {
            console.error("Don't know how to inflate pose definition", posedef);
        }
    }

    to_json() {
        let json = super.to_json();
        json.position = this.position;
        json.anchor = this.anchor;
        json.offset = this.offset;
        json.poses = {};
        for (let [name, pose] of Object.entries(this.poses)) {
            // Deflate the pose
            let posedef;
            if (pose.type === 'static') {
                posedef = pose.path;
            }
            else if (pose.type === 'composite') {
                // Can't really do any better
                posedef = pose;
            }
            else {
                console.error("Don't know how to deflate pose definition", pose);
                throw new Error;
            }
            json.poses[name] = posedef;
        }
        return json;
    }

    add_static_pose(name, path) {
        this.poses[name] = {
            type: 'static',
            path: path,
        };
    }

    generate_initial_state() {
        let composites = {};
        for (let [pose_name, pose] of Object.entries(this.poses)) {
            if (pose.type !== 'composite')
                continue;

            composites[pose_name] = {};
            for (let layername of pose.order) {
                composites[pose_name][layername] = false;  // TODO default
            }
        }

        return {
            // TODO this used to have a 'check' method as a twiddle, unclear if it does now (and
            // also that's really a step thing) but it wasn't called anywhere anyway!!
            pose: null,
            // Map of pose name => { layer name => visible variant, or false if none }
            composites,
        };
    }
    propagate_state(prev) {
        // Deep-copy the composites, since steps can deep-modify it
        let composites = {};
        for (let [pose_name, variants] of Object.entries(prev.composites)) {
            composites[pose_name] = {};
            for (let [layername, variant] of Object.entries(variants)) {
                composites[pose_name][layername] = variant;
            }
        }

        return {
            ...prev,
            composites,
        };
    }

    // -- Editor mutation --

    _rename_pose(old_pose_name, new_pose_name) {
        if (! (old_pose_name in this.poses))
            throw new Error(`No such pose '${new_pose_name}'`);
        if (new_pose_name in this.poses)
            throw new Error(`Pose '${new_pose_name}' already exists`);

        this.poses[new_pose_name] = this.poses[old_pose_name];
        delete this.poses[old_pose_name];
    }
}
PictureFrame.register('picture-frame');
// TODO ok so the thing here, is, that, uh, um
// - i need conversion from "legacy" json actions
// - i need to know what to show in the ui
// - if i save stuff as twiddle changes, i need to know how to convert those back to ui steps too, but maybe that's the same problem
PictureFrame.STEP_KINDS = {
    show: {
        display_name: "show",
        hint: "switch to another pose",
        args: [{
            display_name: 'pose',
            type: 'pose',
            // TODO am i using this stuff or what
            //type: 'key',
            type_key_prop: 'poses',
        }, {
            display_name: 'layers',
            type: 'pose_composite',
        }],
        check(role, pose_name, composites) {
            if (! role.poses[pose_name]) {
                return ["No such pose!"];
            }
        },
        apply(role, beat, state, pose_name, composites) {
            state.pose = pose_name;

            let pose = role.poses[pose_name];
            if (! pose) {
                console.warn("No such pose", pose, "for role", role);
                return;
            }
            if (pose.type === 'composite' && composites) {
                let variants = state.composites[pose_name];
                for (let layername of pose.order) {
                    if (composites[layername] !== undefined) {
                        variants[layername] = composites[layername];
                    }
                }
            }
        },
    },
    hide: {
        display_name: 'hide',
        hint: "hide",
        args: [],
        check() {},
        apply(role, beat, state) {
            state.pose = null;
        },
    },
}
PictureFrame.LEGACY_JSON_ACTIONS = {
    show: ["show", 'view'],
    hide: ["hide"],
};
PictureFrame.Actor = class PictureFrameActor extends Actor {
    /**
     * @param {Role} role
     * @param {Director} director
     */
    constructor(role, director) {
        super(role, mk('div.gleam-actor-pictureframe', {
            'data-name': role.name,
            'data-position': role.position,
        }));
        this.element.style.setProperty('--anchor', role.anchor);
        this.element.style.setProperty('--offset', role.offset);

        // Mapping of pose name to a dict of...
        //   element: top-level container for this pose
        // Composite only:
        //   visible_variants: map of layer name to which variant is visible
        //   layers: map of layer name to...
        //     element: container element
        //     variants: map of variant name to <img>
        //     visible: which variant is currently visible
        this.pose_status = {};
        for (let [pose_name, pose] of Object.entries(this.role.poses)) {
            let pose_status = this.pose_status[pose_name] = {
                element: null,
            };

            if (pose.type === 'static') {
                let image = director.library.load_image(pose.path);
                image.classList.add('-pose');
                // FIXME animation stuff $img.data 'delay', frame.delay or 0
                this.element.append(image);
                pose_status.element = image;
            }
            else if (pose.type === 'composite') {
                pose_status.layers = {};
                let container = pose_status.element = mk('div.-pose');
                this.element.append(container);
                for (let layername of pose.order) {
                    let layer_el = mk('div.gleam-actor-pictureframe-layer', {'data-layer': layername});
                    container.append(layer_el);

                    let layer = pose.layers[layername];
                    let layer_status = pose_status.layers[layername] = {
                        element: layer_el,
                        variants: {},
                        visible: false,
                    };

                    for (let [name, path] of Object.entries(layer.variants)) {
                        let image = director.library.load_image(path);
                        layer_el.append(image);
                        layer_status.variants[name] = image;
                    }
                }
            }
        }

        // FIXME why am i using event delegation here i Do Not get it
        //$element.on 'cutscene:change' + NS, @_change
        //$element.on 'cutscene:disable' + NS, @_disable

        // TODO i can't figure out how to make this work but i really want to be
        // able to "skip" a transition while holding down right arrow  >:(
        // [hint: this should probably be a general player function]
        /*
        $parent.on 'stage:next' + NS, (event) =>
            $x = $element.find('.--visible')
            #$x.css 'transition-property', 'none'
            $x.css 'transition-duration', '0s'
            $x.css 'opacity', '1.0'
            if $x[0]?
                $x[0].offsetHeight
            $x.css 'opacity', ''
            $x.css 'transition-duration', ''
            #$x.css 'transition-duration', '0s'
            #$element[0].style.transitionDuration = undefined
        */
    }

    // FIXME this isn't an Actor method, and it's unclear if this is even the
    // right thing or if i should just ditch the actor and create a new one, or
    // what.  maybe if this were how the constructor worked it'd be ok
    sync_with_role(director) {
        // FIXME not necessary to recreate now since images auto reload
        // themselves; just need to add/remove any images that changed
        // (including renaming layers and poses and stuff, ack...)
        return;

        for (let [pose_name, frames] of Object.entries(this.role.poses)) {
            if (this.pose_elements[pose_name]) {
                // FIXME hacky as hell
                director.library.load_image(frames.path, this.pose_elements[pose_name][0]);
                continue;
            }
            // FIXME ensure order...
            // FIXME augh, frames need to match too...
            // FIXME remove any that disappeared...
            // FIXME maybe i should just create a new actor
            let frame_elements = this.pose_elements[pose_name] = [];
            for (let frame of frames) {
                let image = director.library.load_image(frame.path);
                // FIXME animation stuff $img.data 'delay', frame.delay or 0
                this.element.appendChild(image);
                frame_elements.push(image);
            }
        }
    }

    //add_animation: (name, frames) ->
    //    @poses[name] = frames

    apply_state(state) {
        let old_state = super.apply_state(state);

        // Update the new pose's visible layers before showing it
        if (state.pose !== null) {
            let pose = this.role.poses[state.pose];
            if (! pose) {
                console.warn("No such pose", state.pose);
            }
            else if (pose.type === 'composite') {
                let pose_status = this.pose_status[state.pose];
                let new_variants = state.composites[state.pose];
                console.log("-- updating composite state --");
                for (let [i, layername] of pose.order.entries()) {
                    let layer = pose.layers[layername];
                    let layer_status = pose_status.layers[layername];
                    let old_variant = layer_status.visible;
                    let new_variant = new_variants[layername];
                    console.log(i, layername, old_variant, new_variant);
                    if (old_variant !== new_variant) {
                        if (old_variant !== false) {
                            layer_status.variants[old_variant].classList.remove('--visible');
                        }
                        if (new_variant !== false) {
                            layer_status.variants[new_variant].classList.add('--visible');
                        }
                        layer_status.visible = new_variant;
                    }
                }
            }
        }

        if (state.pose !== old_state.pose) {
            if (state.pose === null) {
                this.disable();
            }
            else {
                this.show(state.pose, old_state.pose);
            }
        }
    }

    // FIXME old_pose_name is a goober hack, but i wanted to get rid of this.active_pose_name and by the time we call this the current state has already been updated
    show(pose_name, old_pose_name) {
        let pose = this.role.poses[pose_name];
        if (! pose)
            // FIXME actors should have names
            throw new Error(`No such pose ${pose_name} for this picture frame`);

        this.element.classList.remove('-immediate')
        // TODO? $el.css marginLeft: "#{offset or 0}px"

        if (pose_name === old_pose_name)
            return;
        if (old_pose_name) {
            this.pose_status[old_pose_name].element.classList.remove('--visible');
        }

        let child = this.pose_status[pose_name].element;
        if (child.classList.contains('--visible'))
            return;

        child.classList.add('--visible');
        let promise = promise_transition(child);

        /* TODO animation stuff
        delay = $target_child.data 'delay'
        if delay
            setTimeout (=> @_advance $el, pose_name, 0), delay
        */

        return promise;
    }

    disable() {
        // The backdrop has a transition delay so there's no black flicker
        // during a transition (when both images are 50% opaque), but when
        // we're hiding the entire backdrop, we don't want that.  This class
        // disables it.
        // FIXME actually it doesn't since it's not defined, also should be --
        this.element.classList.add('-immediate');

        let promises = [];
        for (let child of this.element.childNodes) {
            if (! child.classList.contains('--visible'))
                continue;

            promises.push(promise_transition(child));
            child.classList.remove('--visible');
        }

        return Promise.all(promises);
    }

    /* FIXME animation stuff
    _advance: ($el, pose_name, current_index) =>
        $pose_elements = $el.data 'pose-elements'
        $current = $pose_elements[pose_name][current_index]
        next_index = (current_index + 1) % $pose_elements[pose_name].length
        $next = $pose_elements[pose_name][next_index]

        if not $current.hasClass '--visible'
            return

        $current.removeClass '--visible'
        $next.addClass '--visible'

        delay = $next.data 'delay'
        if delay
            setTimeout (=> @_advance $el, pose_name, next_index), delay
    */

    // -- Editor mutation --

    _rename_pose(old_pose_name, new_pose_name) {
        // No error checking; assuming the role did it
        if (this.state && this.state.pose === old_pose_name) {
            // XXX wait is mutating this bad, will it impact the step
            this.state.pose = new_pose_name;
        }

        this.pose_status[new_pose_name] = this.pose_status[old_pose_name];
        delete this.pose_status[old_pose_name];
    }
};
