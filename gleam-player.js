"use strict";
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

        this.pose_elements = {};
        for (let [pose_name, frames] of Object.entries(this.role.poses)) {
            let frame_elements = this.pose_elements[pose_name] = [];
            for (let frame of frames) {
                let image = director.library.load_image(frame.url);
                // FIXME animation stuff $img.data 'delay', frame.delay or 0
                element.appendChild(image);
                frame_elements.push(image);
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
        for (let [pose_name, frames] of Object.entries(this.role.poses)) {
            if (this.pose_elements[pose_name])
                continue;
            // FIXME ensure order...
            // FIXME augh, frames need to match too...
            // FIXME remove any that disappeared...
            // FIXME maybe i should just create a new actor
            let frame_elements = this.pose_elements[pose_name] = [];
            for (let frame of frames) {
                let image = director.library.load_image(frame.url);
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
            this.pose_elements[old_pose_name][0].classList.remove('--visible');
        }

        let child = this.pose_elements[pose_name][0];
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
// Regular HTTP fetch, the only kind available to the player
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
            if (this.cursor >= 0) {
                this.jump(this.cursor);
            }
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

        this.script.intercom.addEventListener('gleam-role-added', ev => {
            let role = ev.detail.role;
            let actor = this.director.role_to_actor.get(role);
            // FIXME what if roles are reordered?
            if (actor && actor.element) {
                this.container.append(actor.element);
            }
        });

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
        // FIXME Oh this is very bad, probably replace with events the director fires
        this.progress_element.style.setProperty('--progress', this.director.cursor / (this.script.beats.length - 1) * 100 + '%');
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

        // Populate pause screen
        let beats_list = this.pause_element.querySelector('.gleam-pause-beats');
        beats_list.textContent = '';
        let number_next_beat = false;
        for (let [i, beat] of this.script.beats.entries()) {
            let li = make_element('li');
            let b = i + 1;
            if (number_next_beat || b % 10 === 0 || b === 1 || b === this.script.beats.length) {
                number_next_beat = false;
                li.textContent = String(b);
            }
            li.setAttribute('data-beat-index', i);
            if (i === this.director.cursor) {
                li.classList.add('--current');
            }
            beats_list.appendChild(li);

            if (this.script.steps[beat.last_step_index].type.is_major_transition) {
                // TODO ok this is extremely hokey
                beats_list.append(make_element('hr'));
                number_next_beat = true;
            }
        }

        this.container.classList.add('--paused');
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

let ret = {};
for (let obj of [
    make_element,
    svg_icon_from_path,

    Stage,
    Curtain,
    DialogueBox,
    Jukebox,
    PictureFrame,
    Character,

    AssetLibrary,
    RemoteAssetLibrary,

    Script,
    Director,
    Player,
])
{
    ret[obj.name] = obj;
}
return ret;
})();