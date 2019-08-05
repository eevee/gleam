// Very high level:
// This isn't really a visual novel engine.  It's just an HTML state engine.
// Each step is a set of states of various components (e.g., "the dialogue box
// is showing this text" or "this background is visible"), and all the engine
// actually does is adjust the states as appropriate.  Even the transitions are
// all CSS.

// Browser features used include:
// Element.closest
// Node.remove

window.Gleam = (function() {
"use strict";


function svg_icon_from_path(d) {
    return `<svg width="1em" height="1em" viewBox="0 0 16 16"><path d="${d}" stroke-width="2" stroke-linecap="round" stroke="white" fill="none"></svg>`;
}

// -----------------------------------------------------------------------------
// Promise/event helpers

// Return a Promise that will resolve when the named event (or space-separated
// list of event names) fires.
// Optionally, the Promise will be rejected when the named failure event fires.
// Either way, the value will be the fired event.
function promise_event(element, success_event, failure_event) {
    let resolve, reject;
    let promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });

    let success_handler = e => {
        element.removeEventListener(success_event, success_handler);
        if (failure_event) {
            element.removeEventListener(failure_event, failure_handler);
        }

        resolve(e);
    };
    let failure_handler = e => {
        element.removeEventListener(success_event, success_handler);
        if (failure_event) {
            element.removeEventListener(failure_event, failure_handler);
        }

        reject(e);
    };

    element.addEventListener(success_event, success_handler);
    if (failure_event) {
        element.addEventListener(failure_event, failure_handler);
    }

    return promise;
}

function promise_transition(el) {
    let props = window.getComputedStyle(el);
    // TODO this is nice, but also doesn't check that anything is actually
    // transitioning at the moment
    if (props.transitionProperty !== 'none' && props.transitionDuration !== '0s') {
        return promise_event(el, 'transitionend');
    }
    else {
        return Promise.resolve();
    }
}

// -----------------------------------------------------------------------------
// Roles and Actors

// The definition of an actor, independent of the actor itself.  Holds initial
// configuration.
class Role {
    constructor(name) {
        this.name = name;
    }

    static from_legacy_json(name, json) {
        return new this(name);
    }

    generate_initial_state() {
        let state = {};
        for (let [key, twiddle] of Object.entries(this.TWIDDLES)) {
            state[key] = twiddle.initial;
        }
        return state;
    }

    // Create an Actor to play out this Role
    cast(director) {
        return new this.constructor.Actor(this, director);
    }
}
Role.prototype.TWIDDLES = {};
Role.Actor = null;


class Actor {
    constructor(role) {
        this.role = role;
        this.state = role.generate_initial_state();

        this.element = null;
    }

    make_initial_state() {
        let state = {};
        for (let [key, twiddle] of Object.entries(this.TWIDDLES)) {
            state[key] = twiddle.initial;
        }
        return state;
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
}
Actor.prototype.TWIDDLES = {};
// Must also be defined on subclasses:
Actor.STEP_TYPES = null;
Actor.LEGACY_JSON_ACTIONS = null;


// Roles are choreographed by Steps, which are then applied to Actors
class Step {
    constructor(role, type, args) {
        this.role = role;
        this.type = type;
        this.args = args;

        // Populated when the Step is added to a Script
        this.index = null;
        this.beat_index = null;
    }

    update_beat(beat) {
        for (let twiddle_change of this.type.twiddles) {
            let role = this.role;
            if (twiddle_change.delegate) {
                role = role[twiddle_change.delegate];
            }

            let value = twiddle_change.value;
            if (twiddle_change.arg !== undefined) {
                value = this.args[twiddle_change.arg];
            }
            else if (twiddle_change.prop !== undefined) {
                value = this.role[twiddle_change.prop];
            }

            beat.set_twiddle(role, twiddle_change.key, value);
        }
    }

    *get_affected_twiddles() {
        for (let twiddle_change of this.type.twiddles) {
            let role = this.role;
            if (twiddle_change.delegate) {
                role = role[twiddle_change.delegate];
            }

            yield [role, twiddle_change.key];
        }
    }
}


class Stage extends Role {
}
Stage.prototype.TWIDDLES = {};
Stage.STEP_TYPES = {
    pause: {
        display_name: "pause",
        pause: true,
        args: [],
        twiddles: [],
    },
};
// TODO from legacy json, and target any actorless actions at us?

Stage.Actor = class StageActor extends Actor {
};


// Full-screen transition actor
class Curtain extends Role {
}
Curtain.prototype.TWIDDLES = {
    lowered: {
        initial: false,
        type: Boolean,
        propagate: false,
    },
};
Curtain.STEP_TYPES = {
    lower: {
        display_name: 'lower',
        pause: 'wait',
        // TODO this is very...  heuristic, and there's no way to override it, hm.
        is_major_transition: true,
        args: [],
        twiddles: [{
            key: 'lowered',
            value: true,
        }],
    },
};
Curtain.LEGACY_JSON_ACTIONS = {
    lower: ["lower"],
};

Curtain.Actor = class CurtainActor extends Actor {
    constructor(role) {
        super(role);
        // TODO color?

        this.element = make_element('div', 'gleam-actor-curtain');
    }

    apply_state(state) {
        let old_state = super.apply_state(state);
        this.element.classList.toggle('--lowered', state.lowered);

        if (old_state.lowered !== state.lowered) {
            return promise_transition(this.element);
        }
    }
};


class Jukebox extends Role {
}
Jukebox.prototype.TWIDDLES = {
    track: {
        initial: null,
        // XXX type?  index into Jukebox.tracks
    },
};
Jukebox.STEP_TYPES = {
    play: {
        display_name: "play",
        args: [{
            display_name: "track",
            type: 'key',
            type_key_prop: 'tracks',
        }],
        twiddles: [{
            key: 'track',
            arg: 0,
        }],
    },
    stop: {
        display_name: "stop",
        args: [],
        twiddles: [{
            key: 'track',
            value: null,
        }],
    },
};
Jukebox.LEGACY_JSON_ACTIONS = {
    play: ["play", 'track'],
    stop: ["stop"],
};
Jukebox.Actor = class JukeboxActor extends Actor {
    play(track_name) {
        // TODO
    }
};


class PictureFrame extends Role {
    constructor(name, position) {
        super(name);
        this.poses = {};
    }

    static from_legacy_json(name, json) {
        let pf = new this(name, json.position);
        for (let [key, value] of Object.entries(json.views)) {
            pf.add_pose(key, value);
        }
        return pf;
    }

