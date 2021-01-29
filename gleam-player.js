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

const VERSION = "0.3";

// borrowed from hammer.js
const SWIPE_THRESHOLD = 10;
const SWIPE_VELOCITY = 0.3;

const CAN_PLAY_AUDIO = (function() {
    let dummy_audio = document.createElement('audio');
    return dummy_audio.canPlayType && dummy_audio.canPlayType('audio/ogg; codecs="vorbis"');
})();

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

// NOTE: copied from util.js
function mk(tag_selector, ...children) {
    let [tag, ...classes] = tag_selector.split('.');
    let el = document.createElement(tag);
    el.classList = classes.join(' ');
    if (children.length > 0) {
        if (!(children[0] instanceof Node) && typeof(children[0]) !== "string" && typeof(children[0]) !== "number") {
            let [attrs] = children.splice(0, 1);
            for (let [key, value] of Object.entries(attrs)) {
                el.setAttribute(key, value);
            }
        }
        el.append(...children);
    }
    return el;
}

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
// Styling stuff

class GoogleFontLoader {
    constructor() {
        this.loaded_fonts = {};
    }

    // TODO i guess this could get more complicated with variants + subsets
    load(family) {
        if (this.loaded_fonts[family]) {
            return;
        }

        this.loaded_fonts[family] = true;

        let params = new URLSearchParams({
            family: family,
            // This adds font-display: swap; to each @font-face block, which
            // asks the browser to use a fallback font while the web font is
            // downloading -- this avoids invisible text on the loading screen
            display: 'swap',
        });
        document.head.append(mk('link', {
            href: `https://fonts.googleapis.com/css?${params}`,
            rel: 'stylesheet',
            type: 'text/css',
        }));
    }
}

const GOOGLE_FONT_LOADER = new GoogleFontLoader;

// -----------------------------------------------------------------------------
// Roles and Actors

// The definition of an actor, independent of the actor itself.  Holds initial
// configuration.
class Role {
    constructor(name) {
        this.name = name;
    }

    // Call me after creating a Role subclass to make it loadable.
    static register(type_name) {
        this.type_name = type_name;
        Role._ROLE_TYPES[type_name] = this;
    }

    static from_legacy_json(name, json) {
        if (this.type_name !== json.type) {
            throw new Error(`Role class ${this.name} can't load a role of type '${json.type}'`);
        }
        return new this(name);
    }

    static from_json(json) {
        return new this(json.name);
    }

    // Called after all roles are loaded, for restoring cross-references
    post_load(script) {}

    to_json() {
        return {
            name: this.name,
            type: this.constructor.type_name,
        };
    }

    generate_initial_state() {
        let state = {};
        for (let [key, twiddle] of Object.entries(this.TWIDDLES)) {
            if (twiddle.initial instanceof Function) {
                state[key] = twiddle.initial(this);
            }
            else {
                state[key] = twiddle.initial;
            }
        }
        return state;
    }

    // Create an Actor to play out this Role
    cast(director) {
        return new this.constructor.Actor(this, director);
    }
}
Role.prototype.TWIDDLES = {};
Role._ROLE_TYPES = {};
Role.Actor = null;


class Actor {
    constructor(role, element) {
        this.role = role;
        this.state = role.generate_initial_state();

        this.element = element;
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

    // TODO figure this out.
    sync_with_role(director) {}

    // TODO? kind of a state issue here: what happens if you apply_state while paused?  that can happen in the editor, and also when jumping around from the pause screen, though it seems to incidentally work out alright, and anyway only jukebox is affected
    pause() {}

    unpause() {}
}
Actor.prototype.TWIDDLES = {};
// Must also be defined on subclasses:
Actor.STEP_KINDS = null;
Actor.LEGACY_JSON_ACTIONS = null;


// Roles are choreographed by Steps, which are then applied to Actors
class Step {
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

    update_beat(beat) {
        this.kind.apply(this.role, beat, beat.get(this.role), ...this.args);
    }
}


class Stage extends Role {
}
Stage.register('stage');
Stage.prototype.TWIDDLES = {};
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
};
// TODO from legacy json, and target any actorless actions at us?

Stage.Actor = class StageActor extends Actor {
    constructor(role) {
        super(role, mk('div'));
    }
};


// Full-screen transition actor
class Curtain extends Role {
}
Curtain.register('curtain');
Curtain.prototype.TWIDDLES = {
    lowered: {
        initial: false,
        type: Boolean,
        propagate: false,
    },
};
Curtain.STEP_KINDS = {
    lower: {
        display_name: 'lower',
        pause: 'wait',
        // TODO this is very...  heuristic, and there's no way to override it, hm.
        is_major_transition: true,
        args: [],
        check() {},
        apply(role, beat, state) {
            state.lowered = true;
        },
    },
};
Curtain.LEGACY_JSON_ACTIONS = {
    lower: ["lower"],
};

