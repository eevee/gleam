// Very high level:
// This isn't really a visual novel engine.  It's just an HTML state engine.
// Each step is a set of states of various components (e.g., "the dialogue box
// is showing this text" or "this background is visible"), and all the engine
// actually does is adjust the states as appropriate.  Even the transitions are
// all CSS.

window.Gleam = (function() {
"use strict";
let xxx_global_root;

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

class Actor {
    constructor() {
    }

    static from_legacy_json(json) {
        return new this();
    }

    make_initial_state() {
        let state = {};
        console.log(this);
        for (let [key, twiddle] of Object.entries(this.TWIDDLES)) {
            state[key] = twiddle.initial;
        }
        return state;
    }

    build_into(container) {}

    update(dt) {}

    // Return false to interrupt the advance
    advance() {}

    apply_state(state) {}
}
Actor.prototype.TWIDDLES = {};
// Must also be defined on subclasses:
Actor.STEP_TYPES = null;
Actor.LEGACY_JSON_ACTIONS = null;


// Actors are controlled by Steps
class Step {
    constructor(actor, type, args) {
        this.actor = actor;
        this.type = type;
        this.args = args;
    }

    update_state(builder) {
        let debug = [];
        for (let twiddle_change of this.type.twiddles) {
            let actor = this.actor;
            if (twiddle_change.delegate) {
                actor = actor[twiddle_change.delegate];
            }

            let value = twiddle_change.value;
            if (twiddle_change.arg !== undefined) {
                value = this.args[twiddle_change.arg];
            }

            builder.set_twiddle(actor, twiddle_change.key, value);
            debug.push(`${twiddle_change.key} => ${value}`);
        }
        console.log("updating state for", this.actor.constructor.name, debug.join(", "));
    }
}


class Stage extends Actor {
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


class Curtain extends Actor {
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

// do i need actortemplate?
// there's an actor, which defines some static bits like "what tracks are in a jukebox"
// but it also has html and current state, which are /optional/...
// but is there any reason to not have those things?  even in the editor?

// an actor (in the instantiated sense) has actions, which change its state
// but they should be able to switch from one completely arbitrary state to another
// how did i do this before...
// ok so i just copied events forward across steps, fired them all, and made them no-ops
// but what if there are multiple states you fool
// i think what should happen is that an actor should be able to express its current state at a given step in terms of a small json-compatible state table, and THAT gets (shallow) copied forwards until it changes
// this also avoids the question of what happens at the beginning: actors can just expose a starting state
// this reduces "actions" to state twiddles under the hood!
// EXCEPT for pausing, which is specifically a property of the action and affects the stage itself rather than the actor
// also propagation

class Jukebox extends Actor {
    play(track_name) {
        // TODO
    }
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

class PictureFrame extends Actor {
    constructor(position) {
        super();
        this.poses = {};
        this.active_pose_name = null;
    }

    static from_legacy_json(json) {
        let pf = new this(json.position);
        for (let [key, value] of Object.entries(json.views)) {
            pf.add_pose(key, value);
        }
        return pf;
    }

    // TODO don't really love "view" as the name for this
    add_pose(name, tmp_image_url) {
        this.poses[name] = [{ url: tmp_image_url }];
    }

    build_into(container) {
        let element = make_element('div', 'gleam-actor-pictureframe');
        // FIXME add position class
        this.element = element;
        container.appendChild(element);

        let pose_elements = {};
        let img_promises = [];
        for (let [pose_name, frames] of Object.entries(this.poses)) {
            let frame_elements = pose_elements[pose_name] = [];
            for (let frame of frames) {
                let image = make_element('img');
                // Bind the event handler FIRST -- if the image is cached, it
                // might load instantly!
                img_promises.push(promise_event(image, 'load', 'error'));
                // FIXME who controls urls, eh?  seems like it should go through the script, which we don't have access to
                image.setAttribute('src', xxx_global_root + '/' + frame.url);
                image.setAttribute('data-pose-name', pose_name);
                // FIXME animation stuff $img.data 'delay', frame.delay or 0
                element.appendChild(image);
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
        return Promise.all(img_promises);
    }

    //add_animation: (name, frames) ->
    //    @poses[name] = frames

    apply_state(state) {
        let current_state = this.current_state || this.make_initial_state();

        if (state.pose !== current_state.pose) {
            if (state.pose === null) {
                this.disable();
            }
            else {
                this.show(state.pose);
            }
        }

        this.current_state = state;
    }

    show(pose_name) {
        let pose = this.poses[pose_name];
        if (! pose)
            // FIXME actors should have names
            throw new Error(`No such pose ${pose_name} for this picture frame`);

        this.element.classList.remove('-immediate')
        // TODO? $el.css marginLeft: "#{offset or 0}px"

        if (pose_name === this.active_pose_name)
            return;
        if (this.active_pose_name) {
            // FIXME do every frame's element i guess
            this.poses[this.active_pose_name].element.classList.remove('--visible');
        }
        this.active_pose_name = pose_name;

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

        this.active_pose_name = null;

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
            type: 'key',
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


// FIXME do not love this hierarchy, the picture frame should very be its own thing
class Character extends PictureFrame {
    constructor(position) {
        super(position);

        // Character delegates to a dialogue box, which must be assigned here, ASAP
        // TODO need editor ui for this!
        this.dialogue_box = null;
    }

    static from_legacy_json(json) {
        json.views = json.poses || {};
        let actor = super.from_legacy_json(json);
        actor.name = json.name;
        actor.color = json.color;
        return actor;
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
        }],
    },
};
Character.LEGACY_JSON_ACTIONS = {
    say: ["say", 'text'],
    pose: ["pose", 'view'],
    leave: ["leave"],
};

class DialogueBox extends Actor {
    constructor() {
        super();

        this.scroll_timeout = null;
        this.element = null;
        this.letter_elements = [];
        // One of:
        // done -- there is no text left to display
        // waiting -- there was too much text to fit in the box and we are now waiting on a call to advance() to show more
        // fill -- this is dumb actually
        // scrolling -- we are actively showing text
        this.scroll_state = 'done';
        // Amount of (extra) time to wait until resuming scrolling
        this.delay = 0;
    }

    build_into(container) {
        // XXX what happens if you try to build twice?
        this.element = make_element('div', 'gleam-actor-dialoguebox');
        container.appendChild(this.element);
    }

    apply_state(state) {
        if (state.phrase) {
            this.say(state.phrase);
        }
        else {
            this.hide();
        }
    }

    say(text) {
        // TODO
        let speaker;

        if (text === "") {
            // TODO all the speaker handling is hacky ugh.  this is just to
            // allow setting the class before actually showing any text, to fix
            // the transition on the terminal in scrapgoats
            if (speaker && speaker.position) {
                this.element.setAttribute('data-position', speaker.position);
            }
            this.hide();
            return;
        }
        this.element.classList.remove('--hidden');

        // Create the dialogue DOM
        if (this.phrase_element) {
            this.element.removeChild(this.phrase_element);
        }
        this._build_phrase_dom(text);

        // Purge old speaker tags
        // TODO man this code all sucks; stick in separate method plz
        // TODO this isn't gonna fly anyway really
        let keep_speaker = (speaker === this.speaker);

        if (! keep_speaker && this.speaker_element) {
            let old_speaker_element = this.speaker_element;
            this.speaker_element = null;
            old_speaker_element.classList.remove('-active');
            promise_transition(old_speaker_element).then(() => {
                old_speaker_element.parentNode.removeChild(old_speaker_element);
            });
        }

        // TODO super weird bug: set the transition time to something huge like
        // 10s and mash arrow keys mid-transition and sometimes you end up with
        // dialogue attributed to the wrong speaker!
        if (keep_speaker) {
            // do nothing
        }
        else if (speaker && speaker.name) {
            /* TODO make all this stuff work
            rgb_color = normalize_color speaker.color
            background_color = rgb_color.replace /^rgb([(].+)[)]$/, "rgba$1, 0.8)"

            // TODO need to reset this when anything else happens ugh
            this.element.css
                backgroundColor: background_color
                color: speaker.color

            $speaker = $('<div>',
                class: 'cutscene--speaker'
                text: speaker.name
                css: backgroundColor: speaker.color
                data: speaker: speaker
            )
            $speaker.attr 'data-position', speaker.position
            this.element.append $speaker
            // Force recompute or this won't actually transition anything
            $speaker[0].offsetTop
            $speaker.addClass '-active'
            */
        }
        else {
            this.element.style.backgroundColor = '';
            this.element.style.color = '';
            this.element.removeAttribute('data-position');
        }
        if (speaker && speaker.position) {
            this.element.setAttribute('data-position', speaker.position);
        }

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
            letter.classList.add('--hidden');
        }

        // TODO do something with old one...?  caller does atm, but
        this.phrase_element = make_element('div', '-phrase');
        this.phrase_element.appendChild(target);
        this.element.appendChild(this.phrase_element);
        this.letter_elements = letters;
        this.cursor = -1;
    }

    _start_scrolling() {
        // Start scrolling the current text into view, if applicable.
        //
        // Returns true iff there was any text to display.
        if (this.scroll_state === 'done') {
            // Nothing left to do!
            return false;
        }

        // If the scroll is starting midway through the text (presumably, at
        // the start of a line!), slide the text up so the next character is at
        // the top of the text box
        // TODO hm, actually, what if it's /not/ at the start of a line?
        // TODO should there be better text scrolling behavior?
        // TODO should we be a little clever and vertically center the text
        // within the box?  it's supposed to be exactly 3 lines but alternate
        // fonts and whatnot might affect that...  er, but, they would also
        // defeat anything i could do with line-height, hrm.  i do have the
        // full layout set in stone ahead of time, so i could calculate ALL the
        // chunks upfront, and skip some of this janky math as well?
        // TODO what if the audience does a text zoom at some point?
        let first_letter_y = this.letter_elements[0].offsetTop;
        let next_letter_y = this.letter_elements[this.cursor + 1].offsetTop;
        let dy = next_letter_y - first_letter_y;
        this.phrase_element.style.transform = `translateY(-${dy}px)`;

        // Grab the available height for the phrase box; if it fills up, the
        // audience needs to advance to see more
        let phrase_height = parseInt(window.getComputedStyle(this.element).height, 10);
        this.phrase_bottom = phrase_height + dy;

        this.scroll_state = 'scrolling';
    }

    update(dt) {
        if (this.scroll_state === 'done') {
            return;
        }

        // Handle delays
        if (this.delay > 0) {
            this.delay = Math.max(0, this.delay - dt);
            return;
        }

        // Reveal as many letters as appropriate
        while (true) {
            if (this.cursor + 1 >= this.letter_elements.length) {
                this.scroll_state = 'done';
                return;
            }

            let letter = this.letter_elements[this.cursor + 1];

            // TODO this doesn't work if we're still in the middle of loading oops
            // TODO i don't remember what the above comment was referring to
            // If we ran out of room, stop here and wait for an advance
            // XXX wait a second, shouldn't this use client bounding rect since it's a purely visual thing anyway
            if (letter.offsetTop + letter.offsetHeight > this.phrase_bottom) {
                this.scroll_state = 'waiting';
                return;
            }

            letter.classList.remove('--hidden');
            this.cursor++;

            if (this.scroll_state !== 'fill') {
                if (letter.textContent === "\f") {
                    this.delay = 0.5;
                }

                break;
            }
        }
    }

    advance() {
        // Called when the audience tries to advance to the next beat.  Does a
        // couple interesting things:
        // 1. If the text is still scrolling, fill the textbox instantly.
        // 2. If the textbox is full but there's still more text to show,
        // clear it and continue scrolling.
        // In either case, the advancement is stopped.

        // TODO if there's only one character left, maybe don't count this as a fill?
        // TODO i don't remember what that meant either  :(

        if (this.scroll_state === 'scrolling') {
            // Case 1: Still running -- update state so the next update knows
            // to fill
            this.paused = false;
            this.scroll_state = 'fill';
            // TODO just fill it here dumbass
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
DialogueBox.prototype.TWIDDLES = {
    phrase: {
        initial: null,
        propagate: null,
    },
};
DialogueBox.STEP_TYPES = {};
DialogueBox.LEGACY_JSON_ACTIONS = {};


class BeatBuilder {
    // A beat is the current state of all actors in a script, compiled from a
    // contiguous sequence of steps and generally followed by a pause.  It
    // describes where everyone is on stage while a line of dialogue is being
    // spoken, for example.  This type helps construct beats from steps.
    constructor(actors) {
        // Map of actor => states
        this.states = new Map();
        // Which actors have had steps occur since the previous beat
        this.dirty = new Set();

        // Populate initial states
        for (let [name, actor] of Object.entries(actors)) {
            this.states.set(actor, actor.make_initial_state());
        }
    }

    add_step(step) {
        step.update_state(this);
    }

    set_twiddle(actor, key, value) {
        let state = this.states.get(actor);

        // If this actor hasn't had a step yet this beat, clone their state
        if (! this.dirty.has(actor)) {
            let new_state = {};
            for (let [key, value] of Object.entries(state)) {
                let twiddle = actor.TWIDDLES[key];
                if (twiddle.propagate === undefined) {
                    // Keep using the current value
                    new_state[key] = value;
                }
                else {
                    // Revert to the given propagate value
                    new_state[key] = twiddle.propagate;
                }
            }
            state = new_state;
            this.states.set(actor, state);
            this.dirty.add(actor);
        }

        state[key] = value;
    }

    end_beat() {
        // End the current beat, returning it, and start a new one
        let beat = this.states;
        this.states = new Map(this.states);
        this.dirty.clear();
        return beat;
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
        this.actors = {
            stage: new Stage(),
        };

        this.steps = [
            [this.actors.__dialogue__, 'say', "The quick brown fox jumps over the lazy dog's back."],
            [this.actors.__dialogue__, 'say', "Jackdaws love my big sphinx of quartz."],
        ];

        this.cursor = 0;

        this.set_steps([]);
    }

    static from_legacy_json(json) {
        let script = new Script();
        script._load_legacy_json(json);
        return script;
    }
    _load_legacy_json(json) {
        // Legacy JSON has an implicit dialogue box
        let dialogue_box = new DialogueBox();
        this.actors['__dialogue__'] = dialogue_box;

        // FIXME ???  how do i do registration, hmm
        let ACTOR_TYPES = {
            curtain: Curtain,
            jukebox: Jukebox,
            spot: PictureFrame,
            character: Character,
        };

        for (let [name, actor_def] of Object.entries(json.actors)) {
            let type = ACTOR_TYPES[actor_def.type];
            if (! type) {
                throw new Error(`No such actor type: ${actor_def.type}`);
            }

            this.actors[name] = type.from_legacy_json(actor_def);
            if (actor_def.type === 'character') {
                // JSON characters implicitly use the implicit dialogue box
                // TODO i wonder if this could be in Character.from_legacy_json
                this.actors[name].dialogue_box = dialogue_box;
            }
        }

        let steps = [];
        for (let json_step of json.script) {
            if (! json_step.actor) {
                // FIXME special actions like roll_credits
                if (json_step.action == 'pause') {
                    steps.push(new Step(this.actors.stage, Stage.STEP_TYPES.pause, []));
                }
                continue;
            }

            let actor = this.actors[json_step.actor];
            let actor_type = actor.constructor;
            let [step_key, ...arg_keys] = actor_type.LEGACY_JSON_ACTIONS[json_step.action];
            let step_type = actor_type.STEP_TYPES[step_key];
            if (! step_type) {
                throw new Error(`No such action '${json_step.action}' for actor '${json_step.actor}'`);
            }
            steps.push(new Step(actor, actor_type.STEP_TYPES[step_key], arg_keys.map(key => json_step[key])));
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

        // Consolidate steps into beats -- maps of actor => state
        this.beats = [];
        let builder = new BeatBuilder(this.actors);

        for (let step of this.steps) {
            builder.add_step(step);

            if (step.type.pause) {
                this.beats.push(builder.end_beat());
            }
        }

        // TODO only if last step wasn't a pause probably.  or maybe i should push as i go.  but that doesn't work if the last step IS a pause.
        this.beats.push(builder.end_beat());

        for (let [name, actor] of Object.entries(this.actors)) {
            console.log("---", name, actor.constructor.name, "---");
            let prev = null;
            for (let [i, beat] of this.beats.entries()) {
                let state = beat.get(actor);
                if (state !== prev) {
                    console.log(i, state);
                    prev = state;
                }
            }
        }
    }

    jump(beat_index) {
        this.cursor = beat_index;
        let beat = this.beats[this.cursor];

        // TODO ahh can the action "methods" return whether they pause?

        for (let [actor, state] of beat) {
            console.log(actor.constructor.name, actor, state);
            actor.apply_state(state);
        }

        if (this.xxx_hook) {
            this.xxx_hook.on_beat();
        }
    }

    advance() {
        console.log("ADVANCING");

        // Some actors (namely, dialogue box) can do their own waiting for an
        // advance, so consult them all first, and eject if any of them say
        // they're still busy
        if (this.cursor >= 0) {
            let busy = false;
            for (let actor of Object.values(this.actors)) {
                if (actor.advance() === false) {
                console.log("AH, BUSY", actor);
                    busy = true;
                }
            }
            if (busy) {
                return;
            }
        }

        // If we're still here, advance to the next beat
        if (this.cursor >= this.beats.length)
            return;

        this.jump(this.cursor + 1);
    }

    update(dt) {
        for (let [name, actor] of Object.entries(this.actors)) {
            actor.update(dt);
        }
    }
}

// FIXME should the script be static and the player contains all the mutable state??  and, same question about actors i suppose?
class Player {
    constructor(script, container) {
        this.script = script;
        this.container = container;

        for (let [name, actor] of Object.entries(this.script.actors)) {
            // FIXME do something with returned promises
            actor.build_into(this.container);
        }

        this.script.advance();
        // TODO should make our own sub-container so when we go away (and delete the dom), the events go away too
        this.container.addEventListener('click', e => {
            this.script.advance();
        });

        this.playing = false;
    }

    update(dt) {
        this.script.update(dt);
    }

    play() {
        this.playing = true;
        this.last_timestamp = performance.now();

        this.on_frame_bound = this.on_frame.bind(this);
        window.requestAnimationFrame(this.on_frame_bound);
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

// -----------------------------------------------------------------------------
// Step argument configuration

const STEP_ARGUMENT_TYPES = {
    prose: {
        build(arg_def, value) {
            return make_element('div', 'gleam-editor-arg-prose', value);
        },
    },
};


function make_sample_step_element(actor_editor, step_type) {
    let el = make_element('div', 'gleam-editor-step');
    el.classList.add(actor_editor.CLASS_NAME);
    // FIXME how does name update?  does the actor editor keep a list, or do these things like listen for an event on us?
    el.appendChild(make_element('div', '-what', step_type.display_name));
    for (let arg_def of step_type.args) {
        el.appendChild(make_element('div', '-how', `[${arg_def.display_name}]`));
    }
    el.setAttribute('draggable', 'true');
    return el;
}

function make_step_element(actor_editor, step) {
    let el = make_element('div', 'gleam-editor-step');
    el.classList.add(actor_editor.CLASS_NAME);
    // FIXME how does name update?  does the actor editor keep a list, or do these things like listen for an event on us?
    el.appendChild(make_element('div', '-who', actor_editor.name));
    el.appendChild(make_element('div', '-what', step.type.display_name));
    for (let [i, arg_def] of step.type.args.entries()) {
        let value = step.args[i];
        // TODO custom editors and display based on types!
        let arg_element = make_element('div', '-how');
        let arg_type = STEP_ARGUMENT_TYPES[arg_def.type];
        if (arg_type) {
            arg_element.appendChild(arg_type.build(arg_def, value));
        }
        else {
            arg_element.textContent = value;
        }
        el.appendChild(arg_element);
    }
    el.setAttribute('draggable', 'true');
    return el;
}

// Wrapper for a step that also keeps ahold of the step element and the
// associated ActorEditor
class EditorStep {
    constructor(actor_editor, step, ...args) {
        this.actor_editor = actor_editor;
        this.step = step;
        this.element = make_step_element(actor_editor, this.step);
        this._position = null;
    }

    get position() {
        return this._position;
    }
    set position(position) {
        this._position = position;
        this.element.setAttribute('data-position', String(position));
    }
}


// -----------------------------------------------------------------------------
// Editors for individual actor types

class ActorEditor {
    constructor(main_editor, actor = null) {
        this.main_editor = main_editor;

        let throwaway = document.createElement('div');
        throwaway.innerHTML = this.HTML;
        this.container = throwaway.firstElementChild;  // FIXME experimental, ugh
        this.container.classList.add(this.CLASS_NAME);
        this.actor = actor || new this.ACTOR_TYPE;

        // FIXME name propagation, and also give actors names of their own probably?
        this.name = 'bogus';

        this.initialize_steps();
    }

    initialize_steps() {
        // Add step templates
        // FIXME this is for picture frame; please genericify
        this.step_type_map = new Map();  // step element => step type
        for (let step_type of Object.values(this.ACTOR_TYPE.STEP_TYPES)) {
            let step_el = make_sample_step_element(this, step_type);
            this.container.appendChild(step_el);
            this.step_type_map.set(step_el, step_type);
        }

        // Enable dragging steps into the script
        for (let el of this.container.querySelectorAll('.gleam-editor-step')) {
            el.setAttribute('draggable', 'true');
        }
        this.container.addEventListener('dragstart', e => {
            e.dataTransfer.dropEffect = 'copy';
            e.dataTransfer.setData('text/plain', null);
            let step_type = this.step_type_map.get(e.target);
            let args = [];
            for (let arg_def of step_type.args) {
                // TODO?
                args.push(null);
            }
            this.main_editor.script_panel.begin_step_drag(new EditorStep(this, new Step(this.actor, step_type, args)));
        });
    }

    get name() {
        return this._name;
    }
    set name(name) {
        this._name = name;
        this.container.querySelector('header > h2').textContent = name;
    }

    update_assets() {}
}


// FIXME you should NOT be able to make more of these
class StageEditor extends ActorEditor {
}
StageEditor.prototype.ACTOR_TYPE = Stage;
StageEditor.prototype.CLASS_NAME = 'gleam-editor-actor-stage';
StageEditor.prototype.HTML = `
    <li class="gleam-editor-component-stage">
        <header>
            <h2>stage</h2>
        </header>
    </li>
`;

class CurtainEditor extends ActorEditor {
}
CurtainEditor.prototype.ACTOR_TYPE = Curtain;
CurtainEditor.actor_type_name = 'curtain';
CurtainEditor.prototype.CLASS_NAME = 'gleam-editor-actor-curtain';
CurtainEditor.prototype.HTML = `
    <li class="gleam-editor-component-curtain">
        <header>
            <h2>curtain</h2>
        </header>
    </li>
`;

class JukeboxEditor extends ActorEditor {
}
JukeboxEditor.prototype.ACTOR_TYPE = Jukebox;
JukeboxEditor.actor_type_name = 'jukebox';
JukeboxEditor.prototype.CLASS_NAME = 'gleam-editor-actor-jukebox';
JukeboxEditor.prototype.HTML = `
    <li class="gleam-editor-component-jukebox">
        <header>
            <h2>📻 jukebox</h2>
        </header>
        <h3>Tracks <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
    </li>
`;

class PictureFrameEditor extends ActorEditor {
    constructor(...args) {
        super(...args);

        this.pose_list = this.container.querySelector('.gleam-editor-component-pictureframe-poses');
        this.populate_pose_list();
    }

    populate_pose_list() {
        this.pose_list.textContent = '';
        for (let [pose_name, pose] of Object.entries(this.actor.poses)) {
            let frame = pose[0];  // FIXME this format is bonkers
            let li = make_element('li', null, pose_name);
            let image = this.main_editor.assets.expect(frame.url);
            if (image) {
                let img = make_element('img');
                if (image.toURL) {
                    // WebKit only
                    img.src = image.toURL();
                }
                else {
                    // TODO is this a bad idea?  it's already async so am i doing a thousand reads at once??
                    image.file(file => {
                        img.src = URL.createObjectURL(file);
                    });
                }
                li.appendChild(img);
            }
            else {
                li.appendChild(make_element('span', 'gleam-editor-missing-asset', '???'));
            }
            this.pose_list.appendChild(li);
        }
    }

    update_assets() {
        this.populate_pose_list();
    }
}
PictureFrameEditor.prototype.ACTOR_TYPE = PictureFrame;
PictureFrameEditor.actor_type_name = 'picture frame';
PictureFrameEditor.prototype.CLASS_NAME = 'gleam-editor-actor-pictureframe';
PictureFrameEditor.prototype.HTML = `
    <li class="gleam-editor-component-pictureframe">
        <header>
            <h2>backdrop</h2>
        </header>
        <h3>Poses <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
        <ul class="gleam-editor-component-pictureframe-poses">
        </ul>
        <button>preview</button>
    </li>
`;

class CharacterEditor extends ActorEditor {
}
CharacterEditor.prototype.ACTOR_TYPE = Character;
CharacterEditor.actor_type_name = 'character';
CharacterEditor.prototype.CLASS_NAME = 'gleam-editor-actor-character';
CharacterEditor.prototype.HTML = `
    <li class="gleam-editor-component-character">
        <header>
            <h2>backdrop</h2>
        </header>
    </li>
`;

class DialogueBoxEditor extends ActorEditor {
}
DialogueBoxEditor.prototype.ACTOR_TYPE = DialogueBox;
DialogueBoxEditor.actor_type_name = 'dialogue box';
DialogueBoxEditor.prototype.CLASS_NAME = 'gleam-editor-actor-dialoguebox';
DialogueBoxEditor.prototype.HTML = `
    <li class="gleam-editor-component-dialoguebox">
        <header>
            <h2>backdrop</h2>
        </header>
    </li>
`;


// List of all actor editor types
const ACTOR_EDITOR_TYPES = [
    //StageEditor,
    CurtainEditor,
    JukeboxEditor,
    PictureFrameEditor,
    CharacterEditor,
    DialogueBoxEditor,
];


// -----------------------------------------------------------------------------
// Main editor

class AssetLibrary {
    constructor(main_editor, container) {
        this.main_editor = main_editor;
        this.container = container;
        this.list = this.container.querySelector('.gleam-editor-assets');

        this.assets = {};
        this.dirty = false;
    }

    // TODO add an entry from a file drag and drop thing
    add_entry(entry) {
    }

    // FIXME hmm so how do you un-expect an asset then?
    expect(path) {
        if (!this.assets[path]) {
            this.assets[path] = null;
        }
        return this.assets[path];
    }

    read_directory_entry(directory_entry) {
        this.directory_entry = directory_entry;
        // TODO technically should be calling this repeatedly.  also it's asynchronous.
        directory_entry.createReader().readEntries(entries => {
            // TODO hmm, should mark by whether they're present and whether they're used i guess?
            for (let entry of entries) {
                this.assets[entry.name] = entry;
            }
            this.refresh_dom();
            for (let actor_editor of this.main_editor.actor_editors) {
                actor_editor.update_assets();
            }
        }, console.error)
    }

    refresh_dom() {
        console.log(this.assets);
        this.list.textContent = '';
        let paths = Object.keys(this.assets);
        paths.sort((a, b) => {
            // By some fucking miracle, JavaScript can do
            // human-friendly number sorting already, hallelujah
            return a.localeCompare(b, undefined, { numeric: true });
        });

        for (let path of paths) {
            let asset = this.assets[path];
            let li = make_element('li', null, path);
            if (asset === null) {
                li.classList.add('-missing');
            }
            this.list.appendChild(li);
        }
    }
}

class Panel {
    constructor(editor, container) {
        this.editor = editor;
        this.container = container;
        this.nav = container.querySelector('.gleam-editor-panel > header > nav');
        this.body = container.querySelector('.gleam-editor-panel > .gleam-editor-panel-body');
    }
}

// Panel containing the script, which is a list of steps grouped into beats
class ScriptPanel extends Panel {
    constructor(editor, container) {
        super(editor, container);

        this.beats_list = this.container.querySelector('.gleam-editor-beats-list');
        // State of a step drag happening anywhere in the editor; initialized
        // in begin_step_drag
        this.drag = null;

        // Add some nav controls
        let button = make_element('button', null, '←');
        button.addEventListener('click', ev => {
            // FIXME better api for this
            this.editor.script.jump(this.editor.script.cursor - 1);
        });
        this.nav.appendChild(button);
        button = make_element('button', null, '→');
        button.addEventListener('click', ev => {
            // FIXME better api for this
            this.editor.script.jump(this.editor.script.cursor + 1);
        });
        this.nav.appendChild(button);

        // Create the per-beat toolbar
        // TODO i don't super understand how this should work, or how per-step should work either, ugh
        this.beat_toolbar = make_element('nav', 'gleam-editor-beat-toolbar');
        button = make_element('button', null, 'jump');
        let hovered_beat_position = null;
        button.addEventListener('click', ev => {
            console.log(hovered_beat_position);
            this.editor.script.jump(hovered_beat_position);
        });
        this.beat_toolbar.appendChild(button);
        this.body.appendChild(this.beat_toolbar);

        this.selected_beat_index = null;
        this.beats_list.addEventListener('click', ev => {
            // TODO do step selection too
            let el = ev.target;
            while (el && el.tagName !== 'LI' && el.parentNode !== this.beats_list) {
                el = el.parentNode;
            }
            if (el) {
                let li = el;
                let position = 0;
                while (el.previousElementSibling) {
                    position++;
                    el = el.previousElementSibling;
                }
                if (position !== this.selected_beat_index) {
                    // TODO hmm, this assumes the script is working atm
                    this.editor.script.jump(position);
                }
            }
        });

        /*
         * FIXME restore
         * FIXME drag handle?  how?
        this.beats_list.addEventListener('dragstart', e => {
            e.dataTransfer.dropEffect = 'move';  // FIXME?  should be set in enter/over?
            e.dataTransfer.setData('text/plain', null);
            dragged_step = e.target;
            dragged_step.classList.add('gleam-editor--dragged-step');
        });
        */
        // Note that this fires on the original target, and NOT if the original node is moved???
        this.beats_list.addEventListener('dragend', e => {
            // FIXME return dragged step to where it was, if it was dragged from the step list in the first place
            this.end_step_drag();
        });

        // Set up dropping a step into the script (either from elsewhere in the
        // script, or from an actor)
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
            if (this.editor.steps.length === 0) {
                position = 0;
            }
            else {
                // If the mouse is already over a step, we're basically done.
                let cy = ev.clientY;
                let pointed_step = ev.target;
                while (pointed_step && ! pointed_step.classList.contains('gleam-editor-step')) {
                    pointed_step = pointed_step.parentNode;
                    if (! this.beats_list.contains(pointed_step)) {
                        pointed_step = null;
                        break;
                    }
                }
                if (pointed_step) {
                    let rect = pointed_step.getBoundingClientRect();
                    for (let [i, step] of this.editor.steps.entries()) {
                        if (pointed_step === step.element) {
                            position = i;
                            break;
                        }
                    }
                    // XXX position MUST be set here
                    if (cy > (rect.top + rect.bottom) / 2) {
                        position++;
                    }
                }
                else {
                    // The mouse is outside the list.  Resort to a binary
                    // search of the steps' client bounding rects, which are
                    // relative to the viewport, which is pretty appropriate
                    // for a visual effect like drag and drop.
                    let l = this.editor.steps.length;
                    let a = 0;
                    let b = l;
                    while (a < b) {
                        let n = Math.floor((a + b) / 2);
                        let rect = this.editor.steps[n].element.getBoundingClientRect();
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
                this.container.appendChild(caret);
                caret.style.left = `${this.beats_list.offsetLeft}px`;
                caret.style.width = `${this.beats_list.offsetWidth}px`;
            }

            let caret_y;
            let caret_mid_beat = false;
            if (this.editor.steps.length === 0) {
                caret_y = 0;
            }
            else if (position >= this.editor.steps.length) {
                let last_step = this.editor.steps[this.editor.steps.length - 1].element;
                caret_y = last_step.offsetTop + last_step.offsetHeight;
            }
            else {
                // Position it at the top of the step it would be replacing
                caret_y = this.editor.steps[position].element.offsetTop;
                // If this new step would pause, and the step /behind/ it
                // already pauses, then the caret will be at the end of a beat
                // gap.  Move it up to appear in the middle of the beat.
                if (position > 0 &&
                    this.drag.step.step.type.pause &&
                    this.editor.steps[position - 1].step.type.pause)
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

            let caret = this.drag.caret;
            if (caret.parentNode) {
                caret.parentNode.removeChild(caret);
            }
        });
        this.container.addEventListener('drop', e => {
            if (! this.drag) {
                return;
            }

            let step = this.drag.step;
            let position = this.drag.position;
            // Dropping onto nothing is a no-op
            if (position === null) {
                return;
            }
            // Dragging over oneself is a no-op
            if (step.element === this.drag.target) {
                return;
            }

            e.preventDefault();

            // End the drag first, to get rid of the caret which kinda fucks
            // up element traversal
            this.end_step_drag();

            this.editor.insert_step(step, position);
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

    set_beat_index(index) {
        if (index === this.selected_beat_index)
            return;

        if (this.selected_beat_index !== null) {
            this.beats_list.children[this.selected_beat_index].classList.remove('--current');
        }
        this.selected_beat_index = index;
        if (this.selected_beat_index !== null) {
            this.beats_list.children[this.selected_beat_index].classList.add('--current');
        }
    }

    insert_step_element(step, position) {
        // Add to the DOM
        // FIXME there's a case here that leaves an empty <li> at the end
        if (this.beats_list.children.length === 0) {
            // It's the only child!  Easy.
            let group = make_element('li');
            group.appendChild(step.element);
            this.beats_list.appendChild(group);
            // Auto-select the first beat
            // TODO this should really do a script jump, once the script works
            this.set_beat_index(0);
        }
        else {
            // FIXME adding at position 0 doesn't work, whoops
            let previous_step = this.editor.steps[position - 1];
            let previous_el = previous_step.element;
            let group = previous_el.parentNode;
            let next_group = group.nextElementSibling;
            // Time to handle pauses.
            if (previous_step.step.type.pause) {
                // Inserting after a step that pauses means we need to go at
                // the beginning of the next group.
                if (! next_group || step.step.type.pause) {
                    // If there's no next group, or we ALSO pause, then we end
                    // up in a group by ourselves regardless.
                    let new_group = make_element('li');
                    new_group.appendChild(step.element);
                    this.beats_list.insertBefore(new_group, next_group);
                }
                else {
                    next_group.insertBefore(step.element, next_group.firstElementChild);
                }
            }
            else {
                // Inserting after a step that DOESN'T pause is easy, unless...
                if (step.step.type.pause) {
                    // Ah, we DO pause, so we need to split everything after
                    // ourselves into a new group.
                    let new_group = make_element('li');
                    while (previous_el.nextElementSibling) {
                        new_group.appendChild(previous_el.nextElementSibling);
                    }
                    if (new_group.children) {
                        this.beats_list.insertBefore(new_group, next_group);
                    }
                }

                // Either way, we end up tucked in after the previous element.
                group.insertBefore(step.element, previous_el.nextElementSibling);
            }
        }
    }

    begin_step_drag(step) {
        this.drag = {
            // EditorStep being dragged
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
        let caret = this.drag.caret;
        if (caret.parentNode) {
            caret.parentNode.removeChild(caret);
        }

        if (this.drag.step_el) {
            this.drag.step_el.classList.remove('gleam-editor--dragged-step');
        }

        this.drag = null;
    }

}

class Editor {
    constructor(script, container, player_container) {
        // FIXME inject_into method or something?  separate view?
        this.script = script;
        this.container = container;
        this.player = new Player(script, player_container);

        // TODO be able to load existing steps from a script
        this.steps = [];  // list of EditorSteps

        // Assets panel
        this.assets_container = document.getElementById('gleam-editor-assets');
        this.assets = new AssetLibrary(this, this.assets_container);

        // FIXME? this always takes a moment to register, not sure why...
        // FIXME this should only accept an actual directory drag
        // FIXME should have some other way to get a directory.  file upload control?
        this.assets_container.addEventListener('dragenter', e => {
            if (e.target !== this.assets_container) {
                return;
            }

            e.stopPropagation();
            e.preventDefault();
            console.log(e);

            this.assets_container.classList.add('gleam-editor-drag-hover');
        });
        this.assets_container.addEventListener('dragover', e => {
            e.stopPropagation();
            e.preventDefault();
            console.log(e);
        });
        this.assets_container.addEventListener('dragleave', e => {
            this.assets_container.classList.remove('gleam-editor-drag-hover');
            console.log(e);
        });
        this.assets_container.addEventListener('drop', e => {
            e.stopPropagation();
            e.preventDefault();
            console.log(e);

            this.assets_container.classList.remove('gleam-editor-drag-hover');
            console.log(e.dataTransfer);
            let item = e.dataTransfer.items[0];
            let entry = item.webkitGetAsEntry();
            this.assets.read_directory_entry(entry);
        });

        // Actor panel (labeled "components")
        this.actor_editors = [];
        this.actors_container = document.getElementById('gleam-editor-components');
        this.actors_el = this.actors_container.querySelector('.gleam-editor-components');
        for (let actor_editor_type of ACTOR_EDITOR_TYPES) {
            let button = make_element('button', null, `new ${actor_editor_type.actor_type_name}`);
            button.addEventListener('click', ev => {
                this.add_actor_editor(new actor_editor_type(this));
            });
            this.actors_container.querySelector('.gleam-editor-panel-body').appendChild(button);
        }

        this.script_panel = new ScriptPanel(this, document.getElementById('gleam-editor-script'));

        // Initialize with a stage, which the user can't create on their own
        // because there can only be one
        /*
        let stage_editor = new StageEditor(this);
        stage_editor.name = 'stage';
        this.add_actor_editor(stage_editor);
        */

        // Load actors from the script
        let actor_editor_index = new Map();
        for (let [ident, actor] of Object.entries(script.actors)) {
            let actor_editor_type;
            if (actor instanceof Stage) {
                actor_editor_type = StageEditor;
            }
            else if (actor instanceof Curtain) {
                actor_editor_type = CurtainEditor;
            }
            else if (actor instanceof Jukebox) {
                actor_editor_type = JukeboxEditor;
            }
            else if (actor instanceof PictureFrame) {
                actor_editor_type = PictureFrameEditor;
            }
            else if (actor instanceof Character) {
                actor_editor_type = CharacterEditor;
            }
            else if (actor instanceof DialogueBox) {
                actor_editor_type = DialogueBoxEditor;
            }

            if (actor_editor_type) {
                let actor_editor = new actor_editor_type(this, actor);
                actor_editor.name = ident;
                actor_editor_index.set(actor, actor_editor);
                this.add_actor_editor(actor_editor);
            }
            else {
                console.log("oops, not yet supported", actor.constructor, actor);
            }
        }

        // Load steps from the script
        let group = make_element('li');
        for (let [i, step] of script.steps.entries()) {
            let editor_step = new EditorStep(actor_editor_index.get(step.actor), step);
            editor_step.position = i;
            this.steps.push(editor_step);

            group.appendChild(editor_step.element);
            if (step.type.pause) {
                this.script_panel.beats_list.appendChild(group);
                group = make_element('li');
            }
        }
        if (group.children.length > 0) {
            this.script_panel.beats_list.appendChild(group);
        }

        this.assets.refresh_dom();


        // FIXME this is very bad
        script.xxx_hook = this;
        this.on_beat();
    }

    // FIXME hooks for the script
    on_beat() {
        this.script_panel.set_beat_index(this.script.cursor);
    }

    add_actor_editor(actor_editor) {
        this.actor_editors.push(actor_editor);
        this.actors_el.appendChild(actor_editor.container);
    }

    get_step_for_element(element) {
        if (element.dataset.position === undefined) {
            return null;
        }

        return this.steps[parseInt(element.dataset.position, 10)];
    }

    remove_step(step) {
    }

    // Insert an EditorStep at the given position
    insert_step(step, position) {
        if (position > this.steps.length) {
            position = this.steps.length;
        }

        // Add to our own step list
        this.steps.splice(position, 0, step);
        for (let i = position; i < this.steps.length; i++) {
            this.steps[i].position = i;
        }
        // TODO insert into script and update that

        this.script_panel.insert_step_element(step, position);
    }
}

// FIXME give a real api for this.  question is, how do i inject into the editor AND the player
window.addEventListener('load', e => {
    // NOTE TO FUTURE GIT SPELUNKERS: sorry this exists only on my filesystem and points to all the old flora vns lol
    let root = 'res/prompt2-itchyitchy-final';
    xxx_global_root = root;
    let xhr = new XMLHttpRequest;
    xhr.addEventListener('load', ev => {
        console.log(ev);
        // FIXME handle errors yadda yadda
        let script = Script.from_legacy_json(JSON.parse(xhr.responseText));
        //let script = new Script();
        let editor = new Editor(script, document.querySelector('.gleam-editor'), document.querySelector('.gleam-player'));
        // TODO this seems, counterintuitive?  editor should do it, surely.  but there's no way to pause it atm?  but updates don't happen without it.
        editor.player.play();
    });
    // XXX lol
    xhr.open('GET', location.toString().replace(/\/[^\/]+$/, '/') + root + '/script.json');
    xhr.send();
});

return {
    Script: Script,
    Player: Player,
    Editor: Editor,
};
})(window);