    // TODO don't really love "view" as the name for this
    add_pose(name, tmp_image_url) {
        this.poses[name] = [{ url: tmp_image_url }];
    }
}
PictureFrame.prototype.TWIDDLES = {
    pose: {
        initial: null,
        // XXX type?  index into PictureFrame.poses
        check(actor, value) {
            if (value !== null && actor.poses[value] === undefined) {
                return `No such pose: ${value}`;
            }
        }
    },
};
// TODO ok so the thing here, is, that, uh, um
// - i need conversion from "legacy" json actions
// - i need to know what to show in the ui
// - if i save stuff as twiddle changes, i need to know how to convert those back to ui steps too, but maybe that's the same problem
PictureFrame.STEP_TYPES = {
    show: {
        display_name: 'show',
        args: [{
            display_name: 'pose',
            type: 'pose',
            // TODO am i using this stuff or what
            //type: 'key',
            type_key_prop: 'poses',
        }],
        twiddles: [{
            key: 'pose',
            arg: 0,
        }],
    },
    hide: {
        display_name: 'hide',
        args: [],
        twiddles: [{
            key: 'pose',
            value: null,
        }],
    },
}
PictureFrame.LEGACY_JSON_ACTIONS = {
    show: ["show", 'view'],
    hide: ["hide"],
};
PictureFrame.Actor = class PictureFrameActor extends Actor {
    constructor(role, director) {
        super(role);

        let element = make_element('div', 'gleam-actor-pictureframe');
        // FIXME add position class
        this.element = element;

        let pose_elements = {};
        let img_promises = [];
        for (let [pose_name, frames] of Object.entries(this.role.poses)) {
            let frame_elements = pose_elements[pose_name] = [];
            for (let frame of frames) {
                let image = director.library.load_image(frame.url);
                image.setAttribute('data-pose-name', pose_name);
                // FIXME animation stuff $img.data 'delay', frame.delay or 0
                element.appendChild(image);
                // FIXME this modifies the role!!!!
                frame.element = image;
                // FIXME when animated
                frames.element = image;
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

        // TODO uhh how does progress work with image tags?  how does it work at
        // all?  i think i'd have to use ajax here and rely on the cache or
        // whatever ungh
        //return Promise.all(img_promises);
    }

    //add_animation: (name, frames) ->
    //    @poses[name] = frames

    apply_state(state) {
        let old_state = super.apply_state(state);

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
            // FIXME do every frame's element i guess
            this.role.poses[old_pose_name].element.classList.remove('--visible');
        }

        let child = pose.element;
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
};


// FIXME do not love this hierarchy, the picture frame should very be its own thing
class Character extends PictureFrame {
    constructor(name, position) {
        super(name, position);

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
}
// XXX aha, this could be a problem.  a character is a delegate; it doesn't have any actual twiddles of its own!
// in the old code (by which i mean, round two), the character even OWNS the pictureframe...
// so "Character:say" is really two twiddle updates on the dialogue box: the phrase AND the speaker whose style to use.  hrm.
//Character.prototype.TWIDDLES = {};
Character.STEP_TYPES = {
    pose: PictureFrame.STEP_TYPES.show,
    leave: PictureFrame.STEP_TYPES.hide,
    say: {
        display_name: 'say',
        pause: true,
        args: [{
            display_name: 'phrase',
            type: 'prose',
            nullable: false,
        }],
        twiddles: [{
            delegate: 'dialogue_box',
            key: 'phrase',
            arg: 0,
        }, {
            // TODO these should probably be twiddles themselves?
            delegate: 'dialogue_box',
            key: 'color',
            prop: 'dialogue_color',
        }, {
            delegate: 'dialogue_box',
            key: 'speaker',
            prop: 'dialogue_name',
        }, {
            delegate: 'dialogue_box',
            key: 'position',
            prop: 'dialogue_position',
        }],
    },
};
Character.LEGACY_JSON_ACTIONS = {
    say: ["say", 'text'],
    pose: ["pose", 'view'],
    leave: ["leave"],
};
// TODO? Character.Actor = ...


class DialogueBox extends Role {
    constructor(name) {
        super(name);

        this.speed = 60;
    }
}
DialogueBox.prototype.TWIDDLES = {
    phrase: {
        initial: null,
        propagate: null,
    },
    speaker: {
        initial: null,
    },
    color: {
        initial: null,
    },
    position: {
        initial: null,
    },
};
DialogueBox.STEP_TYPES = {};
DialogueBox.LEGACY_JSON_ACTIONS = {};
DialogueBox.Actor = class DialogueBoxActor extends Actor {
    constructor(role) {
        super(role);

        // XXX what happens if you try to build twice?  ah, that would be solved if this also returned a new actor instead
        this.element = make_element('div', 'gleam-actor-dialoguebox');

        // Toss in a background element
        this.element.appendChild(make_element('div', '-background'));

        this.scroll_timeout = null;
        this.speaker_element = null;
        this.letter_elements = [];
        // One of:
        // idle -- there is no text left to display
        // waiting -- there was too much text to fit in the box and we are now waiting on a call to advance() to show more
        // scrolling -- we are actively showing text
        // Automatically sync'd with the data-state attribute on the main
        // element.
        this.scroll_state = 'idle';
        // How much spare time has passed; characters will appear until this
        // runs out.  Is usually zero or negative, to indicate a time debt; no
        // characters will appear until the debt has been paid.
        this.time = 0;
    }

    get scroll_state() {
        return this._scroll_state;
    }
    set scroll_state(state) {
        this._scroll_state = state;
        this.element.setAttribute('data-state', state);
    }

    apply_state(state) {
        let old_state = super.apply_state(state);

        if (state.phrase === null) {
            // Hide and return
            // TODO what should this do to speaker tags?  i think this is why
            // the old code had that wrong speaker bug: try jumping to the very
            // last beat, then back to someone else, and it won't update
            // FIXME this means disappearing during a curtain lower, which
            // seems goofy?  maybe need a special indicator for "do nothing no
            // matter what the textbox looks like atm"?  er but how would that
            // be conveyed here.
            this.hide();
            return;
        }

        // Update the dialogue "position" -- this is usually something simple
        // like "left" or "right" to match the side the speaker is on, but it
        // might also restyle the entire dialogue
        // TODO maybe that's a sign that this is a bad name
        if (state.position === null) {
            this.element.removeAttribute('data-position');
        }
        else {
            this.element.setAttribute('data-position', state.position);
        }

        // Deal with the speaker tag.  If there's an old tag, and it doesn't
        // match the new name (which might be null), remove it
        // TODO super weird bug in old code: set the transition time to
        // something huge like 10s and mash arrow keys mid-transition and
        // sometimes you end up with dialogue attributed to the wrong speaker!
        if (old_state.speaker !== null && old_state.speaker !== state.speaker) {
            // Don't just remove it directly; give it a chance to transition
            let old_speaker_element = this.speaker_element;
            this.speaker_element = null;
            old_speaker_element.classList.add('--hidden');
            promise_transition(old_speaker_element).then(() => {
                this.element.removeChild(old_speaker_element);
            });
        }

        // If there's meant to be a speaker now, add a tag
        if (state.speaker !== null && ! this.speaker_element) {
            this.speaker_element = make_element('div', '-speaker --hidden', state.speaker);
            this.element.appendChild(this.speaker_element);

            // Force layout recomputation, then remove the class so the
            // "appear" transition happens
            this.speaker_element.offsetTop;
            this.speaker_element.classList.remove('--hidden');
        }

        // And update the color
        if (state.color === null) {
            this.element.style.removeProperty('--color');
        }
        else {
            this.element.style.setProperty('--color', state.color);
        }

        // Finally, say the line
        this.say(state.phrase);
    }

    say(text) {
        this.element.classList.remove('--hidden');

        // Create the dialogue DOM
        if (this.phrase_wrapper_element) {
            this.element.removeChild(this.phrase_wrapper_element);
        }
        this._build_phrase_dom(text);

        this.scroll_state = 'scrolling';
        this._start_scrolling();
    }

    hide() {
        this.element.classList.add('--hidden');
        // TODO should this reset any scroll state etc?
    }

    _build_phrase_dom(text) {
        // Break 'text' -- which is taken to be raw HTML! -- into a sequence of
        // characters, cleverly preserving the nesting of any tags used within.
        let source = document.createElement('div');
        source.innerHTML = text;
        let target = document.createDocumentFragment();

        let current_node = source.firstChild;
        let current_target = target;
        let letters = [];
        let all_word_endings = [];
        while (current_node) {
            if (current_node.nodeType === Node.TEXT_NODE) {
                let text_chunk = current_node.nodeValue;
                let i = 0;
                while (true) {
                    // TODO astral plane  :/
                    let ch = text_chunk.charAt(i);
                    if (ch) {
                        i++;
                    }
                    else {
                        break;
                    }

                    // Stick spaces onto the end of the previous span; reduces
                    // the DOM size by a decent chunk which makes life faster
                    // all around.  And it doesn't matter if the space is on
                    // the boundary of an inline element, either!
                    if (letters.length > 0 && ch === " ") {
                        let letter = letters[letters.length - 1];
                        letter.textContent += ch;
                        all_word_endings.push(letter);
                    }
                    else {
                        let letter = document.createElement('span');
                        letter.textContent = ch;
                        letters.push(letter);
                        current_target.appendChild(letter);
                    }
                }
            }
            else if (current_node.nodeType === Node.ELEMENT_NODE) {
                let new_parent = current_node.cloneNode(false);
                current_target.appendChild(new_parent);
                current_target = new_parent;
            }

            // Pick the next node
            if (current_node.hasChildNodes()) {
                current_node = current_node.firstChild;
            }
            else {
                while (current_node && ! current_node.nextSibling) {
                    current_node = current_node.parentNode;
                    current_target = current_target.parentNode;

                    if (current_node === source) {
                        current_node = null;
                        break;
                    }
                }

                if (current_node) {
                    current_node = current_node.nextSibling;
                }
            }
        }

        // Start out with all letters hidden
        for (let letter of letters) {
            letter.classList.add('-letter');
            letter.classList.add('--hidden');
        }

        // And finally add it all to the DOM
        // TODO do something with old one...?  caller does atm, but
        this.phrase_element = make_element('div', '-phrase');
        this.phrase_element.appendChild(target);
        this.phrase_viewport_element = make_element('div', '-phrase-viewport');
        this.phrase_viewport_element.appendChild(this.phrase_element);
        this.phrase_wrapper_element = make_element('div', '-phrase-wrapper');
        this.phrase_wrapper_element.appendChild(this.phrase_viewport_element);
        this.element.appendChild(this.phrase_wrapper_element);
        this.letter_elements = letters;
        this.cursor = -1;
        this.chunk_cursor = -1;

        this.find_page_breaks();
    }

    find_page_breaks() {
        // Force a reflow and figure out how the text breaks into chunks
        // TODO maybe don't force a reflow?
        // TODO it would be cool if folks could scroll BACK through text if they missed something in the scroll
        // TODO it would also be cool if the text actually scrolled or something.  that would be pretty easy come to think of it
        // TODO this could be idle somewhat more efficiently (???) by guessing
        // the length of a line and looking for a break, or just binary
        // searching for breaks
        // TODO should this be totally empty if there's no text at all?
        // FIXME if the font becomes bigger partway through the first line of a
        // chunk, i THINK the y here will be wrong and the top of that line
        // will be cut off.  i could use the bottom of the previous line, but
        // in perverse cases that might be wrong too.  i may just have to scan
        // the whole line and use the min top value?
        this.chunks = [];
        if (this.letter_elements.length === 0) {
            // Nothing to do; no letters means no chunks!
            return;
        }

        // TODO explicitly clear transform first?

        // This rectangle describes the space available for filling with text
        let viewport = this.phrase_viewport_element.getBoundingClientRect();

        // TODO apply some word-break to this too, just in case?
        // TODO attempt to prevent orphans?

        // Chunks are really composed of lines, not characters.  It's
        // impossible to know for sure if a letter should go in a new chunk
        // without checking every letter in the same line, because various CSS
        // shenanigans might push some later letters lower.  Thus, the first
        // step is to find line divisions.
        let lines = [];
        let current_line = null;
        for (let [i, letter] of this.letter_elements.entries()) {
            let rect = letter.getBoundingClientRect();

            // This is harder than it really ought to be.  Line wraps aren't
            // actually exposed in the DOM, and every possible avenue involves
            // some amount of heuristic handwaving.  Here's the best I can do:
            // if the top of this letter is below every letter seen so far in
            // the line, it's probably a new line.  This doesn't work in
            // pathological cases where a word is placed significantly below
            // the baseline, so don't do that.  (And if you must, add some
            // padding so the top of the letter's box is a bit higher.)
            if (current_line === null || rect.top > current_line.y1) {
                current_line = {
                    i0: i,
                    i1: i,
                    y0: rect.top,
                    y1: rect.bottom,
                };
                lines.push(current_line);
            }
            else {
                current_line.i1 = i;

                if (rect.top < current_line.y0) {
                    current_line.y0 = rect.top;
                }
                if (rect.bottom > current_line.y1) {
                    current_line.y1 = rect.bottom;
                }
            }
        }

        // Now split those lines into chunks.  (This separate pass also has the
        // advantage that if a single line is taller than the viewport, it'll
        // become a single chunk, rather than pathological behavior like every
        // /letter/ becoming a chunk.)
        let current_chunk = null;
        for (let line of lines) {
            if (current_chunk === null || line.y1 > current_chunk.y0 + viewport.height) {
                // Avoid putting blank lines as the first thing in a chunk; it
                // looks super bad!
                if (line.i0 === line.i1 && this.letter_elements[line.i0].textContent === '\n') {
                    current_chunk = null;
                }
                else {
                    current_chunk = {
                        first_letter_index: line.i0,
                        last_letter_index: line.i1,
                        // Everything so far has been in client coordinates,
                        // but more useful is the position relative to the
                        // container
                        y0: line.y0,
                        y1: line.y1,
                    };
                    this.chunks.push(current_chunk);
                }
            }
            else {
                current_chunk.last_letter_index = line.i1;
                current_chunk.y1 = line.y1;
            }
        }

        // Compute the offset to use to show the start of each chunk,
        // vertically centering it within the available space
        for (let chunk of this.chunks) {
            let text_height = chunk.y1 - chunk.y0;
            let relative_top = chunk.y0 - viewport.top;
            // XXX well, i thought this was a good idea, but it looks weird
            // with a single line left over and it looks REALLY weird with the
            // TAL panels
            //chunk.offset = relative_top - (viewport.height - text_height) / 2;
            chunk.offset = relative_top;
        }
    }

    _start_scrolling() {
        // Start scrolling the next text chunk into view, if any.
        //
        // Returns true iff there was any text to display.
        if (this.scroll_state === 'idle') {
            // Nothing left to do!
            return false;
        }

        if (this.chunk_cursor + 1 >= this.chunks.length) {
            this.scroll_state = 'idle';
            return false;
        }

        this.chunk_cursor++;
        let chunk = this.chunks[this.chunk_cursor];

        // If the scroll is starting midway through the text (presumably, at
        // the start of a line!), slide the text up so the next character is at
        // the top of the text box
        // TODO hm, actually, what if it's /not/ at the start of a line?
        // TODO should there be better text scrolling behavior?  like should
        // this scroll up by a line at a time after the first chunk, or scroll
        // up by a line at a time as it fills in the new chunk, or?  configurable??
        // TODO what if the audience does a text zoom at some point?  is there an event for that?  does resize fire?
        // FIXME this does a transition if the first chunk's offset isn't 0, looks bad.  dunno why, happens with tal panels but not regular dialogue
        this.phrase_element.style.transform = `translateY(-${chunk.offset}px)`;

        this.time = 0;
        this.scroll_state = 'scrolling';
    }

    update(dt) {
        if (this.scroll_state === 'idle') {
            return;
        }

        this.time += dt;

        // Reveal as many letters as appropriate
        let chunk = this.chunks[this.chunk_cursor];
        while (this.time > 0) {
            if (this.cursor + 1 >= this.letter_elements.length) {
                this.scroll_state = 'idle';
                return;
            }

            // If we hit the end of the chunk, stop here and wait for an advance
            if (this.cursor + 1 > chunk.last_letter_index) {
                this.scroll_state = 'waiting';
                return;
            }

            this.cursor++;
            let letter = this.letter_elements[this.cursor];
            letter.classList.remove('--hidden');
            this.time -= 1 / this.role.speed;

            if (letter.textContent === "\f") {
                this.time -= 0.5;
            }

            break;
        }
    }

    advance() {
        // Called when the audience tries to advance to the next beat.  Does a
        // couple interesting things:
        // 1. If the text is still scrolling, fill the textbox instantly.
        // 2. If the textbox is full but there's still more text to show,
        // clear it and continue scrolling.
        // In either case, the advancement is stopped.

        if (this.scroll_state === 'scrolling') {
            // Case 1: The phrase is still scrolling, so advancement means to
            // fill it as much as possible
            this.paused = false;

            let last_letter_index;
            if (this.chunk_cursor + 1 < this.chunks.length) {
                // There are more chunks
                last_letter_index = this.chunks[this.chunk_cursor + 1].first_letter_index - 1;
                this.scroll_state = 'waiting';
            }
            else {
                // This is the last chunk
                last_letter_index = this.letter_elements.length - 1;
                this.scroll_state = 'idle';
            }

            for (let i = this.cursor; i <= last_letter_index; i++) {
                this.letter_elements[i].classList.remove('--hidden');
            }

            let num_letters_shown = last_letter_index - this.cursor + 1;
            this.cursor = last_letter_index;

            // Special case: if the only thing left to show was the last letter
            // in the last chunk, let the advance go through; otherwise, an
            // impatient audience might feel like clicking did nothing
            if (num_letters_shown <= 1) {
                return true;
            }

            // But most of the time, block the advance
            return false;
        }
        else if (this.scroll_state === 'waiting') {
            // Case 2: more text to show

            // Hide the letters from any previous text shown
            for (let letter of this.letter_elements) {
                letter.classList.add('--hidden');
            }

            this._start_scrolling();

            return false;
        }
    }
}
/*
    reify: ($parent) ->
        $element = $ '<div>', class: 'cutscene--speech-bubble'
        $parent.append $element

        $element.data 'visited-labels': {}

        $element.on 'cutscene:change', @_change.bind this
        $element.on 'cutscene:menu', @_menu.bind this
        $element.on 'cutscene:hide', @_hide.bind this
        $element.on 'cutscene:disable', @_disable.bind this

        $element.on 'mouseenter', 'li', @_menu_hover.bind this
        $element.on 'click', 'li', (event) ->
            $selected = $(this)
            label = $selected.data('label')
            if label?
                event.stopImmediatePropagation()
                $element.data('visited-labels')[label] = true
                $parent.triggerHandler 'stage:jump', [label]

        $parent.on 'stage:next' + NS, (event) => @_possibly_fill event, $element
        $parent.on 'action:pause' + NS, (event) => @_pause event, $element
        $parent.on 'action:unpause' + NS, (event) => @_unpause event, $element

        $parent.on 'menu:next' + NS, (event) => @_menu_move event, 1
        $parent.on 'menu:prev' + NS, (event) => @_menu_move event, -1
        $parent.on 'menu:accept' + NS, (event) =>
            $selected = $element.find('li.-selected')
            label = $selected.data('label')
            if label?
                $element.data('visited-labels')[label] = true
                $parent.triggerHandler 'stage:jump', [label]

        return [$element, promise_always()]

    _menu: (event, labels_to_captions) ->
        $el = $ event.currentTarget

        # Check for a special JUMP_WHEN_COMPLETE caption -- if this exists, and
        # the player has visited all the other labels, we'll automatically jump
        # straight to that label
        visited_labels = $el.data 'visited-labels'
        all_visited = true
        when_complete_label = null
        for label, caption of labels_to_captions
            if caption == SpeechBubble.JUMP_WHEN_COMPLETE
                when_complete_label = label
            else if not visited_labels[label]
                all_visited = false
                break
        if all_visited and when_complete_label?
            $el.parent().triggerHandler 'stage:jump', [when_complete_label]
            return

        $el.removeClass '--hidden'
        $el.empty()
        # TODO dry; XXX remove speaker!!!
        $el.css
            backgroundColor: ''
            borderColor: ''

        $menu = $ '<ol>', class: 'cutscene--menu'
        for label, caption of labels_to_captions
            if caption == SpeechBubble.JUMP_WHEN_COMPLETE
                continue
            $menu.append $ '<li>', text: caption, data: label: label

        $menu.children().first().addClass '-selected'

        $el.append $menu

        # Even though this is a brand new element, browser history may keep it
        # scrolled
        $menu[0].scrollTop = 0

        return

    _menu_hover: (event) ->
        $el = $ event.delegateTarget
        $hovered = $ event.currentTarget

        $el.find('li').removeClass '-selected'
        $hovered.addClass '-selected'

    _menu_move: (event, direction) ->
        $el = $ event.currentTarget
        $menu = $el.find '.cutscene--menu'
        if not $menu.length
            return

        $target = $menu.children 'li.-selected'
        $target.removeClass '-selected'

        orig_direction = direction

        while direction > 0
            direction--
            $target = $target.next 'li'
            if not $target.length
                $target = $menu.children('li').first()

        while direction < 0
            direction++
            $target = $target.prev 'li'
            if not $target.length
                $target = $menu.children('li').last()

        $target.addClass '-selected'

        # Is the newly-selected item completely contained within its parent?
        ###
        menu_top = $menu[0].scrollTop
        item_top = $target[0].offsetTop
        menu_bottom = menu_top + $menu[0].offsetHeight
        item_bottom = item_top + $target[0].offsetHeight
        if item_bottom > menu_bottom
            $menu[0].scrollTop = item_bottom - $menu[0].offsetHeight
        if item_top < menu_top
            $menu[0].scrollTop = item_top


            ###
        if not ($menu[0].scrollTop <= $target[0].offsetTop <= $menu[0].scrollTop + $menu[0].offsetHeight - $target[0].offsetHeight)
            # Argument is whether to align with top, which we want to do iff we
            # scrolled upwards.  This also works if we wrapped around:
            # scrolling the topmost item into view "aligned with the bottom"
            # pushes it to the very top.
            $target[0].scrollIntoView orig_direction < 0

    _hide: (event) ->
        $el = $ event.currentTarget
        $el.addClass '--hidden'
        $el.text ''

    _disable: (event) ->
        $el = $ event.currentTarget
        $el.text ''

    _pause: (event, $el) =>
        $dialogue = $el.children '.cutscene--dialogue'
        if not $dialogue.length
            return

        timeout = $dialogue.data 'timeout'
        if timeout?
            cancelAnimationFrame(timeout)

    _unpause: (event, $el) =>
        $dialogue = $el.children '.cutscene--dialogue'
        if not $dialogue.length
            return

        all_letters = $dialogue.data('all_letters')
        letter_index = @_next_letter $dialogue
        if letter_index >= all_letters.length
            return
        @_scroll $dialogue, all_letters, letter_index
*/


////////////////////////////////////////////////////////////////////////////////
// Script and playback

class Beat {
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

    // Create the next beat, as a duplicate of this one
    create_next() {
        // Eagerly-clone, in case of propagation
        let states = new Map();
        for (let [role, prev_state] of this.states) {
            let state = {};
            for (let [key, twiddle] of Object.entries(role.TWIDDLES)) {
                if (twiddle.propagate === undefined) {
                    // Keep using the current value
                    state[key] = prev_state[key];
                }
                else {
                    // Revert to the given propagate value
                    state[key] = twiddle.propagate;
                }
            }
            states.set(role, state);
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

// Given a filename, gets a relevant file.  Mainly exists to abstract over the
// difference between loading a live script from a Web source and pulling from
// the user's hard drive.
// TODO should wire this into player's initial 'loading' screen
// TODO need to SOMEHOW let asset panel know when a thing happens here?  except, wait, it's the asset panel that makes things happen.  maybe a little kerjiggering can fix that then.
// FIXME this just, needs a lot of work.
class AssetLibrary {
    constructor() {
        this.assets = {};
    }

    asset(path) {
        let asset = this.assets[path];
        if (asset) {
            return asset;
        }
        else {
            asset = this.assets[path] = {};
            return asset;
        }
    }

    inherit_uses(library) {
        for (let [path, asset] of Object.entries(library.assets)) {
            if (asset.used) {
                this.asset(path).used = asset.used;
            }
        }
    }
}
// Dummy implementation that can't find any files, used in a fresh editor
class NullAssetLibrary extends AssetLibrary {
    load_image(filename) {
        let asset = this.asset(filename);
        asset.used = true;
        asset.exists = false;
        return make_element('img');
    }
}
// Entry-based implementation, for local files using the Chrome API
class EntryAssetLibrary extends AssetLibrary {
    constructor(directory_entry) {
        super();
        this.directory_entry = directory_entry;

        // TODO technically should be calling this repeatedly.  also it's asynchronous, not super sure if that's a problem.
        directory_entry.createReader().readEntries(entries => {
            // TODO hmm, should mark by whether they're present and whether they're used i guess?
            console.log("got some entries", entries);
            for (let entry of entries) {
                let asset = this.asset(entry.name);
                asset.exists = true;
                asset.entry = entry;
            }
            console.log(this.assets);
        }, console.error)
    }

    // FIXME surely this should be more generic?  can ANY of it be split out, shared with Remote or with <audio>?
    load_image(filename) {
        let element = make_element('img');
        let asset = this.assets[filename];
        if (!asset || !asset.entry) {
            // If there's no asset, this isn't a directory entry, so it can't possibly work
            if (! asset) {
                this.assets[filename] = {
                    used: true,
                    exists: false,
                };
            }
            return element;
        }

        asset.used = true;

        if (asset.url) {
            asset.used = true;
            element.src = url;
            return element;
        }

        // OK!  There's an asset, it has an Entry, we just need a URL for it
        let promise;
        if (asset.entry.toURL) {
            // WebKit only
            promise = Promise.resolve(asset.entry.toURL());
        }
        else {
            // TODO is this a bad idea?  it's already async so am i doing a thousand reads at once??
            promise = new Promise((resolve, reject) => {
                asset.entry.file(file => {
                    resolve(URL.createObjectURL(file));
                });
            });
        }

        promise.then(url => {
            element.src = url;
        });

        // TODO fire an event here, or what?
        return element;
    }
}
// Regular HTTP fetch
class RemoteAssetLibrary extends AssetLibrary {
    // Should be given a URL object as a root
    constructor(root) {
        super();
        this.root = root;
    }

    load_image(filename) {
        let element = make_element('img');
        let asset = this.assets[filename];
        if (asset) {
            // After trying to load this once, there's no point in doing all
            // the mechanical checking again; it'd be cached regardless
            element.src = asset.url;
            return element;
        }

        // Bind the event handler FIRST -- if the image is cached, it might
        // load instantly!
        let promise = promise_event(element, 'load', 'error');
        // TODO what about progress, that seems nice, even if 0/1.  also like something that an asset library should handle

        let url = new URL(filename, this.root);
        asset = this.assets[filename] = {
            url: url,
            used: true,
            exists: null,
            progress: 0,
        };

        let progress_handler = ev => {
            if (ev.lengthComputable) {
                asset.progress = ev.loaded / ev.total;
            }
        };
        element.addEventListener('progress', progress_handler);

        promise = promise.then(
            () => {
                asset.exists = true;
                asset.progress = 1;
            },
            () => {
                asset.exists = false;
            }
        )
        .finally(() => {
            asset.promise = null;
            element.addEventListener('progress', progress_handler);
        });
        asset.promise = promise;

        // TODO fire an event here, or what?
        element.src = url;
        return element;
    }
}

// Given a Step, remembers which twiddles it changes, and tells you when all of
// those twiddles have been overwritten by later steps.  Used temporarily when
// altering an existing Script.
class TwiddleChangeTracker {
    constructor(initial_step) {
        this.changes = new Map();  // Role => Set of twiddle keys

        for (let [role, key] of initial_step.get_affected_twiddles()) {
            let set = this.changes.get(role);
            if (set === undefined) {
                set = new Set();
                this.changes.set(role, set);
            }
            set.add(key);
        }
    }

    overwrite_with(step) {
        for (let [role, key] of step.get_affected_twiddles()) {
            let set = this.changes.get(role);
            if (set) {
                set.delete(key);
                // When a Role's keys are all overwritten, just remove that
                // Role entirely; then it's easy to tell if this change is
                // done, because the top-level map will be empty
                if (set.size === 0) {
                    this.changes.delete(role);
                }
            }
        }
    }

    get completely_overwritten() {
        return this.changes.size === 0;
    }
}

class Script {
    // A Script describes the entirety of a play (VN).  It has some number of
    // Actors (dialogue boxes, picture frames, etc.), and is defined by some
    // number of Steps -- discrete commands which control those actors.  The
    // steps are compiled into a set of beats, which are the states of the
    // actors at a given moment in time.  A Beat is followed by a pause,
    // usually to wait for the audience to click or press a key, but
    // occasionally for a fixed amount of time or until some task is complete.

    constructor() {
        this.roles = [];
        this.role_index = {};
        this._add_role(new Stage('stage'));

        this.set_steps([]);

        // This is mostly used for editing, so that objects wrapping us (e.g.
        // Director, Editor) can know when the step list changes
        this.intercom = new EventTarget();
    }

    _add_role(role) {
        // Internal only!
        this.roles.push(role);
        this.role_index[role.name] = role;
    }

    static from_legacy_json(json) {
        let script = new this();
        script._load_legacy_json(json);
        return script;
    }
    _load_legacy_json(json) {
        // Legacy JSON has an implicit dialogue box
        let dialogue_box = new DialogueBox('dialogue');
        this._add_role(dialogue_box);

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

        let stage = this.role_index['stage'];
        let steps = [];
        for (let json_step of json.script) {
            if (! json_step.actor) {
                // FIXME special actions like roll_credits
                if (json_step.action == 'pause') {
                    steps.push(new Step(stage, Stage.STEP_TYPES.pause, []));
                }
                else {
                    console.warn("ah, not yet implemented:", json_step);
                }
                continue;
            }

            let role = this.role_index[json_step.actor];
            let role_type = role.constructor;
            let [step_key, ...arg_keys] = role_type.LEGACY_JSON_ACTIONS[json_step.action];
            let step_type = role_type.STEP_TYPES[step_key];
            if (! step_type) {
                throw new Error(`No such action '${json_step.action}' for role '${json_step.actor}'`);
            }
            steps.push(new Step(role, role_type.STEP_TYPES[step_key], arg_keys.map(key => json_step[key])));
        }

        this.set_steps(steps);
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

    set_steps(steps) {
        this.steps = steps;

        // Consolidate steps into beats -- maps of role => state
        this.beats = [];
        if (steps.length === 0)
            return;

        let beat = Beat.create_first(this.roles);
        this.beats.push(beat);

        // Iterate through steps and fold them into beats
        for (let [i, step] of this.steps.entries()) {
            step.index = i;
            step.beat_index = this.beats.length - 1;
            step.update_beat(beat);
            beat.last_step_index = i;

            // If this step pauses, the next step goes in a new beat
            if (step.type.pause) {
                // If this is the last step, a pause is meaningless
                if (i === this.steps.length - 1)
                    break;

                beat.pause = step.type.pause;

                let prev_beat = beat;
                beat = prev_beat.create_next();
                this.beats.push(beat);
            }
        }
    }

    _assert_own_step(step) {
        if (this.steps[step.index] !== step) {
            console.error(step);
            throw new Error("Step is not a part of this Script");
        }
    }

    get_beat_for_step(step) {
        this._assert_own_step(step);
        return this.beats[step.beat_index];
    }

    // -------------------------------------------------------------------------
    // Post-load mutation, only used in the editor

    add_role(role) {
        // FIXME abort if name is already in use
        this._add_role(role);

        // Update all existing beats to have this role's default state; nothing
        // fancy is required here, since there are no steps for this role yet
        let state = role.generate_initial_state();
        for (let beat of this.beats) {
            beat.set(role, state);
        }

        this.intercom.dispatchEvent(new CustomEvent('gleam-role-added', {
            detail: {
                role: role,
            },
        }));
    }

    // Editing the step list

    _make_fresh_beat(beat_index) {
        if (beat_index > 0) {
            return this.beats[beat_index - 1].create_next();
        }
        else {
            return Beat.create_first(this.roles);
        }
    }

    // Call to indicate one or more Steps have been altered
    update_steps(...steps) {
        if (steps.length === 0)
            return;

        // FIXME could be way more clever about this, but it's a start
        for (let step of steps) {
            this._assert_own_step(step);

            let beat = this.beats[step.beat_index];
            // Recreate the Beat in question
            let new_beat = this.beats[step.beat_index] = this._make_fresh_beat(step.beat_index);
            new_beat.last_step_index = beat.last_step_index;

            for (let i = beat.first_step_index; i <= beat.last_step_index; i++) {
                this.steps[i].update_beat(new_beat);
            }

            // Keep recreating beats until all twiddle changes from the new step
            // have been overwritten by later steps
            // FIXME do that

            // FIXME yeah nope, need to know if later steps in the beat have the twiddle.  could track which twiddles are affected by which steps (!!!!!), or just recreate the whole thing, it's only a handful of steps
        }

        this._check_constraints();

        this.intercom.dispatchEvent(new CustomEvent('gleam-steps-updated', {
            detail: {
                steps: steps,
            },
        }));
    }

    insert_step(new_step, index) {
        // FIXME bomb if new_step is already in here
        // This step either goes in the middle of an existing beat, splits an
        // existing beat, or becomes a new beat at the very end of the script
        let split_beat = false;
        let new_beat_index;
        if (index >= this.steps.length) {
            index = this.steps.length;
            this.steps.push(new_step);
            // Add to the end of the last beat, or create a new beat if that
            // one ends with a pause
            new_beat_index = this.beats.length - 1;
            let beat = this.beats[new_beat_index];
            if (beat === undefined || beat.pause !== false) {
                new_beat_index++;
                beat = this._make_fresh_beat(new_beat_index);
                this.beats.push(beat);
            }
            new_step.update_beat(beat);
            beat.last_step_index = index;
            // TODO should update_beat do this?
            beat.pause = new_step.type.pause;

            new_step.index = index;
            new_step.beat_index = new_beat_index;
        }
        else {
            // The affected beat must be the one that contains the step
            // currently in the position being inserted into
            let beat_index = this.steps[index].beat_index;
            new_beat_index = beat_index;
            let next_beat_index = beat_index + 1;
            let existing_beat = this.beats[beat_index];

            // Recreate this beat from scratch
            let new_beat = this.beats[beat_index] = this._make_fresh_beat(beat_index);
            // Update with the steps in the beat, up to the new step's index
            for (let i = new_beat.first_step_index; i < index; i++) {
                this.steps[i].update_beat(new_beat);
            }
            // Update with the new step
            new_step.update_beat(new_beat);

            if (new_step.type.pause) {
                // The new step pauses, so it splits this beat in half
                new_beat.pause = new_step.type.pause;
                new_beat.last_step_index = index;
                // TODO mark this in the event, somehow
                new_beat = new_beat.create_next();
                this.beats.splice(beat_index + 1, 0, new_beat);
                next_beat_index++;
                split_beat = true;
            }

            // Update metadata for later steps
            for (let step of this.steps) {
                if (step.index >= index) {
                    step.index++;
                    if (split_beat) {
                        step.beat_index++;
                    }
                }
            }
            // Add metadata for this step
            new_step.index = index;
            new_step.beat_index = beat_index;

            // Now that previous stuff is dealt with, actually insert the step
            this.steps.splice(index, 0, new_step);

            // Track all the twiddles altered by this new Step, and keep
            // recreating beats after it until its changes have been erased by
            // later steps.
            // Note that a step can affect other roles, or even multiple roles,
            // so this is a Map of Role => Set of twiddles
            let twiddle_change = new TwiddleChangeTracker(new_step);

            // Update with the steps through the end of the beat.  (This might
            // be the same beat as the new step, or if the new step pauses, a
            // new beat containing everything else split off from the beat.)
            new_beat.last_step_index = existing_beat.last_step_index + 1;
            for (let i = index + 1; i <= new_beat.last_step_index; i++) {
                this.steps[i].update_beat(new_beat);
                twiddle_change.overwrite_with(this.steps[i]);
            }

            // Keep recreating future beats until all of this new step's
            // twiddle changes have been overwritten by later steps.  Inserting
            // a step will bump the positions of all future steps, too, so
            // update some beat metadata at the same time
            for (let b = next_beat_index; b < this.beats.length; b++) {
                let beat = this.beats[b];
                beat.first_step_index++;
                beat.last_step_index++;

                if (! twiddle_change.completely_overwritten) {
                    let new_beat = this.beats[b - 1].create_next();
                    new_beat.last_step_index = beat.last_step_index;
                    for (let i = beat.first_step_index; i <= beat.last_step_index; i++) {
                        this.steps[i].update_beat(new_beat);
                        twiddle_change.overwrite_with(this.steps[i]);
                    }
                    this.beats[b] = new_beat;
                }
            }
        }

        this._check_constraints();

        this.intercom.dispatchEvent(new CustomEvent('gleam-step-inserted', {
            detail: {
                step: new_step,
                index: index,
                beat_index: new_beat_index,
                split_beat: split_beat,
            },
        }));
    }

    delete_step(step) {
        this._assert_own_step(step);
        // FIXME if this step pauses, may need to fuse this beat with next one and adjust numbering
        // FIXME need to recreate this beat and future ones, twiddle change, etc etc.
        // FIXME fire event of course

        // This step may be in the middle of a beat, may be the pause at the
        // end of a beat, or may be the ONLY step in a beat (in which case the
        // beat is also deleted)
        let merged_beat = false;
        let deleted_beat = false;
        let index = step.index;
        let beat_index = step.beat_index;
        {
            let next_beat_index = beat_index + 1;
            let beat = this.beats[beat_index];

            // Recreate this beat from scratch
            let new_beat = this.beats[beat_index] = this._make_fresh_beat(beat_index);
            // Update with the steps in the beat, up to the new step's index
            for (let i = new_beat.first_step_index; i < index; i++) {
                this.steps[i].update_beat(new_beat);
            }

            if (step.type.pause && beat_index < this.beats.length - 1) {
                // The step pauses, so we need to merge with the next beat --
                // or, if it's the only step, just delete the beat
                beat = this.beats[beat_index + 1];
                new_beat.pause = beat.pause;
                this.beats.splice(beat_index + 1, 1);
                merged_beat = true;
            }

            // Now that previous stuff is dealt with, actually delete the step
            this.steps.splice(step.index, 1);
            step.index = null;
            step.beat_index = null;

            // Update metadata for later steps
            for (let step of this.steps) {
                if (step.index >= index) {
                    step.index--;
                    if (merged_beat) {
                        step.beat_index--;
                    }
                }
            }

            // Track all the twiddles altered by the deleted Step, and keep
            // recreating beats after it until its changes have been erased by
            // later steps.
            let twiddle_change = new TwiddleChangeTracker(step);

            // Update with the steps through the end of the beat.  (This might
            // be the same beat as the new step, or if the new step pauses, a
            // new beat containing everything else split off from the beat.)
            new_beat.last_step_index = beat.last_step_index - 1;
            for (let i = index; i <= new_beat.last_step_index; i++) {
                this.steps[i].update_beat(new_beat);
                twiddle_change.overwrite_with(this.steps[i]);
            }

            // Keep recreating future beats until all of this new step's
            // twiddle changes have been overwritten by later steps.  Inserting
            // a step will bump the positions of all future steps, too, so
            // update some beat metadata at the same time
            for (let b = next_beat_index; b < this.beats.length; b++) {
                let beat = this.beats[b];
                beat.first_step_index--;
                beat.last_step_index--;

                if (! twiddle_change.completely_overwritten) {
                    let new_beat = this.beats[b - 1].create_next();
                    new_beat.last_step_index = beat.last_step_index;
                    for (let i = beat.first_step_index; i <= beat.last_step_index; i++) {
                        this.steps[i].update_beat(new_beat);
                        twiddle_change.overwrite_with(this.steps[i]);
                    }
                    this.beats[b] = new_beat;
                }
            }
        }

        this._check_constraints();

        this.intercom.dispatchEvent(new CustomEvent('gleam-step-deleted', {
            detail: {
                step: step,
                index: index,
                beat_index: beat_index,
                merged_beat: merged_beat,
            },
        }));
    }

    // Debugging helper to ensure constraints are still met after messing with
    // the step or beat lists
    _check_constraints() {
        console.log("checking Script constraints...");

        // Every step should be in the step metadata list; they should be the
        // only steps in the step metadata list; and the meta index should be
        // correct
        let expected_meta_count = this.steps.length;
        for (let [i, step] of this.steps.entries()) {
            if (step.index !== i) {
                console.warn("Step", i, "claims it's at", step.index);
            }
        }

        // Beats should not overlap, they should cover exactly the range of
        // steps, and step metadata should point to the right beat
        let expected_first_index = 0;
        for (let [b, beat] of this.beats.entries()) {
            if (beat.first_step_index !== expected_first_index) {
                console.warn("Expected beat", b, "to start from step", expected_first_index, "but instead found", beat.first_step_index, ":", beat);
            }
            expected_first_index = beat.last_step_index + 1;

            for (let i = beat.first_step_index; i <= beat.last_step_index; i++) {
                let step = this.steps[i];
                if (step.beat_index !== b) {
                    console.warn("Expected step", i, "to belong to beat", b, "but instead it claims to belong to beat", step.beat_index);
                }
            }
        }
        if (expected_first_index !== this.steps.length) {
            console.warn("Expected last beat to end on step", this.steps.length - 1, "but instead found", expected_first_index - 1);
        }

        // And finally, just fuckin' brute force it: act like we manually
        // replaced all the steps and ensure the results are the same
        let steps = this.steps;
        let beats = this.beats;

        this.set_steps(steps);
        for (let [i, step] of this.steps.entries()) {
            let step0 = steps[i];
            if (step !== step0) {
                console.warn("Expected step", i, "to be identical", step0, step);
            }
        }
        for (let [b, beat] of this.beats.entries()) {
            let beat0 = beats[b];
            if (beat0.first_step_index !== beat.first_step_index ||
                beat0.last_step_index !== beat.last_step_index ||
                beat0.states.size !== beat.states.size)
            {
                console.warn("Expected beat", b, "to match", beat0, beat);
            }
            for (let [role, state] of beat.states) {
                if (! beat0.states.has(role)) {
                    console.warn("Beat is missing role", role);
                    continue;
                }
                let state0 = beat0.states.get(role);
                for (let [key, value] of Object.entries(state)) {
                    if (value !== state0[key]) {
                        console.warn("Role", role, "expected twiddle", key, "to have value", value, "got", state0[key]);
                    }
                }
            }
        }

        this.steps = steps;
        this.beats = beats;
    }
}
// The Director handles playback of a Script (including, of course, casting an
// Actor for each Role).
class Director {
    constructor(script, library = null) {
        this.script = script;
        // TODO what is a reasonable default for this?
        this.library = library;

        this.busy = false;

        this.actors = {};
        // TODO this seems clumsy...  maybe if roles had names, hmm
        this.role_to_actor = new Map();
        for (let role of this.script.roles) {
            let actor = role.cast(this);
            this.actors[role.name] = actor;
            this.role_to_actor.set(role, actor);
        }

        // Used to announce advancement to wrapper types
        this.intercom = new EventTarget();

        // Bind some stuff
        // TODO hm, could put this in a 'script' setter to make it Just Work when reassigning script, but why not just make a new Director?
        this.script.intercom.addEventListener('gleam-role-added', ev => {
            let role = ev.detail.role;
            // FIXME duped from above
            let actor = role.cast(this);
            this.actors[role.name] = actor;
            this.role_to_actor.set(role, actor);
            // Refresh, in case the role has some default state
            this.jump(this.cursor);
        });
        // When a new step is added, if it's part of the beat we're currently
        // on, jump back to it
        // TODO it seems sensible to not refresh the text if it hasn't changed?
        let refresh_handler = ev => {
            let beat_index = ev.detail.beat_index;
            if (beat_index === undefined) {
                // FIXME lol hack and also wrong anyway
                beat_index = ev.detail.steps[0].beat_index;
            }

            // If a beat was added or removed, adjust the cursor
            if (this.cursor > beat_index) {
                if (ev.detail.split_beat) {
                    this.jump(this.cursor + 1);
                }
                else if (ev.detail.merged_beat) {
                    this.jump(this.cursor - 1);
                }
            }
            else if (beat_index === this.cursor) {
                this.jump(this.cursor);
            }
        };
        this.script.intercom.addEventListener('gleam-steps-updated', refresh_handler);
        this.script.intercom.addEventListener('gleam-step-inserted', refresh_handler);
        this.script.intercom.addEventListener('gleam-step-deleted', refresh_handler);

        // And start us off on the first beat
        this.cursor = -1;
        // TODO what if there are no beats?  this feels hokey
        if (this.script.beats.length > 0) {
            this.jump(0);
        }
    }

    jump(beat_index) {
        // FIXME what if we're 'busy' at this point?  some callers (editor, mostly) expect this to be unconditional
        // FIXME what if there's a promised advance pending, and we do an editor jump?

        this.cursor = beat_index;
        let beat = this.script.beats[this.cursor];

        // TODO ahh can the action "methods" return whether they pause?

        let promises = [];
        // TODO add a Beat API for this, it's invasive
        for (let [role, state] of beat.states) {
            // Actors can return promises, and the scene won't advance until
            // they've been resolved
            let actor = this.role_to_actor.get(role);
            let promise = actor.apply_state(state);
            if (promise) {
                promises.push(promise);
            }
        }

        if (promises.length > 0) {
            this.busy = true;
            let promise = Promise.all(promises);
            promise.then(() => {
                this.busy = false;
                // If the step that ended the beat was a "wait" step, then
                // auto-advance as soon as all the promises are done
                // TODO hm shouldn't this also happen if we didn't get any promises
                if (beat.pause === 'wait') {
                    this.advance();
                }
            });
        }

        // Broadcast the jump
        this.intercom.dispatchEvent(new CustomEvent(
            'gleam-director-beat', { detail: this.cursor }));
    }

    advance() {
        // FIXME this seems pretty annoying in the editor, and also when scrolling through
        if (this.busy) {
            return;
        }

        // Some actors (namely, dialogue box) can do their own waiting for an
        // advance, so consult them all first, and eject if any of them say
        // they're still busy
        if (this.cursor >= 0) {
            let busy = false;
            for (let actor of Object.values(this.actors)) {
                if (actor.advance() === false) {
                    busy = true;
                }
            }
            if (busy) {
                return;
            }
        }

        // If we're still here, advance to the next beat
        if (this.cursor >= this.script.beats.length)
            return;

        this.jump(this.cursor + 1);
    }

    update(dt) {
        for (let [name, actor] of Object.entries(this.actors)) {
            actor.update(dt);
        }
    }
}

class Player {
    constructor(script, library) {
        this.script = script;
        // TODO what's a reasonable default for a library?  remote based on location of the script (or the calling file), of course, but...?
        this.director = new Director(script, library);
        this.container = make_element('div', 'gleam-player');
        this.paused = false;

        // Create some player UI
        // Progress marker
        this.progress_element = make_element('div', 'gleam-progress');
        // FIXME it is not entirely clear how this should be updated
        this.container.appendChild(this.progress_element);
        // Pause screen
        this.pause_element = make_element('div', 'gleam-pause');
        this.pause_element.innerHTML = this.PAUSE_SCREEN_HTML;
        // TODO options (persist!!): volume, hide UI entirely (pause button + progress bar), take screenshot?, low power mode (disable text shadows and the like) or disable transitions entirely (good for motion botherment)
        // TODO links to currently active assets?  sorta defeats bandcamp i guess, but i always did want a jukebox mode
        // TODO debug stuff, mostly current state of actors
        this.pause_element.addEventListener('click', ev => {
            // Block counting this as an advancement click
            // TODO could avoid this if we had a child element holding all the actors, but then we'd have to deal with focus nonsense.  but we might anyway since the pause screen has focus targets on it
            ev.stopPropagation();
        });
        // Normally I'd love for something like this to be a button, but I explicitly DO NOT want it to receive focus -- if the audience clicks it to unpause and then presses spacebar to advance, it'll just activate the pause button again!
        this.pause_button = make_element('div', 'gleam-pause-button');
        this.pause_button.innerHTML = svg_icon_from_path("M 5,1 V 14 M 11,1 V 14");
        this.pause_button.addEventListener('click', ev => {
            // Block counting this as an advancement click
            ev.stopPropagation();

            this.toggle_paused();
        });
        this.container.appendChild(this.pause_element);
        this.container.appendChild(this.pause_button);
        let beats_list = this.pause_element.querySelector('.gleam-pause-beats');
        let number_next_beat = false;
        for (let [i, beat] of this.script.beats.entries()) {
            let li = make_element('li');
            let b = i + 1;
            if (number_next_beat || b % 10 === 0 || b === 1 || b === this.script.beats.length) {
                number_next_beat = false;
                li.textContent = String(b);
            }
            li.setAttribute('data-beat-index', i);
            beats_list.appendChild(li);

            if (this.script.steps[beat.last_step_index].type.is_major_transition) {
                // TODO ok this is extremely hokey
                beats_list.append(make_element('hr'));
                number_next_beat = true;
            }
        }
        beats_list.addEventListener('click', ev => {
            let li = ev.target.closest('.gleam-pause-beats li');
            if (! li)
                return;
            let b = parseInt(li.getAttribute('data-beat-index'), 10);
            this.unpause();
            // TODO hm, instant jump?  curtain?
            this.director.jump(b);
        });

        // Add the actors to the DOM
        for (let [name, actor] of Object.entries(this.director.actors)) {
            // FIXME whoopsie doodle, where do promises go here if the actors
            // construct elements themselves?  standard property on Actor
            // maybe?  worst case, stuff loaded in the background already,
            // right?
            if (actor.element) {
                this.container.appendChild(actor.element);
            }
        }

        // Bind some useful event handlers
        // TODO should make our own sub-container so when we go away (and delete the dom), the events go away too
        this.container.addEventListener('click', e => {
            this.director.advance();
        });

        this.playing = false;
    }

    // TODO kind of a weird api maybe?
    // Insert the player into a parent element
    inject(parent) {
        parent.append(this.container);
    }
    // Remove the player from the document
    detach() {
        this.container.remove();
    }

    update(dt) {
        this.director.update(dt);
        // FIXME Oh this is very bad, probably replace the hook thing with events the director fires
        this.progress_element.style.setProperty('--progress', this.director.cursor / this.script.beats.length * 100 + '%');
    }

    play() {
        this.playing = true;
        this.last_timestamp = performance.now();

        this.on_frame_bound = this.on_frame.bind(this);
        window.requestAnimationFrame(this.on_frame_bound);
    }

    toggle_paused() {
        if (this.paused) {
            this.unpause();
        }
        else {
            this.pause();
        }
    }

    pause() {
        if (this.paused)
            return;
        this.paused = true;

        this.container.classList.add('--paused');

        // Update selected beat
        let beats_list = this.pause_element.querySelector('.gleam-pause-beats');
        for (let li of beats_list.querySelectorAll('.--current')) {
            li.classList.remove('--current');
        }
        beats_list.children[this.director.cursor].classList.add('--current');
    }

    unpause() {
        if (!this.paused)
            return;
        this.paused = false;

        this.container.classList.remove('--paused');
    }

    on_frame(timestamp) {
        if (! this.playing)
            return;

        let dt = (timestamp - this.last_timestamp) / 1000;
        this.last_timestamp = timestamp;

        this.update(dt);

        window.requestAnimationFrame(this.on_frame_bound);
    }
}
Player.prototype.PAUSE_SCREEN_HTML = `
    <h2>PAUSED</h2>
    <ol class="gleam-pause-beats"></ol>
`;

function make_element(tag, cls, text) {
    let element = document.createElement(tag);
    if (cls) {
        element.className = cls;
    }
    if (text) {
        element.textContent = text;
    }
    return element;
}


////////////////////////////////////////////////////////////////////////////////
// EDITOR

function human_friendly_sort(filenames) {
    filenames.sort((a, b) => {
        // By some fucking miracle, JavaScript can do
        // human-friendly number sorting already, hallelujah
        return a.localeCompare(b, undefined, { numeric: true });
    });
}

function open_overlay(element) {
    let overlay = make_element('div', 'gleam-editor-overlay');
    overlay.appendChild(element);
    document.body.appendChild(overlay);

    // Remove the overlay when clicking outside the element
    overlay.addEventListener('click', ev => {
        overlay.remove();
    });
    // But ignore any click on the element itself
    element.addEventListener('click', ev => {
        ev.stopPropagation();
    });

    return overlay;
}

function close_overlay(element) {
    let overlay = element.closest('.gleam-editor-overlay');
    if (overlay) {
        overlay.remove();
        return overlay;
    }
}

// -----------------------------------------------------------------------------
// Step argument configuration

const STEP_ARGUMENT_TYPES = {
    prose: {
        view(value) {
            return make_element('div', 'gleam-editor-arg-prose', value);
        },
        update(element, value) {
            element.textContent = value;
        },
        edit(element, value) {
            return new Promise((resolve, reject) => {
                let editor_element = make_element('textarea', 'gleam-editor-arg-prose', value);
                // FIXME having to click outside (and thus likely activate something else) kind of sucks
                // TODO but then, i'd love to have an editor that uses the appropriate styling, anyway
                editor_element.addEventListener('blur', ev => {
                    editor_element.replaceWith(element);
                    resolve(editor_element.value);
                });
                element.replaceWith(editor_element);
                // FIXME doesn't focus at the point where you clicked in the text
                editor_element.focus();
            });
        },
    },

    pose: {
        view(value) {
            return make_element('div', 'gleam-editor-arg-enum', value);
        },
        update(element, value) {
            element.textContent = value;
        },
        edit(element, value, step, mouse_event) {
            return new Promise((resolve, reject) => {
                // FIXME this very poorly handles a very long list, and doesn't preview or anything
                let editor_element = make_element('ol', 'gleam-editor-arg-enum-poses');
                for (let pose of Object.keys(step.role.poses)) {
                    let li = make_element('li', null, pose);
                    li.setAttribute('data-pose', pose);
                    editor_element.appendChild(li);
                }
                // Save on clicking a pose
                editor_element.addEventListener('click', ev => {
                    let li = ev.target.closest('li');
                    if (! li)
                        return;

                    resolve(li.getAttribute('data-pose'));
                    close_overlay(ev.target);
                });

                // FIXME better...  aiming?  don't go off the screen etc
                // FIXME getting this passed in feels hacky but it's the only place to get the cursor position
                editor_element.style.left = `${mouse_event.clientX}px`;
                editor_element.style.top = `${mouse_event.clientY}px`;
                let overlay = open_overlay(editor_element);
                // Clicking the overlay to close the menu means cancel
                overlay.addEventListener('click', ev => {
                    reject();
                });
            });
        },
    },
};


// -----------------------------------------------------------------------------
// Editors for individual role types

class RoleEditor {
    constructor(main_editor, role) {
        this.main_editor = main_editor;
        this.role = role;

        let throwaway = document.createElement('div');
        // FIXME ditch the templates, they're similar and simple enough to just build
        throwaway.innerHTML = this.HTML;
        this.container = throwaway.firstElementChild;  // FIXME experimental, ugh
        this.container.classList.add(this.CLASS_NAME);
        this.container.querySelector('header > h2').textContent = role.name;

        this.initialize_steps();

        // FIXME clean this up
        let h2 = this.container.querySelector('header > h2');
        h2.addEventListener('click', ev => {
            let editor = make_element('input');
            editor.type = 'text';
            editor.value = this.role.name;
            // FIXME bah, need to put the styling on the <header>...
            h2.replaceWith(editor);
            editor.focus();
            // TODO on enter, too.  and cancel on esc
            editor.addEventListener('blur', ev => {
                h2.textContent = editor.value;
                this.role.name = editor.value;
                // TODO inform the script panel
                editor.replaceWith(h2);
            });
        });
    }

    static create_role(name) {
        return new this.prototype.ROLE_TYPE(name);
    }

    initialize_steps() {
        // Add step templates
        // FIXME this is for picture frame; please genericify
        this.step_type_map = new Map();  // step element => step type
        for (let step_type of Object.values(this.ROLE_TYPE.STEP_TYPES)) {
            let step_el = this.make_sample_step_element(step_type);
            this.container.appendChild(step_el);
            this.step_type_map.set(step_el, step_type);
        }

        // Enable dragging steps into the script
        this.container.addEventListener('dragstart', e => {
            e.dataTransfer.dropEffect = 'copy';
            e.dataTransfer.setData('text/plain', null);
            let step_type = this.step_type_map.get(e.target);
            let args = [];
            for (let arg_def of step_type.args) {
                // TODO?
                args.push(null);
            }
            this.main_editor.script_panel.begin_step_drag(new Step(this.role, step_type, args));
        });
    }

    make_sample_step_element(step_type) {
        let el = make_element('div', 'gleam-editor-step');
        el.classList.add(this.CLASS_NAME);

        let handle = make_element('div', '-handle', '⠿');
        el.appendChild(handle);

        // A cheaty hack to make an element draggable only by a child handle: add
        // the 'draggable' attribute (to the whole parent) only on mousedown
        handle.addEventListener('mousedown', ev => {
            ev.target.parentNode.setAttribute('draggable', 'true');
        });
        handle.addEventListener('mouseup', ev => {
            ev.target.parentNode.removeAttribute('draggable');
        });
        // Also remove it after a successful drag
        el.addEventListener('dragend', ev => {
            ev.target.removeAttribute('draggable');
        });

        // FIXME how does name update?  does the role editor keep a list, or do these things like listen for an event on us?
        el.appendChild(make_element('div', '-what', step_type.display_name));
        for (let arg_def of step_type.args) {
            el.appendChild(make_element('div', '-how', `[${arg_def.display_name}]`));
        }
        return el;
    }

    // FIXME i changed my mind and this should go on ScriptPanel.  only trouble is this.CLASS_NAME
    make_step_element(step) {
        let el = make_element('div', 'gleam-editor-step');
        el.classList.add(this.CLASS_NAME);

        let handle = make_element('div', '-handle', '⠿');
        el.appendChild(handle);

        // A cheaty hack to make an element draggable only by a child handle: add
        // the 'draggable' attribute (to the whole parent) only on mousedown
        handle.addEventListener('mousedown', ev => {
            ev.target.parentNode.setAttribute('draggable', 'true');
        });
        handle.addEventListener('mouseup', ev => {
            ev.target.parentNode.removeAttribute('draggable');
        });
        // Also remove it after a successful drag
        el.addEventListener('dragend', ev => {
            ev.target.removeAttribute('draggable');
        });

        // FIXME how does name update?  does the role editor keep a list, or do these things like listen for an event on us?
        el.appendChild(make_element('div', '-who', step.role.name));
        el.appendChild(make_element('div', '-what', step.type.display_name));

        for (let [i, arg_def] of step.type.args.entries()) {
            let value = step.args[i];
            let arg_element = make_element('div', '-how');
            let arg_type = STEP_ARGUMENT_TYPES[arg_def.type];
            if (arg_type) {
                let viewer = arg_type.view(value);
                viewer.classList.add('gleam-editor-arg');
                viewer.setAttribute('data-arg-index', i);
                arg_element.appendChild(viewer);
            }
            else {
                arg_element.appendChild(make_element('span', null, value));
            }
            el.appendChild(arg_element);
        }
        return el;
    }

    update_assets() {}
}


// FIXME you should NOT be able to make more of these
class StageEditor extends RoleEditor {
}
StageEditor.prototype.ROLE_TYPE = Stage;
StageEditor.prototype.CLASS_NAME = 'gleam-editor-role-stage';
StageEditor.prototype.HTML = `
    <li class="gleam-editor-role-stage">
        <header>
            <h2>stage</h2>
        </header>
    </li>
`;

class CurtainEditor extends RoleEditor {
}
CurtainEditor.prototype.ROLE_TYPE = Curtain;
CurtainEditor.role_type_name = 'curtain';
CurtainEditor.prototype.CLASS_NAME = 'gleam-editor-role-curtain';
CurtainEditor.prototype.HTML = `
    <li class="gleam-editor-role-curtain">
        <header>
            <h2>curtain</h2>
        </header>
    </li>
`;

class JukeboxEditor extends RoleEditor {
}
JukeboxEditor.prototype.ROLE_TYPE = Jukebox;
JukeboxEditor.role_type_name = 'jukebox';
JukeboxEditor.prototype.CLASS_NAME = 'gleam-editor-role-jukebox';
JukeboxEditor.prototype.HTML = `
    <li class="gleam-editor-role-jukebox">
        <header>
            <h2>📻 jukebox</h2>
        </header>
        <h3>Tracks <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
    </li>
`;

class PictureFrameEditor extends RoleEditor {
    constructor(...args) {
        super(...args);

        this.pose_list = this.container.querySelector('.gleam-editor-role-pictureframe-poses');
        this.populate_pose_list();

        let button = this.container.querySelector('button');
        button.addEventListener('click', ev => {
            let wildcard = 'warmheart*.png';
            let parts = wildcard.split(/([*?])/);
            let rx_parts = [];
            for (let [i, part] of parts.entries()) {
                if (i % 2 === 0) {
                    // FIXME regex escape
                }
                else if (part === '*') {
                    part = '.*';
                }
                else if (part === '?') {
                    part = '.';
                }

                if (i === 1) {
                    part = '(' + part;
                }
                if (i === parts.length - 2) {
                    part = part + ')';
                }

                rx_parts.push(part);
            }
            console.log(parts);
            console.log(rx_parts);
            let rx = new RegExp(rx_parts.join(''));
            let lib = this.main_editor.library;

            let library_paths = Object.keys(lib.assets);
            human_friendly_sort(library_paths);

            for (let path of library_paths) {
                let m = path.match(rx);
                if (m) {
                    let name = m[1];
                    this.role.add_pose(name, path);
                    // FIXME overt c/p job
            let li = make_element('li');
            let img = lib.load_image(path);
            img.classList.add('-asset');
            li.append(img);
            li.appendChild(make_element('p', '-caption', name));
            this.pose_list.appendChild(li);
                    // FIXME how do i update the existing actor, then?
                }
            }
        });
    }

    populate_pose_list() {
        this.pose_list.textContent = '';
        for (let [pose_name, pose] of Object.entries(this.role.poses)) {
            let frame = pose[0];  // FIXME this format is bonkers
            let li = make_element('li');
            let img = this.main_editor.library.load_image(frame.url);
            img.classList.add('-asset');
            li.append(img);
            li.appendChild(make_element('p', '-caption', pose_name));
            this.pose_list.appendChild(li);
        }
    }

    update_assets() {
        this.populate_pose_list();
    }
}
PictureFrameEditor.prototype.ROLE_TYPE = PictureFrame;
PictureFrameEditor.role_type_name = 'picture frame';
PictureFrameEditor.prototype.CLASS_NAME = 'gleam-editor-role-pictureframe';
PictureFrameEditor.prototype.HTML = `
    <li class="gleam-editor-role-pictureframe">
        <header>
            <h2>backdrop</h2>
        </header>
        <button>add poses by wildcard</button>
        <h3>Poses <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
        <ul class="gleam-editor-role-pictureframe-poses">
        </ul>
    </li>
`;


// FIXME? blurgh
class CharacterEditor extends PictureFrameEditor {
    constructor(...args) {
        super(...args);

        let before = this.container.querySelector('h3');
        let propmap = make_element('dl', 'gleam-editor-propmap');
        before.parentNode.insertBefore(propmap, before);

        // FIXME make this all less ugly
        propmap.append(make_element('dt', null, 'Dialogue box'));
        let dd = make_element('dd');
        dd.append(make_element('div', 'gleam-editor-role-dialoguebox', 'dialogue'));
        propmap.append(dd);

        propmap.append(make_element('dt', null, 'Dialogue name'));
        dd = make_element('dd');
        let input = make_element('input');
        input.type = 'text';
        input.value = this.role.dialogue_name;
        dd.append(input);
        propmap.append(dd);

        propmap.append(make_element('dt', null, 'Dialogue style'));
        dd = make_element('dd');
        input = make_element('input');
        input.type = 'text';
        input.value = this.role.dialogue_position;
        dd.append(input);
        propmap.append(dd);

        propmap.append(make_element('dt', null, 'Dialogue color'));
        dd = make_element('dd');
        input = make_element('input');
        input.type = 'color';
        input.value = this.role.dialogue_color;
        input.addEventListener('change', ev => {
            let color = input.value;
            this.role.dialogue_color = color;
            // XXX well, this feels, questionable
            this.main_editor.script.update_steps(...this.main_editor.script.steps.filter(step => step.role === this.role));
        });
        dd.append(input);
        propmap.append(dd);
    }
}
CharacterEditor.prototype.ROLE_TYPE = Character;
CharacterEditor.role_type_name = 'character';
CharacterEditor.prototype.CLASS_NAME = 'gleam-editor-role-character';
CharacterEditor.prototype.HTML = `
    <li class="gleam-editor-role-character">
        <header>
            <h2>backdrop</h2>
        </header>
        <button>add poses by wildcard</button>
        <h3>Poses <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
        <ul class="gleam-editor-role-pictureframe-poses">
        </ul>
    </li>
`;

class DialogueBoxEditor extends RoleEditor {
}
DialogueBoxEditor.prototype.ROLE_TYPE = DialogueBox;
DialogueBoxEditor.role_type_name = 'dialogue box';
DialogueBoxEditor.prototype.CLASS_NAME = 'gleam-editor-role-dialoguebox';
DialogueBoxEditor.prototype.HTML = `
    <li class="gleam-editor-role-dialoguebox">
        <header>
            <h2>backdrop</h2>
        </header>
    </li>
`;


// List of all role editor types
const ROLE_EDITOR_TYPES = [
    StageEditor,  // FIXME uncreatable
    CurtainEditor,
    JukeboxEditor,
    PictureFrameEditor,
    CharacterEditor,
    DialogueBoxEditor,
];
const ROLE_EDITOR_TYPE_MAP = new Map(ROLE_EDITOR_TYPES.map(role_editor_type => [role_editor_type.prototype.ROLE_TYPE, role_editor_type]));


// -----------------------------------------------------------------------------
// Main editor

class Panel {
    constructor(editor, container) {
        this.editor = editor;
        this.container = container;
        this.nav = container.querySelector('.gleam-editor-panel > header > nav');
        this.body = container.querySelector('.gleam-editor-panel > .gleam-editor-panel-body');
    }
}

// Panel containing the list of assets
class AssetsPanel extends Panel {
    constructor(editor, container) {
        super(editor, container);
        this.list = this.body.querySelector('.gleam-editor-assets');
        this.item_index = {};  // filename => <li>

        // DOM stuff: allow dragging a local directory onto us, via the WebKit
        // file entry interface
        // FIXME? this always takes a moment to register, not sure why...
        // FIXME this should only accept an actual directory drag
        // FIXME should have some other way to get a directory.  file upload control?
        this.container.addEventListener('dragenter', e => {
            // FIXME well this isn't. right. the enter might go directly to a child
            //if (e.target !== this.container) {
            //    return;
            //}

            e.stopPropagation();
            e.preventDefault();
            console.log(e);

            this.container.classList.add('gleam-editor-drag-hover');
        });
        this.container.addEventListener('dragover', e => {
            e.stopPropagation();
            e.preventDefault();
            console.log(e);
        });
        this.container.addEventListener('dragleave', e => {
            // XXX this was fixed in chrome in may 15, 2017; too recent?
            if (e.relatedTarget && this.container.contains(e.relatedTarget))
                return;

            this.container.classList.remove('gleam-editor-drag-hover');
            console.log(e);
        });
        this.container.addEventListener('drop', e => {
            e.stopPropagation();
            e.preventDefault();
            console.log(e);

            this.container.classList.remove('gleam-editor-drag-hover');
            console.log(e.dataTransfer);
            let item = e.dataTransfer.items[0];
            let entry = item.webkitGetAsEntry();
            // FIXME should this...  change the library entirely?  or what?  needs to update //everything//
            this.editor.set_library(new EntryAssetLibrary(entry));
        });

        // FIXME this is bad, but given that the Library might have a bunch of stuff happen at once, maybe it's not /that/ bad.
        let cb = () => {
            // FIXME uhh
            if (this.editor.library)
            for (let [path, asset] of Object.entries(this.editor.library.assets)) {
                let li = this.item_index[path];
                if (li) {
                    li.classList.toggle('--missing', ! asset.exists);
                    li.classList.toggle('--unused', ! asset.used);
                }
            }
            setTimeout(cb, 2000);
        };
        cb();
    }

    refresh_dom() {
        this.list.textContent = '';
        this.item_index = {};

        let paths = Object.keys(this.editor.library.assets);
        human_friendly_sort(paths);
        console.log("refreshing dom with paths", paths);

        for (let path of paths) {
            let asset = this.editor.library.assets[path];
            let li = make_element('li', null, path);
            if (! asset.exists) {
                li.classList.add('--missing');
            }
            if (! asset.used) {
                li.classList.add('--unused');
            }
            this.list.appendChild(li);
            this.item_index[path] = li;
        }
    }
}


class RolesPanel extends Panel {
    constructor(editor, container) {
        super(editor, container);

        this.list = this.body.querySelector('.gleam-editor-roles');
        this.role_editors = [];
        this.role_to_editor = new Map();

        // Create "add" buttons
        for (let role_editor_type of ROLE_EDITOR_TYPES) {
            let button = make_element('button', null, `new ${role_editor_type.role_type_name}`);
            button.addEventListener('click', ev => {
                // Generate a name
                let n = 1;
                let name;
                while (true) {
                    name = `${role_editor_type.role_type_name} ${n}`;
                    if (this.editor.script.role_index[name] === undefined) {
                        break;
                    }
                    n++;
                }

                let role = role_editor_type.create_role(name);
                this.editor.script.add_role(role);
                // FIXME do in an event handler
            });
            this.body.appendChild(button);
        }
    }

    add_role(role) {
        let role_editor_type = ROLE_EDITOR_TYPE_MAP.get(role.constructor);
        let role_editor = new role_editor_type(this.editor, role);
        this.role_editors.push(role_editor);
        this.role_to_editor.set(role, role_editor);
        this.list.appendChild(role_editor.container);
    }

    load_script(script, director) {
        this.role_editors = [];
        this.role_to_editor.clear();
        // FIXME naturally this happens AFTER the Editor rudely injects the new roles into us
        this.list.textContent = '';

        // Load roles from the script
        for (let role of script.roles) {
            this.add_role(role);
        }

        // FIXME do i need to drop the old event handlers?
        script.intercom.addEventListener('gleam-role-added', ev => {
            this.add_role(ev.detail.role);
        });
    }
}


// Panel containing the script, which is a list of steps grouped into beats
class ScriptPanel extends Panel {
    constructor(editor, container) {
        super(editor, container);

        this.beats_list = this.container.querySelector('.gleam-editor-beats-list');
        this.step_elements = [];
        this.step_to_element = new WeakMap();
        this.element_to_step = new WeakMap();
        // State of a step drag happening anywhere in the editor; initialized
        // in begin_step_drag
        this.drag = null;

        // TODO when this panel is first created, /nothing/ is loaded, but that
        // won't be true after a moment...  is that concerning at all?  i am
        // not even sure

        // Add some nav controls
        // FIXME disable these when on first/last step, and make sure they don't trigger even if clicked somehow
        let button = make_element('button');
        button.innerHTML = svg_icon_from_path("M 1,8 H 14 M 6,3 L 1,8 L 6,13");
        button.addEventListener('click', ev => {
            this.editor.player.director.jump(this.editor.player.director.cursor - 1);
        });
        this.nav.appendChild(button);
        button = make_element('button');
        button.innerHTML = svg_icon_from_path("M 1,8 H 14 M 10,3 L 15,8 L 10,13");
        button.addEventListener('click', ev => {
            this.editor.player.director.jump(this.editor.player.director.cursor + 1);
        });
        this.nav.appendChild(button);

        // Create the per-beat toolbar
        // TODO i don't super understand how this should work, or how per-step should work either, ugh
        this.beat_toolbar = make_element('nav', 'gleam-editor-beat-toolbar');
        button = make_element('button', null, 'jump');
        let hovered_beat_position = null;
        button.addEventListener('click', ev => {
            this.editor.script.jump(hovered_beat_position);
        });
        this.beat_toolbar.appendChild(button);
        this.body.appendChild(this.beat_toolbar);

        // FIXME this is a bit ugly still
        this.step_toolbar = make_element('nav', 'gleam-editor-step-toolbar');
        let hovered_step_el = null;
        button = make_element('button');
        button.innerHTML = svg_icon_from_path("M 2,2 L 14,2 L 12,14 L 4,14 L 2,2 M 6,2 L 7,14 M 10,2 L 9,14");
        button.addEventListener('click', ev => {
            if (hovered_step_el) {
                // FIXME clicking this twice doesn't work if you don't move the mouse again, oops
                this.editor.script.delete_step(this.element_to_step.get(hovered_step_el));
                hovered_step_el = null;
            }
        });
        this.step_toolbar.append(button);
        this.body.append(this.step_toolbar);

        // FIXME hide on mouseout too (but that's goofy)
        this.beats_list.addEventListener('mouseover', ev => {
            let step_el = ev.target.closest('.gleam-editor-step');
            if (step_el) {
                // FIXME more awful offset traversal math
                // FIXME skip this if this is already the step
                this.step_toolbar.style.transform = `translateY(${step_el.offsetTop + step_el.offsetParent.offsetTop}px)`;
                hovered_step_el = step_el;
            }
            else {
                // TODO and hide toolbar
                hovered_step_el = null;
            }
        });

        // Double-click to edit an argument
        // FIXME this is a bit rude, seeing as double-click is useful for text
        this.beats_list.addEventListener('contextmenu', ev => {
            let arg = ev.target.closest('.gleam-editor-arg');
            if (! arg)
                return;

            ev.stopPropagation();
            ev.preventDefault();

            let step_element = arg.closest('.gleam-editor-step');
            let step = this.element_to_step.get(step_element);
            let i = parseInt(arg.getAttribute('data-arg-index'), 10);
            let arg_def = step.type.args[i];
            let arg_type = STEP_ARGUMENT_TYPES[arg_def.type];
            let promise = arg_type.edit(arg, step.args[i], step, ev);
            // FIXME ahh you could conceivably double-click on the same element again if it edits inline, like prose does...
            promise.then(new_value => {
                step.args[i] = new_value;
                arg_type.update(arg, new_value);
                // FIXME above could be a step-updated event handler?
                this.editor.script.update_steps(step);
            }, () => {
                // Smother rejection so it doesn't go to the console
            });
        });

        this.beats_list.addEventListener('click', ev => {
            // TODO do step selection too
            let beat_li = ev.target.closest('.gleam-editor-beats-list > li');
            if (! beat_li)
                return;

            let position = 0;
            while (beat_li.previousElementSibling) {
                position++;
                beat_li = beat_li.previousElementSibling;
            }
            if (position !== this.selected_beat_index) {
                // TODO hmm, this assumes the script is working atm
                // TODO this is also quite a lot of dots
                this.editor.player.director.jump(position);
            }
        });

        // Allow dragging steps to rearrange them
        this.beats_list.addEventListener('dragstart', ev => {
            ev.dataTransfer.dropEffect = 'move';  // FIXME?  should be set in enter/over?
            ev.dataTransfer.setData('text/plain', null);
            let step_el = ev.target.closest('.gleam-editor-step');
            if (step_el) {
                let step = this.element_to_step.get(step_el);
                this.begin_step_drag(step);
                step_el.classList.add('--dragged');
            }
        });
        // Note that this fires on the original target, and NOT if the original node is moved???
        this.beats_list.addEventListener('dragend', e => {
            // FIXME return dragged step to where it was, if it was dragged from the step list in the first place
            this.end_step_drag();
        });

        // Set up dropping a step into the script (either from elsewhere in the
        // script, or from a role)
        // Fires repeatedly on a valid drop target, which FIXME I thought was determined by dragenter???
        this.container.addEventListener('dragover', ev => {
            // Only listen to drags of steps
            if (this.drag === null) {
                return;
            }
            ev.preventDefault();

            // GOAL: Find where the step should be inserted based on the mouse
            // position, or in other words, which step the mouse is aiming at.

            // If there are no steps, there's nothing to do: a new step can
            // only be inserted at position 0.
            let position;
            if (this.step_elements.length === 0) {
                position = 0;
            }
            else {
                // If the mouse is already over a step, we're basically done.
                let cy = ev.clientY;
                let pointed_step_element = ev.target.closest('.gleam-editor-step');
                if (pointed_step_element) {
                    let rect = pointed_step_element.getBoundingClientRect();
                    let pointed_step = this.element_to_step.get(pointed_step_element);
                    position = pointed_step.index;
                    if (cy > (rect.top + rect.bottom) / 2) {
                        position++;
                    }
                    console.log(position, pointed_step, cy > (rect.top + rect.bottom) / 2);
                }
                else {
                    // The mouse is outside the list.  Resort to a binary
                    // search of the steps' client bounding rects, which are
                    // relative to the viewport, which is pretty appropriate
                    // for a visual effect like drag and drop.
                    let l = this.step_elements.length;
                    let a = 0;
                    let b = l;
                    while (a < b) {
                        let n = Math.floor((a + b) / 2);
                        let rect = this.step_elements[n].getBoundingClientRect();
                        // Compare to the vertical midpoint of the step: if
                        // we're just above that, we should go before that step
                        // and take its place; otherwise, we should go after it
                        if (cy < (rect.top + rect.bottom) / 2) {
                            b = n;
                        }
                        else {
                            a = n + 1;
                        }
                    }
                    position = a;
                }
            }

            this.drag.position = position;

            // Ensure the caret is in the step container, and adjust its position
            // FIXME position changes a bit depending on whether the new step pauses or not
            let caret = this.drag.caret;
            if (! caret.parentNode) {
                this.body.appendChild(caret);
                caret.style.left = `${this.beats_list.offsetLeft}px`;
                caret.style.width = `${this.beats_list.offsetWidth}px`;
            }

            let caret_y;
            let caret_mid_beat = false;
            if (this.step_elements.length === 0) {
                caret_y = 0;
            }
            else if (position >= this.step_elements.length) {
                let last_step_element = this.step_elements[this.step_elements.length - 1];
                caret_y = last_step_element.offsetTop + last_step_element.offsetHeight;
            }
            else {
                // Position it at the top of the step it would be replacing
                caret_y = this.step_elements[position].offsetTop;
                // If this new step would pause, and the step /behind/ it
                // already pauses, then the caret will be at the end of a beat
                // gap.  Move it up to appear in the middle of the beat.
                if (position > 0 &&
                    this.drag.step.type.pause &&
                    this.editor.script.steps[position - 1].type.pause)
                {
                    caret_mid_beat = true;
                }
            }
            caret.style.top = `${caret_y + this.beats_list.offsetTop}px`;
            caret.classList.toggle('--mid-beat', caret_mid_beat);
        });
        // Fires when leaving a valid drop target (but actually when leaving
        // any child of it too, ugh?  XXX check on this)
        this.container.addEventListener('dragleave', e => {
            if (! this.drag) {
                return;
            }
            // FIXME ah this doesn't always work, christ
            if (e.target !== e.currentTarget) {
                return;
            }

            // Hide the caret and clear out the step position if we're not
            // aiming at the step list
            this.drag.position = null;
            this.drag.caret.remove();
        });
        this.container.addEventListener('drop', e => {
            if (! this.drag) {
                return;
            }

            let step = this.drag.step;
            let position = this.drag.position;
            // Dropping onto nothing, or into the same spot, is a no-op
            if (position === null || position === step.index) {
                return;
            }

            e.preventDefault();

            // End the drag first, to get rid of the caret which kinda fucks
            // up element traversal
            this.end_step_drag();

            // If this step was already in the list, remove it first!
            if (this.step_to_element.has(step)) {
                // This also shifts the position one back, if its new position
                // is later
                if (position > step.index) {
                    position--;
                }
                this.editor.script.delete_step(step);
            }

            this.editor.script.insert_step(step, position);
        });
        // Cancel the default behavior of any step drag that makes its way to
        // the root; otherwise it'll be interpreted as a navigation or
        // something
        document.documentElement.addEventListener('drop', ev => {
            if (this.drag) {
                ev.preventDefault();
                this.end_step_drag();
            }
        });
    }

    load_script(script, director) {
        // Recreate the step list from scratch
        this.beats_list.textContent = '';
        this.step_elements = [];
        this.step_to_element = new WeakMap();
        this.element_to_step = new WeakMap();
        for (let [b, beat] of script.beats.entries()) {
            let group = make_element('li');
            for (let i = beat.first_step_index; i <= beat.last_step_index; i++) {
                let step = script.steps[i];
                let role_editor = this.editor.roles_panel.role_to_editor.get(step.role);
                let element = role_editor.make_step_element(step);
                this.step_elements.push(element);
                this.step_to_element.set(step, element);
                this.element_to_step.set(element, step);
                group.append(element);

                // FIXME do this live, and probably in the script panel i assume, and only when steps are affected...?
                if (i === 6) {
                    element.append(make_element('div', '-error', "Has no effect because a later step in the same beat overwrites it!"));
                }
            }
            this.beats_list.append(group);
        }

        // Attach to the Director
        // TODO do we need to remove the old listener from the previous director??
        director.intercom.addEventListener('gleam-director-beat', ev => {
            this.select_beat(ev.detail);
        });
        this.selected_beat_index = null;

        // Attach to the Script
        script.intercom.addEventListener('gleam-step-inserted', ev => {
            this._insert_step_element(ev.detail.step, ev.detail.split_beat);
        });
        script.intercom.addEventListener('gleam-step-deleted', ev => {
            // TODO need to ensure, somehow, that this one happens /before/ the editor one (which doesn't exist yet)
            let step = ev.detail.step;
            let element = this.step_to_element.get(step);
            this.step_to_element.delete(step);
            this.element_to_step.delete(element);
            this.step_elements.splice(ev.detail.index, 1);

            let group = element.parentNode;
            element.remove();
            if (group.children.length === 0) {
                group.remove();
            }
            else if (ev.detail.merged_beat) {
                let beat0 = this.beats_list.children[ev.detail.beat_index];
                let beat1 = this.beats_list.children[ev.detail.beat_index + 1];
                while (beat1.firstChild) {
                    beat0.appendChild(beat1.firstChild);
                }
                beat1.remove();
            }
        });
    }

    create_twiddle_footer() {
        // FIXME uggh ScriptPanel is created before the role editors (because those are made when loading a script).  this is dumb
        // Create the debug twiddle viewer
        this.footer = this.container.querySelector('section > footer');
        this.twiddle_debug_elements = new Map();  // Role => { twiddle => <dd> }
        // TODO need to update this when a role is added too, god christ ass.  or when a script is loaded, though it happens to work here
        for (let role_editor of this.editor.roles_panel.role_editors) {
            let box = make_element('div', 'gleam-editor-script-role-state');
            box.classList.add(role_editor.CLASS_NAME);
            this.footer.append(box);

            let dl = make_element('dl');
            box.append(
                make_element('h2', null, role_editor.role.name),
                dl);
            let dd_map = {};
            for (let key of Object.keys(role_editor.role.TWIDDLES)) {
                // TODO display name?  maybe not
                let dd = make_element('dd');
                dd_map[key] = dd;
                dl.append(make_element('dt', null, key), dd);
            }
            this.twiddle_debug_elements.set(role_editor.role, dd_map);
        }
    }

    select_beat(index) {
        if (index < 0 || index >= this.editor.script.beats.length) {
            index = null;
        }
        if (index === this.selected_beat_index)
            return;

        if (this.selected_beat_index !== null) {
            this.beats_list.children[this.selected_beat_index].classList.remove('--current');
        }
        this.selected_beat_index = index;
        if (this.selected_beat_index !== null) {
            let li = this.beats_list.children[this.selected_beat_index]
            li.classList.add('--current');
            li.scrollIntoView({ block: 'nearest' });

            // Update the debug panel
            let beat = this.editor.script.beats[this.selected_beat_index];
            for (let [role, state] of beat.states) {
                let dd_map = this.twiddle_debug_elements.get(role);
                for (let [key, value] of Object.entries(state)) {
                    dd_map[key].textContent = value;
                }
            }
        }
    }

    _insert_step_element(step, split_beat) {
        let element = this.step_to_element.get(step);
        if (! element) {
            let role_editor = this.editor.roles_panel.role_to_editor.get(step.role);
            element = role_editor.make_step_element(step);
            this.step_to_element.set(step, element);
            this.element_to_step.set(element, step);
        }
        this.step_elements.splice(step.index, 0, element);

        // FIXME SIGH the case of the very first step, or adding to the end which is maybe equivalent

        if (step.beat_index >= this.beats_list.children.length) {
            let new_group = make_element('li');
            new_group.append(element);
            this.beats_list.append(new_group);
        }
        else {
            let group = this.beats_list.children[step.beat_index];
            // Note: This needs + 1 because the step is already in the list
            let bumped_element = this.step_elements[step.index + 1];
            // If this is the last step in a beat, bumped_element is undefined
            // and this becomes an append
            group.insertBefore(element, bumped_element);

            if (split_beat) {
                let new_group = make_element('li');
                this.beats_list.insertBefore(new_group, group.nextSibling);
                while (element.nextSibling) {
                    new_group.appendChild(element.nextSibling);
                }
            }
        }
    }

    begin_step_drag(step) {
        this.drag = {
            // Step being dragged
            step: step,
            // Element showing where the step will be inserted
            caret: make_element('hr', 'gleam-editor-step-caret'),
            // Existing step being dragged over
            target: null,
            // Position to insert the step
            position: null,
        };
    }

    end_step_drag() {
        if (! this.drag)
            return;

        this.drag.caret.remove();

        let element = this.step_to_element.get(this.drag.step);
        if (element) {
            element.classList.remove('--dragged');
        }

        this.drag = null;
    }
}


class Editor {
    constructor(container) {
        // FIXME inject_into method or something?  separate view?
        // FIXME wait we don't even use this, we claim the whole body!
        this.container = container;

        // Set by load_script, called after all this setup
        this.script = null;
        this.library = null;
        this.player = null;

        // Assets panel
        this.assets_panel = new AssetsPanel(this, document.getElementById('gleam-editor-assets'));

        // Roles panel
        this.roles_panel = new RolesPanel(this, document.getElementById('gleam-editor-roles'));

        this.script_panel = new ScriptPanel(this, document.getElementById('gleam-editor-script'));

        // Start with an empty script
        this.load_script(new Script, new NullAssetLibrary);
    }

    // TODO this obviously needs ui, some kinda "i'm downloading" indication, etc
    load_script(script, library) {
        if (this.player) {
            // TODO explicitly ask it to destroy itself?  dunno what that would do though
            this.player.detach();
            this.player = null;
        }

        this.script = script;
        this.library = library;
        this.player = new Player(this.script, library);
        this.player.inject(document.querySelector('#gleam-editor-player .gleam-editor-panel-body'));

        this.assets_panel.refresh_dom();

        // XXX? Roles must be loaded FIRST, so the script panel can reference them in steps
        this.roles_panel.load_script(script, this.player.director);

        this.script_panel.load_script(script, this.player.director);
        this.script_panel.create_twiddle_footer();
        // XXX hmm, very awkward that the ScriptPanel can't do this itself because we inject the step elements into it; maybe fix that
        this.script_panel.select_beat(this.player.director.cursor);

        // Finally, set the player going
        // TODO this seems, counterintuitive?  and there's no way to pause it atm?  but updates don't happen without it.
        this.player.play();
    }

    set_library(library) {
        let old_library = this.library;
        this.library = library;
        library.inherit_uses(old_library);

        // FIXME ahahaha, the Entry library has an async constructor, fuck!!
        setTimeout(() => {
            this.assets_panel.refresh_dom();
        }, 500);

        // Tell role editors to re-fetch assets
        // FIXME this should be on the roles panel, but also, i need a way to inform it of single asset changes too
        for (let role_editor of this.roles_panel.role_editors) {
            role_editor.update_assets();
        }

        // FIXME tell actors to re-fetch assets (aaa)
    }
}

// FIXME give a real api for this.  question is, how do i inject into the editor AND the player
window.addEventListener('load', e => {
    // FIXME does the editor really take over just from being created?
    let editor = new Editor(document.querySelector('.gleam-editor'));
    //return;

    // NOTE TO FUTURE GIT SPELUNKERS: sorry this exists only on my filesystem and points to all the old flora vns lol
    let root = 'res/prompt2-itchyitchy-final/';
    let root_url = new URL(root, document.location);
    let library = new RemoteAssetLibrary(root_url);
    let xhr = new XMLHttpRequest;
    xhr.addEventListener('load', ev => {
        // FIXME handle errors yadda yadda
        let script = Script.from_legacy_json(JSON.parse(xhr.responseText));
        editor.load_script(script, library);
    });
    // XXX lol
    xhr.open('GET', new URL('script.json', root_url));
    xhr.send();
});

return {
    Script: Script,
    Player: Player,
    Editor: Editor,
};
})(window);