Curtain.Actor = class CurtainActor extends Actor {
    constructor(role) {
        // TODO color?

        super(role, mk('div.gleam-actor-curtain'));
    }

    apply_state(state) {
        let old_state = super.apply_state(state);
        this.element.classList.toggle('--lowered', state.lowered);

        if (old_state.lowered !== state.lowered) {
            return promise_transition(this.element);
        }
    }
};


// Full-screen arbitrary markup
// FIXME this is very hardcodey but should be in backstage
// FIXME also less generic, more templated, subclasses or something idk, make it safe
// FIXME make roll_credits on old things work
// FIXME "powered by GLEAM"!  i guess.  but that only makes sense for credits, maybe a mural is useful for something else too
class Mural extends Role {
    constructor(name, markup) {
        super(name);
        markup = `
            <dl class="gleam-mural-credits">
                <dt><a href="https://glitchedpuppet.com/">glitchedpuppet</a></dt>
                <dd>art, music, script</dd>
                <dt><a href="https://eev.ee/">Eevee</a></dt>
                <dd>programming</dd>
            </dl>
            <p><a href="https://floraverse.com/">Floraverse</a></p>
            <p><a href="https://floraverse.bandcamp.com/">Bandcamp</a></p>
            <p>command not found</p>
        `;
        this.markup = markup;
    }

    static from_json(json) {
        let mural = super.from_json(json);
        // FIXME this is extremely bad actually
        mural.markup = json.markup;
        return mural;
    }

    to_json() {
        let json = super.to_json();
        json.markup = this.markup;
        return json;
    }
}
Mural.register('mural');
Mural.prototype.TWIDDLES = {
    visible: {
        initial: false,
        type: Boolean,
        propagate: false,
    },
};
Mural.STEP_KINDS = {
    show: {
        display_name: 'show',
        pause: true,
        args: [],
        check() {},
        apply(role, beat, state) {
            state.visible = true;
        },
    },
};
Mural.LEGACY_JSON_ACTIONS = {
    show: ["show"],
};

Mural.Actor = class MuralActor extends Actor {
    constructor(role) {
        super(role, mk('div.gleam-actor-mural'));

        this.element.innerHTML = role.markup;
    }

    apply_state(state) {
        let old_state = super.apply_state(state);
        this.element.classList.toggle('--visible', state.visible);
    }
};


class CreditsMural extends Mural {
    constructor(name, credits) {
        let markup = mk('div');

        let people_markup = mk('dl');
        for (let contributor in credits.people || []) {
            people_markup.append(
                mk('dt', contributor['for']),
                mk('dd', contributor.who),
            );

            /*
            devart = $('<div>', class: '-deviantart').appendTo row
            if contributor.deviantart
                link = $ '<a>', href: "http://#{contributor.deviantart}.deviantart.com/"
                link.append $ '<img>', src: "img/deviantart.png", alt: "deviantArt"
                devart.append link

            tumblr = $('<div>', class: '-tumblr').appendTo row
            if contributor.tumblr
                link = $ '<a>', href: "http://#{contributor.tumblr}.tumblr.com/"
                link.append $ '<img>', src: "img/tumblr.png", alt: "Tumblr"
                tumblr.append link

            twitter = $('<div>', class: '-twitter').appendTo row
            if contributor.twitter
                link = $ '<a>', href: "https://twitter.com/#{contributor.twitter}"
                link.append $ '<img>', src: "img/twitter.png", alt: "Twitter"
                twitter.append link
            */
        }
        markup.append(people_markup);

        for (let line in credits.footer || []) {
            markup.append(mk('p', line));
        }

        /*
        "people": [
            {
                "who": "Glip",
                "for": "Art, Music, Script",
                "website": "http://glitchedpuppet.com/",
                "twitter": "glitchedpuppet"
            },
            {
                "who": "Eevee",
                "for": "Programming",
                "website": "https://eev.ee/",
                "twitter": "eevee"
            }
        ],
        "footer_html": [
            "<a href='http://floraverse.com/'>Floraverse</a>",
            "<a href='https://floraverse.bandcamp.com/'>Bandcamp</a>"
        ]
        */

        super(name, markup);
    }
}
CreditsMural.register('creditsmural');


class DialogueBox extends Role {
    constructor(name) {
        super(name);

        this.speed = 60;
    }

    to_json() {
        let json = super.to_json();
        json.speed = 60;
        return json;
    }
}
DialogueBox.register('dialogue-box');
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
DialogueBox.STEP_KINDS = {};
DialogueBox.LEGACY_JSON_ACTIONS = {};
DialogueBox.Actor = class DialogueBoxActor extends Actor {
    constructor(role) {
        super(role, mk('div.gleam-actor-dialoguebox'));

        // Toss in a background element
        this.element.appendChild(mk('div.-background'));

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
*/


class Jukebox extends Role {
    constructor(name) {
        super(name);
        this.tracks = {};
    }

    static from_legacy_json(name, json) {
        let jukebox = new this(name);
        for (let [track_name, path] of Object.entries(json.tracks)) {
            jukebox.add_track(track_name, path);
        }
        return jukebox;
    }

    static from_json(json) {
        let jukebox = super.from_json(json);
        for (let [name, track_def] of Object.entries(json.tracks)) {
            jukebox.add_track(name, track_def.path, track_def.loop);
        }
        return jukebox;
    }

    to_json() {
        let json = super.to_json();
        // FIXME should this be an array?  should it be an array even in the role object proper?
        json.tracks = this.tracks;
        return json;
    }

    add_track(track_name, path, loop = true) {
        this.tracks[track_name] = {
            path: path,
            loop: loop,
        };
    }
}
Jukebox.register('jukebox');
Jukebox.prototype.TWIDDLES = {
    track: {
        initial: null,
        // XXX type?  index into Jukebox.tracks
    },
};
Jukebox.STEP_KINDS = {
    play: {
        display_name: "play",
        hint: "start playing a given track",
        args: [{
            display_name: "track",
            type: 'track',
            // FIXME type: 'key',
            type_key_prop: 'tracks',
        }],
        check(role, track_name) {
            if (role.tracks[track_name] === undefined) {
                return ["No such track!"];
            }
        },
        apply(role, beat, state, track_name) {
            state.track = track_name;
        },
    },
    stop: {
        display_name: "stop",
        hint: "stop playing",
        args: [],
        check() {},
        apply(role, beat, state) {
            state.track = null;
        },
    },
};
Jukebox.LEGACY_JSON_ACTIONS = {
    play: ["play", 'track'],
    stop: ["stop"],
};
Jukebox.Actor = class JukeboxActor extends Actor {
    constructor(role, director) {
        super(role, mk('div.gleam-actor-jukebox'));

        this.master_volume = director.master_volume;
        this.track_fades = {};
        this.track_elements = {};

        // If we can't play music at ALL, don't even try to load anything
        if (! CAN_PLAY_AUDIO)
            return;

        for (let [name, track] of Object.entries(this.role.tracks)) {
            let audio = director.library.load_audio(track.path);
            audio.loop = track.loop;
            this.track_elements[name] = audio;
            this.element.append(audio);
        }
    }

    apply_state(state) {
        let old_state = super.apply_state(state);

        if (! CAN_PLAY_AUDIO)
            return;

        if (state.track !== old_state.track) {
            if (old_state.track !== null) {
                let audio = this.track_elements[old_state.track];
                this.track_fades[old_state.track] = {
                    progress: 0,
                    time: 0.6,
                };
            }
            if (state.track !== null) {
                let audio = this.track_elements[state.track];
                delete this.track_fades[state.track];
                audio.currentTime = 0;
                audio.volume = this.master_volume;
                audio.play();
            }
        }
    }

    sync_with_role(director) {
        for (let [name, track] of Object.entries(this.role.tracks)) {
            if (this.track_elements[name]) {
                // FIXME hacky as hell
                director.library.load_audio(track.path, this.track_elements[name]);
                this.track_elements[name].loop = track.loop;
                continue;
            }
            // FIXME ensure order...
            // FIXME remove any that disappeared...
            // FIXME maybe i should just create a new actor
            let audio = director.library.load_audio(track.url);
            audio.loop = track.loop;
            this.track_elements[name] = audio;
            this.element.append(audio);
        }
    }

    play(track_name) {
        // TODO...?
    }

    update(dt) {
        for (let [name, state] of Object.entries(this.track_fades)) {
            let audio = this.track_elements[name];
            state.progress += dt / state.time;
            if (state.progress >= 1) {
                audio.volume = 0;
                audio.pause();
                delete this.track_fades[name];
            }
            else {
                audio.volume = (1 - state.progress) * this.master_volume;
            }
        }
    }

    pause() {
        if (! this.state.track)
            return;

        // Note that this doesn't pause a song that's also fading /out/, but
        // the fadeout time is usually short, so that's fine.
        // TODO perhaps a more robust approach would be to look through ALL our elements and pause them if they're playing, then remember which ones to play when we unpause?  i think that would interact between with an apply_state while paused, too
        let audio = this.track_elements[this.state.track];
        audio.pause();
    }

    unpause() {
        if (! this.state.track)
            return;

        let audio = this.track_elements[this.state.track];
        audio.volume = this.master_volume;
        audio.play();
    }
};
/*
    _id_suffix: ->
        return 'boombox'

    _change: (event, song_name) =>
        $el = $ event.currentTarget
        old_song_name = $el.data 'active-song-name'
        if old_song_name == song_name
            return
        $el.data 'active-song-name', song_name

        $song_elements = $el.data 'song-elements'

        $old_song = $song_elements[old_song_name]
        $new_song = $song_elements[song_name]

        # TODO maybe this should just be .find('.-visible')
        if $old_song?
            old_promise = @_stop_track $old_song[0]
        else
            old_promise = promise_always()

        # Kill the animation queue, in case the new song is in the process of
        # stopping.  The `true`s clear the queue and jump to the end of the
        # animation.
        if $new_song?
            $new_song.stop true, true
            $new_song[0].volume = 1.0  # XXX default volume?
            $new_song[0].play()

        return old_promise

    _stop_track: (media) ->
        ###
        Stop a track with a fadeout.

        Returns a promise that will complete when the fadeout is finished.
        ###
        if media.paused
            return promise_always()

        original_volume = media.volume
        return $(media).animate(volume: 0, 'slow').promise().then ->
            media.pause()
            media.currentTime = 0.0
            media.volume = original_volume

    _disable: (event) =>
        $el = $ event.currentTarget
        old_song_name = $el.data 'active-song-name'
        $song_elements = $el.data 'song-elements'
        $old_song = $song_elements[old_song_name]

        $el.data 'active-song-name', null

        if $old_song?
            return @_stop_track $old_song[0]
        else
            return promise_always()
*/


// Stored format is defined as follows:
// An 'animation' is:
// - a single path
// - a list of { path, duration }
// And a pose is:
// - an animation
// - { type: 'static', path },
// - { type: 'animated', frames: [{path, duration}] },
// - { type: 'composite', order: [ layer names... ], layers: { optional?, variants: { name: animation } } }
class PictureFrame extends Role {
    constructor(name, position) {
        super(name);
        this.poses = {};
    }

    static from_legacy_json(name, json) {
        let pf = new this(name, json.position);
        for (let [key, value] of Object.entries(json.views)) {
            pf.poses[key] = this.inflate_pose(value);
        }
        return pf;
    }

    static from_json(json) {
        let pf = new this(json.name, json.position);
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
}
PictureFrame.register('picture-frame');
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
    composites: {
        // Map of pose => { layer => variant }
        initial(role) {
            let value = {};
            for (let [pose_name, pose] of Object.entries(role.poses)) {
                if (pose.type !== 'composite')
                    continue;

                value[pose_name] = {};
                for (let layername of pose.order) {
                    value[pose_name][layername] = false;  // TODO default
                }
            }
            return value;
        },
        check() {
            // TODO!!!!
        },
        propagate(prev_value) {
            let value = {};
            for (let [pose_name, variants] of Object.entries(prev_value)) {
                value[pose_name] = {};
                for (let [layername, variant] of Object.entries(variants)) {
                    value[pose_name][layername] = variant;
                }
            }
            return value;
        },
    },
};
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
    constructor(role, director) {
        super(role, mk('div.gleam-actor-pictureframe', {'data-name': role.name}));
        // FIXME add position class

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
        // TODO position/style?
        return json;
    }

    // FIXME i think i should also be saving the dialogue box name?  and, dialogue name/color/etc which don't even appear in the constructor
}
Character.register('character');
// XXX aha, this could be a problem.  a character is a delegate; it doesn't have any actual twiddles of its own!
// in the old code (by which i mean, round two), the character even OWNS the pictureframe...
// so "Character:say" is really two twiddle updates on the dialogue box: the phrase AND the speaker whose style to use.  hrm.
//Character.prototype.TWIDDLES = {};
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
            dstate.color = role.dialogue_color;
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
                else if (twiddle.propagate instanceof Function) {
                    // Custom propagation (probably a deep clone)
                    state[key] = twiddle.propagate(prev_state[key]);
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

// Given a path, gets a relevant file.  Mainly exists to abstract over the
// difference between loading a live script from a Web source and pulling from
// the user's hard drive.
// TODO should wire this into player's initial 'loading' screen
// TODO need to SOMEHOW let asset panel know when a thing happens here?  except, wait, it's the asset panel that makes things happen.  maybe a little kerjiggering can fix that then.
// FIXME this just, needs a lot of work.
class AssetLibrary {
    constructor() {
        this.assets = {};
        // Map of <img> to asset path, for automatic reloading
        this.images = new Map;
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

        for (let [img, path] of library.images) {
            // Ignore removed images
            if (! img.isConnected)
                continue;

            let new_img = this.load_image(path, img);
            if (new_img !== img) {
                new_img.className = img.className;
                img.replaceWith(new_img);
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

    async get_url_for_path(path) {
        return new URL(path, this.root);
    }

    load_image(path, element) {
        element = element || mk('img');
        let asset = this.assets[path];
        if (asset) {
            // After trying to load this once, there's no point in doing all
            // the mechanical checking again; it'd be cached regardless
            element.src = asset.url;
            this.images.set(element, path);
            return element;
        }

        // Bind the event handlers FIRST -- if the image is cached, it might
        // load instantly!
        let promise = promise_event(element, 'load', 'error');

        // TODO indicating more fine-grained progress would be nice, but i
        // would need to know the sizes of all the assets upfront for it to be
        // meaningful.  consider including that in the new script format,
        // maybe?  urgh.  ALSO, note that it would need to use XHR and could
        // only be done same-origin anyway, because cross-origin XHR doesn't
        // populate the cache the same way as a regular <img>!

        let url = new URL(path, this.root);
        asset = this.assets[path] = {
            url: url,
            used: true,
            exists: null,
            progress: 0,
        };

        promise = promise.then(
            () => {
                asset.exists = true;
                asset.progress = 1;
                asset.promise = null;
            },
            ev => {
                console.error("error loading image", path, ev);
                asset.exists = false;
                asset.promise = null;
                throw ev;
            }
        );
        asset.promise = promise;

        // TODO fire an event here, or what?
        element.src = url;
        this.images.set(element, path);
        return element;
    }

    load_audio(path, element) {
        element = element || mk('audio', {preload: 'auto'});
        let asset = this.asset(path);
        if (asset.url) {
            element.src = asset.url;
            return element;
        }

        // Bind the event handlers FIRST -- if the audio is cached, it might
        // load instantly!
        // Note: 'canplaythrough' fires when the entire sound can be played
        // without buffering.  But Chrome doesn't like downloading the entire
        // file, and the spec never guarantees this is possible anyway, so go
        // with 'canplay' and hope for the best.
        let promise = promise_event(element, 'canplay', 'error');

        let url = new URL(path, this.root);
        asset.url = url;
        asset.used = true;
        asset.exists = null;
        asset.progress = 0;

        // FIXME if the audio fails to download, the VN should probably still be playable?

        promise = promise.then(
            () => {
                asset.exists = true;
                asset.progress = 1;
                asset.promise = null;
            },
            ev => {
                console.error("error loading", path, ev);
                asset.exists = false;
                asset.promise = null;
                throw ev;
            }
        );
        asset.promise = promise;

        // TODO fire an event here, or what?
        element.src = url;
        // Unlike images, the downloading doesn't start without this, because
        // the source selection is potentially more complicated
        element.load();

        return element;
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
        // Metadata
        this.title = null;
        this.subtitle = null;
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

    // Recreate beats, starting from the given step.  Called both when initializing the script and
    // when making step edits in the editor.
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
        this.paused = false;

        this.master_volume = 1;

        this.actors = {};
        // TODO this seems clumsy...  maybe if roles had names, hmm
        this.role_to_actor = new Map();
        for (let role of this.script.roles) {
            let actor = role.cast(this);
            this.actors[role.name] = actor;
            this.role_to_actor.set(role, actor);
        }

        // Used as an event target, to announce advancement to wrapper types
        this.intercom = mk('i');

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
            // FIXME these no longer exist
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

    // Advance forward one beat, or advance any pending actors
    advance() {
        // FIXME this seems pretty annoying in the editor, and also when scrolling through
        if (this.busy)
            return;

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
            if (busy)
                return;
        }

        // Check this AFTER trying to advance actors, so the viewer can still
        // e.g. advance through dialogue on the last beat
        if (this.cursor >= this.script.beats.length - 1)
            return;

        // If we're still here, advance to the next beat
        this.jump(this.cursor + 1);
    }

    // Go backwards one beat
    backtrack() {
        if (this.cursor === 0)
            return;

        let cursor = this.cursor - 1;
        // Skip over any 'wait' beats (like lowering a curtain), since those
        // advance automatically
        while (cursor > 0 && this.script.beats[cursor].pause === 'wait') {
            cursor--;
        }

        this.jump(cursor);
    }

    update(dt) {
        for (let [name, actor] of Object.entries(this.actors)) {
            actor.update(dt);
        }
    }

    pause() {
        if (this.paused)
            return;
        this.paused = true;

        for (let actor of Object.values(this.actors)) {
            actor.pause();
        }
    }

    unpause() {
        if (! this.paused)
            return;
        this.paused = false;

        for (let actor of Object.values(this.actors)) {
            actor.unpause();
        }
    }
}

class PlayerOverlay {
    constructor(player) {
        this.player = player;
        this.body = mk('div.-body');
        this.element = mk('div.gleam-overlay',
            // FIXME subtitle, author, date
            mk('header', this.player.script.title || 'Untitled'),
            this.body,
            // FIXME this should link, um, somewhere
            mk('footer', `GLEAM ${VERSION}`),
        );

        // Clicking on the element shouldn't trigger an advance, which is on
        // the parent as a click handler; block the event
        this.element.addEventListener('click', ev => {
            ev.stopPropagation();
        });
    }

    show() {
        this.element.classList.add('--visible');
    }

    hide() {
        this.element.classList.remove('--visible');
    }
}

class PlayerLoadingOverlay extends PlayerOverlay {
    constructor(player) {
        super(player);
        this.element.classList.add('gleam-overlay-loading');
        // FIXME controls; pause button instructions; music warning (if playable AND actually exists); contact in case of problems (from script...?)
        // FIXME maybe these instructions should be customizable too
        this.body.append(
            mk('p', "click, tap, swipe, spacebar, or arrow keys to browse — backwards too!"),
            // FIXME only do this if there's a jukebox?
            mk('p', CAN_PLAY_AUDIO
                ? "PLEASE NOTE: there's music!  consider headphones, or pause to change volume"
                : "PLEASE NOTE: music is disabled, because your browser doesn't support ogg vorbis  :("
            ),
            this.status_heading = mk('h2', '...Loading...'),
            this.play_el = mk('div.gleam-loading-play', '▶'),
            this.progress_bar = mk('div.gleam-loading-progressbar'),
            mk('div.gleam-loading-progress',
                this.done_el = mk('div.-done', '0'),
                mk('div.-divider', '/'),
                this.total_el = mk('div.-total', '0'),
            ),
            this.errors_el = mk('p'),
            mk('p', "art and music licensed under CC BY-SA; code licensed under ISC"),
        );
        // FIXME css, once i figure this out
        this.errors_el.style.whiteSpace = 'pre-wrap';
        this.play_el.addEventListener('click', ev => {
            // FIXME also need to tell the player to show the play button
            // FIXME shouldn't start playing music until after clicking play, on the off chance the first frame does that...  hm...
            // FIXME this seems invasive also
            player.container.classList.remove('--loading');
            this.hide();
        });

        this.successful = true;
        this.finished = false;
    }

    update_progress() {
        if (this.finished)
            return;

        let done = 0;
        let failed = 0;
        let total = 0;
        let errors = [];
        for (let [path, asset] of Object.entries(this.player.director.library.assets)) {
            // TODO hm. inherit_uses can make assets that are used but not yet loaded
            if (! asset.used)
                continue;

            if (asset.exists === true) {
                done++;
            }
            else if (asset.exists === false) {
                this.successful = false;
                failed++;
                errors.push(`${path} -- boom!\n`);
            }
            total++;
        }
        this.done_el.textContent = String(done);
        this.total_el.textContent = String(total);
        this.progress_bar.style.setProperty('--progress', String(total ? done / total : 1));
        // TODO figure out what to actually show the audience
        //this.errors_el.textContent = errors.join('');

        if (done === total) {
            this.finished = true;
            if (this.successful) {
                this.element.classList.add('--finished');
                this.status_heading.textContent = 'ready';
            }
            else {
                this.element.classList.add('--failed');
                this.status_heading.textContent = 'failed';
            }
        }
    }
}

class PlayerPauseOverlay extends PlayerOverlay {
    constructor(player) {
        super(player);
        this.element.classList.add('gleam-overlay-pause');
        this.body.append(
            mk('h2', 'Paused'),
            mk('p',
                {style: 'text-align: center'},
                "Volume:",
                this.volume_slider = mk('input', {
                    type: 'range',
                    min: 0,
                    max: 1,
                    step: 0.05,
                    value: player.director.master_volume,
                }),
            ),
            //this.fullscreen_button = mk('button', {type: 'button'}, "Fullscreen"),
            this.beats_list = mk('ol.gleam-pause-beats'),
        );

        // TODO options (persist!!): volume, hide UI entirely (pause button + progress bar), take screenshot?, low power mode (disable text shadows and the like) or disable transitions entirely (good for motion botherment)
        // TODO links to currently active assets?  sorta defeats bandcamp i guess, but i always did want a jukebox mode
        // TODO debug stuff, mostly current state of actors

        // Options
        // FIXME i realize it's hard to know for sure what's a good volume when the music is not playing.  but this is a common problem i guess.
        this.volume_slider.addEventListener('change', ev => {
            let volume = ev.target.value;
            player.director.master_volume = volume;
            for (let actor of Object.values(player.director.actors)) {
                // FIXME oh this is just stupid, but how am i supposed to get this down there?  ...event, maybe?
                // FIXME persist, probably
                // FIXME separate mute button?
                if (actor instanceof Jukebox.Actor) {
                    actor.master_volume = volume;
                }
            }
        });

        /*
        // FIXME this needs to scale and/or border the whole player, somehow
        this.fullscreen_button.addEventListener('click', ev => {
            if (document.fullscreenElement === this.player.container) {
                document.exitFullscreen();
            }
            else {
                this.player.container.requestFullscreen();
            }
        });
        */

        // Navigation list
        this.beats_list.addEventListener('click', ev => {
            let li = ev.target.closest('.gleam-pause-beats li');
            if (! li)
                return;
            let b = parseInt(li.getAttribute('data-beat-index'), 10);
            // TODO hm, instant jump?  curtain?
            this.player.unpause();
            this.player.director.jump(b);
        });
    }

    show() {
        // Populate navigation -- this could be done once, but that would break
        // in the editor, and it's quick enough to just do whenever the pause
        // screen comes up (though obviously it won't update if you edit beats
        // while paused)
        let script = this.player.script;
        let cursor = this.player.director.cursor;
        let fragment = document.createDocumentFragment();
        let number_next_beat = false;
        let bm = 0;
        for (let [i, beat] of script.beats.entries()) {
            let li = make_element('li');
            let b = i + 1;
            if (bm < script.bookmarks.length && i === script.bookmarks[bm][0]) {
                li.textContent = `${b} — ${script.bookmarks[bm][1]}`;
                li.classList.add('--bookmark');
                bm++;
            }
            else if (number_next_beat || i === cursor || b % 10 === 0 || b === 1 || b === script.beats.length) {
                number_next_beat = false;
                li.textContent = String(b);
            }
            li.setAttribute('data-beat-index', i);
            if (i === cursor) {
                li.classList.add('--current');
            }
            fragment.appendChild(li);

            if (script.steps[beat.last_step_index].kind.is_major_transition) {
                // TODO ok this is extremely hokey to put in an <ol>
                fragment.append(make_element('hr'));
                number_next_beat = true;
            }
        }

        this.beats_list.textContent = '';
        this.beats_list.append(fragment);

        super.show();
    }
}

class Player {
    constructor(script, library) {
        this.script = script;
        this.stage_container = mk('div.gleam-stage');
        this.container = mk('div.gleam-player', {tabindex: -1}, this.stage_container);
        this.update_container_size();
        // TODO indicate focus, and not-focus, but probably not in editor
        this.paused = false;
        this.loaded = false;

        // Do this as early as possible, so it loads first
        // FIXME this should very much be taken from the script and also configurable etc
        //this.set_default_font('Comfortaa');

        // TODO what's a reasonable default for a library?  remote based on location of the script (or the calling file), of course, but...?
        this.director = new Director(script, library);

        // Create some player UI
        // Loading overlay
        // FIXME how does this interact with the editor?  loading status is still nice, but having to click play is very silly
        // FIXME hide pause button until loading is done
        this.container.classList.add('--loading');
        this.loading_overlay = new PlayerLoadingOverlay(this);
        this.loading_overlay.show();
        this.container.appendChild(this.loading_overlay.element);

        // Pause screen
        this.pause_overlay = new PlayerPauseOverlay(this);
        this.container.appendChild(this.pause_overlay.element);
        // Pause button
        // Normally I'd love for something like this to be a <button>, but I
        // explicitly DO NOT want it to receive focus -- if the audience clicks
        // it to unpause and then presses spacebar to advance, it'll just
        // activate the pause button again!
        this.pause_button = make_element('div', 'gleam-pause-button');
        this.pause_button.innerHTML = svg_icon_from_path("M 5,1 V 14 M 11,1 V 14");
        this.pause_button.addEventListener('click', ev => {
            // Block counting this as an advancement click
            ev.stopPropagation();

            this.toggle_paused();
        });
        this.container.appendChild(this.pause_button);

        // Playback progress ticker
        this.progress_element = make_element('div', 'gleam-progress');
        // FIXME it is not entirely clear how this should be updated
        this.container.appendChild(this.progress_element);

        // Add the actors to the DOM
        for (let [name, actor] of Object.entries(this.director.actors)) {
            // FIXME whoopsie doodle, where do promises go here if the actors
            // construct elements themselves?  standard property on Actor
            // maybe?  worst case, stuff loaded in the background already,
            // right?
            this.stage_container.append(actor.element);
        }

        this.script.intercom.addEventListener('gleam-role-added', ev => {
            let role = ev.detail.role;
            let actor = this.director.role_to_actor.get(role);
            // FIXME what if roles are reordered?
            this.stage_container.append(actor.element);
        });

        // Bind some useful user input event handlers
        this.container.addEventListener('click', ev => {
            this.director.advance();
        });
        this.container.addEventListener('keydown', ev => {
            if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey)
                return;

            if (ev.key === "Pause" || ev.key.toUpperCase() === "P") {
                ev.preventDefault();
                this.toggle_paused();
            }
            else if (ev.key === " " || ev.key === "ArrowRight") {
                ev.preventDefault();
                this.director.advance();
            }
            else if (ev.key === "ArrowLeft") {
                ev.preventDefault();
                this.director.backtrack();
            }
        });
        // Handle swipes to go back/forwards
        // TODO some visual feedback on this...?  hm
        // TODO a general "jump_by" helper?  the notion of advancement complicates that slightly though
        let current_touch_stats = {};
        this.container.addEventListener('touchstart', ev => {
            for (let touch of ev.changedTouches) {
                current_touch_stats[touch.identifier] = {
                    t0: performance.now(),
                    x0: touch.clientX,
                    y0: touch.clientY,
                    done: false,
                };
            }
        });
        this.container.addEventListener('touchmove', ev => {
            // FIXME this should preventDefault...  in some cases??
            for (let touch of ev.changedTouches) {
                let touch_stat = current_touch_stats[touch.identifier];
                if (touch_stat.done)
                    continue;
                touch_stat.t1 = performance.now();
                let dt = touch_stat.t1 - touch_stat.t0;
                let dx = touch.clientX - touch_stat.x0;
                if (dt > 0 && Math.abs(dx) > SWIPE_THRESHOLD) {
                    let vx = dx / dt;
                    if (Math.abs(vx) > SWIPE_VELOCITY) {
                        if (vx > 0 && this.director.cursor > 0) {
                            // Swipe right, meaning move backwards
                            this.director.backtrack();
                        }
                        else if (vx < 0) {
                            // Swipe left, meaning move forwards
                            this.director.advance();
                        }
                        // Either way, ignore this touch now
                        touch_stat.done = true;
                    }
                }
            }
        });
        this.container.addEventListener('touchend', ev => {
            for (let touch of ev.changedTouches) {
                delete current_touch_stats[touch.identifier];
            }
        });
        this.container.addEventListener('touchcancel', ev => {
            for (let touch of ev.changedTouches) {
                delete current_touch_stats[touch.identifier];
            }
        });

        // requestAnimationFrame handle.  If this exists, we're doing per-frame
        // updates
        this.raf_handle = null;
        // Bound method used with requestAnimationFrame
        this.on_frame_bound = this.on_frame.bind(this);
        // Timestamp of the last animation frame, for finding dt
        this.last_timestamp = null;
    }

    // Add the player to a parent element and set it running
    inject(parent) {
        parent.append(this.container);
        this._run_frame_loop();
    }
    // Remove the player from the document and stop it
    detach() {
        this.container.remove();
        this._stop_frame_loop();
    }

    update_container_size() {
        this.container.style.width = `${this.script.width}px`;
        this.container.style.height = `${this.script.height}px`;
    }

    // TODO this is not ideal, exactly; figure out a broader styling concept, later
    set_default_font(family) {
        // TODO add this to the loading progress?  which...  is part of the director, hmmm
        // TODO what if the name is bogus?
        GOOGLE_FONT_LOADER.load(family);
        // TODO escaping?  and this might be the wrong generic fallback
        this.container.style.fontFamily = `"${family}", sans-serif`;
    }

    // ------------------------------------------------------------------------
    // Running stuff

    update(dt) {
        this.director.update(dt);
        // FIXME Oh this is very bad, probably replace with events the director fires
        this.progress_element.style.setProperty('--progress', this.director.cursor / (this.script.beats.length - 1) * 100 + '%');
    }

    _run_frame_loop() {
        if (this.raf_handle)
            return;

        // rAF doesn't give entirely consistent timestamps, and occasionally
        // may give them in the PAST (which causes negative dt, which is bad),
        // so always use the first frame to grab a timestamp and nothing else
        this.raf_handle = window.requestAnimationFrame(timestamp => {
            this.last_timestamp = timestamp;
            this.raf_handle = window.requestAnimationFrame(this.on_frame_bound);
        });
    }
    _stop_frame_loop() {
        if (! this.raf_handle)
            return;

        this.last_timestamp = null;
        window.cancelAnimationFrame(this.raf_handle);
        this.raf_handle = null;
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

        this.director.pause();

        this._stop_frame_loop();
        this.pause_overlay.show();
        this.container.classList.add('--paused');
    }

    unpause() {
        if (!this.paused)
            return;
        this.paused = false;

        this.director.unpause();

        // TODO state issue, maybe: what if we unpause before we're loaded, i guess?
        this._run_frame_loop();
        this.pause_overlay.hide();
        this.container.classList.remove('--paused');
    }

    on_frame(timestamp) {
        // If our container leaves the document, stop the loop
        if (! this.container.isConnected) {
            this._stop_frame_loop();
            return;
        }

        let dt = (timestamp - this.last_timestamp) / 1000;
        this.last_timestamp = timestamp;

        if (this.loaded) {
            this.update(dt);
        }
        else {
            // TODO probably don't need to update this at 60 fps
            this.loading_overlay.update_progress();

            if (this.loading_overlay.finished) {
                if (this.loading_overlay.successful) {
                    // TODO don't keep updating progress while waiting
                    this.loaded = true;
                }
                else {
                    // TODO mark us as permanently broken -- no more updates
                    // TODO one day, allow retrying the broken request!
                    // TODO or let the audience decide to go anyway??
                }
            }
        }

        this.raf_handle = window.requestAnimationFrame(this.on_frame_bound);
    }
}

let ret = {
    VERSION: VERSION,
};
for (let obj of [
    mk,
    make_element,
    svg_icon_from_path,

    Step,
    Beat,

    Role,
    Actor,
    Stage,
    Curtain,
    Mural,
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
