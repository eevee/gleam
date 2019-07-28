// Very high level:
// This isn't really a visual novel engine.  It's just an HTML state engine.
// Each step is a set of states of various components (e.g., "the dialogue box
// is showing this text" or "this background is visible"), and all the engine
// actually does is adjust the states as appropriate.  Even the transitions are
// all CSS.
window.Gleam = (function() {
"use strict";

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

    build_into(container) {}

    update(dt) {
    }
}

class Stage extends Actor {
}
Stage.prototype.ACTIONS = {
    pause: {
    },
};

class Curtain extends Actor {
}
Curtain.prototype.ACTIONS = {
    
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
Jukebox.prototype.ACTIONS = {
    play: {
        args: ['track'],
        method: 'play',
    },
};

class PictureFrame extends Actor {
    constructor(position) {
        super();
        this.views = [];
        this.active_view_name = null;

        this.initial_state = {
            pose: null,
        };
    }

    static from_legacy_json(json) {
        let pf = new this(json.position);
        for (let [key, value] of Object.entries(json.views)) {
            pf.add_view(key, value);
        }
        return pf;
    }

    // TODO don't really love "view" as the name for this
    add_view(name, tmp_image_url) {
        this.views[name] = [{ url: tmp_image_url }];
    }

    build_into(container) {
        let element = make_element('div', 'gleam-pictureframe');
        // FIXME add position class
        this.element = element;
        container.appendChild(element);

        let view_elements = {};
        let img_promises = [];
        for (let [view_name, frames] of Object.entries(this.views)) {
            let frame_elements = view_elements[view_name] = [];
            for (let frame of frames) {
                let image = make_element('img');
                // Bind the event handler FIRST -- if the image is cached, it
                // might load instantly!
                img_promises.push(promise_event(image, 'load', 'error'));
                // FIXME who controls urls, eh
                image.setAttribute('src', 'res/species-sirens-new/' + frame.url);
                image.setAttribute('data-view-name', view_name);
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
            $x = $element.find('.-visible')
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
    //    @views[name] = frames

    show(view_name) {
        let view = this.views[view_name];
        if (! view)
            throw new Error(`No such view ${view_name} for this picture frame`);

        this.element.classList.remove('-immediate')
        // TODO? $el.css marginLeft: "#{offset or 0}px"

        if (view_name === this.active_view_name)
            return;
        if (this.active_view_name) {
            // FIXME do every frame's element i guess
            this.views[this.active_view_name].element.classList.remove('-visible');
        }
        this.active_view_name = view_name;

        let child = view.element;
        if (child.classList.contains('-visible'))
            return;

        child.classList.add('-visible');
        let promise = promise_transition(child);

        /* TODO animation stuff
        delay = $target_child.data 'delay'
        if delay
            setTimeout (=> @_advance $el, view_name, 0), delay
        */

        return promise;
    }

    disable() {
        // The backdrop has a transition delay so there's no black flicker
        // during a transition (when both images are 50% opaque), but when
        // we're hiding the entire backdrop, we don't want that.  This class
        // disables it.
        this.element.classList.add('-immediate');

        this.active_view_name = null;

        let promises = [];
        for (let child of this.element.childNodes) {
            if (! child.classList.has('-visible'))
                continue;

            promises.push(promise_transition(child));
            child.classList.remove('-visible');
        }

        return Promise.all(promises);
    }

    /* FIXME animation stuff
    _advance: ($el, view_name, current_index) =>
        $view_elements = $el.data 'view-elements'
        $current = $view_elements[view_name][current_index]
        next_index = (current_index + 1) % $view_elements[view_name].length
        $next = $view_elements[view_name][next_index]

        if not $current.hasClass '-visible'
            return

        $current.removeClass '-visible'
        $next.addClass '-visible'

        delay = $next.data 'delay'
        if delay
            setTimeout (=> @_advance $el, view_name, next_index), delay
    */
}
PictureFrame.prototype.STEP_TYPES = [{
    name: 'show',
    arg_name: 'pose',
}, {
    name: 'hide',
}];
class Step {
}
Step.prototype.propagate = true;
class PictureFrameShowStep {

}
PictureFrameShowStep.prototype.propagate = false;


class Character extends Actor {
    delegate_say(text) {
        this.xxx_dialogue_box.say(text);
    }
}
Character.prototype.ACTIONS = {
    say: {
        args: ['text'],
        method: 'delegate_say',
        pause: true,
    },
};

class DialogueBox extends Actor {
    constructor() {
        super();
    }

    build_into(container) {
        this.element = make_element('div', 'gleam--dialoguebox');
        container.appendChild(this.element);
    }

    say(text) {
        this._build_dialogue(text);
        return true;
    }

    _build_dialogue(text) {
        let source = document.createElement('div');
        source.innerHTML = text;
        let target = document.createDocumentFragment();

        let current_node = source.firstChild;
        let current_target = target;
        let all_letters = [];
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
                    if (all_letters.length && ch === " ") {
                        let letter = all_letters[all_letters.length - 1];
                        letter.textContent += ch;
                        all_word_endings.push(letter);
                    }
                    else {
                        let letter = document.createElement('span');
                        letter.textContent = ch;
                        all_letters.push(letter)
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

        for (let letter of all_letters) {
            letter.classList.add('-hidden');
        }

        let container = document.createElement('div');
        container.className = 'gleam--dialogue';
        container.appendChild(target);
        this.element.appendChild(container);
        this.all_letters = all_letters;
        this.cursor = -1;
    }

    _next_letter() {
        this.cursor++;
        return this.cursor;
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

    _change: (event, speaker, text) ->
        $el = $ event.currentTarget
        if text == ""
            # TODO all the speaker handling is hacky ugh.  this is just to
            # allow setting the class before actually showing any text, to fix
            # the transition on the terminal in scrapgoats
            if speaker and speaker.position
                $el.attr 'data-position', speaker.position
            @_hide event
            return
        $el.removeClass '-hidden'

        $el.attr 'data-state', ''
        $dialogue = @_build_dialogue text
        # Remove everything...  but not the speaker tag, because we want to
        # fade that out smoothly.
        $el.children().not('.cutscene--speaker').remove()
        $el.append $dialogue

        # Purge old speaker tags
        # TODO man this code all sucks; stick in separate method plz
        $old_speakers = $el.find('.cutscene--speaker')
        if speaker == $old_speakers.data 'speaker'
            leave_speaker = true
        else
            leave_speaker = false

        if not leave_speaker
            $old_speakers.removeClass '-active'
            promise_event $old_speakers, 'transitionend'
                .done -> $old_speakers.remove()

        # TODO super weird bug: set the transition time to something huge like
        # 10s and mash arrow keys mid-transition and sometimes you end up with
        # dialogue attributed to the wrong speaker!
        if leave_speaker
            # do nothing
        else if speaker and speaker.name?
            rgb_color = normalize_color speaker.color
            background_color = rgb_color.replace /^rgb([(].+)[)]$/, "rgba$1, 0.8)"

            # TODO need to reset this when anything else happens ugh
            $el.css
                backgroundColor: background_color
                color: speaker.color

            $speaker = $('<div>',
                class: 'cutscene--speaker'
                text: speaker.name
                css: backgroundColor: speaker.color
                data: speaker: speaker
            )
            $speaker.attr 'data-position', speaker.position
            $el.append $speaker
            # Force recompute or this won't actually transition anything
            $speaker[0].offsetTop
            $speaker.addClass '-active'
        else
            $el.css
                backgroundColor: ''
                color: ''
            $el.removeAttr 'data-position'
        if speaker and speaker.position
            $el.attr 'data-position', speaker.position

        @_start_scrolling $dialogue

        return


    _start_scrolling: ($dialogue) ->
        ###
        Start scrolling the current text into view, if applicable.

        Returns true iff there was any text to display.
        ###
        if $dialogue.data 'timeout'
            # Already running!
            return true
        if 'done' == $dialogue.parent().attr 'data-state'
            # Nothing left to do!
            return false

        all_letters = $dialogue.data 'all_letters'
        $all_letters = $(all_letters)

        letter_index = @_next_letter $dialogue
        if letter_index >= all_letters.length
            # The end of the text is visible, so, nothing to do here
            $dialogue.parent().attr 'data-state', 'done'
            return false

        # Hide all the letters so we start from scratch
        $all_letters.addClass '-hidden'

        @_scroll $dialogue, all_letters, letter_index
        return true

    _scroll: ($dialogue, all_letters, letter_index) ->
        # Do some math: figure out where the bottom of the available space is
        # now, and in the case of text that doesn't fit in the box all at once,
        # "slide" all the previously-shown text out of the way.
        next_letter_top = all_letters[letter_index].offsetTop
        container_bottom = $dialogue.offsetParent().height() + next_letter_top
        $dialogue.css 'margin-top', all_letters[0].offsetTop - next_letter_top

        $dialogue.parent().attr 'data-state', 'scrolling'

        cb = =>
            $dialogue.data timeout: null
            state = $dialogue.parent().attr 'data-state'

            while true
                el = all_letters[letter_index]
                if not el
                    $dialogue.parent().attr 'data-state', 'done'
                    return

                # TODO this doesn't work if we're still in the middle of loading oops
                # TODO i don't remember what the above comment was referring to
                # If we ran out of room, stop here and wait for a "next" event
                if el.offsetTop + el.offsetHeight >= container_bottom
                    $dialogue.parent().attr 'data-state', 'waiting'
                    return

                letter_index++
                $(el).removeClass '-hidden'

                if state != 'fill'
                    break

            if el and el.textContent == "\f"
                # TODO this will break the pause button during this delay
                # TODO also i don't think we'll catch stage:next correctly?
                $dialogue.data timeout: setTimeout cb, 500
            else
                $dialogue.data timeout: requestAnimationFrame cb

        cb()

    _possibly_fill: (event, $el) ->
        ###
        Called when the stage receives a "next" event.  Possibly interrupts it.

        1. If the text is still scrolling, fill the textbox instead of
        advancing to the next step.
        2. If the textbox is full but there's still more text to show, scroll
        down and keep going instead of advancing to the next step.
        ###
        $dialogue = $el.children '.cutscene--dialogue'
        if not $dialogue.length
            return

        # TODO if there's only one character left, maybe don't count this as a fill?
        # TODO i don't remember what that meant either  :(

        if $dialogue.data 'timeout'
            # Case 1: Still running -- update state so the next update knows to fill
            $dialogue.data paused: false
            $dialogue.parent().attr 'data-state', 'fill'
            event.preventDefault()
        else if @_start_scrolling $dialogue
            # Case 2: more text to show
            event.preventDefault()

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

        $el.removeClass '-hidden'
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
        $el.addClass '-hidden'
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

class Script {
    constructor() {
        this.actors = {
            __dialogue__: new DialogueBox(),
        };

        this.steps = [
            [this.actors.__dialogue__, 'say', "The quick brown fox jumps over the lazy dog's back."],
            [this.actors.__dialogue__, 'say', "Jackdaws love my big sphinx of quartz."],
        ];

        this.cursor = 0;
    }

    static from_legacy_json(json) {
        let script = new Script();
        script._load_legacy_json(json);
        return script;
    }
    _load_legacy_json(json) {
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
            // FIXME
            if (actor_def.type === 'character') {
                this.actors[name].xxx_dialogue_box = this.actors['__dialogue__'];
            }
        }

        // FIXME do i want to keep this step format?  on the one hand, named args!  on the other hand, passing this big blob in feels like a mess.
        this.steps = json.script;
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

    advance() {
        return;  // FIXME have not figured out how this works yet
        while (true) {
            let step = this.steps[this.cursor];
            if (! step)
                return;

            // FIXME don't allow arbitrary methods, use a dict of messages
            //let [actor, method, ...args] = step;
            //let pause = actor[method](...args);
            
            let actor_name = step.actor;
            let actor = this.actors[actor_name];
            let action = actor.ACTIONS[step.action];
            let args = [];
            for (let argname of action.args) {
                args.push(step[argname]);
            }
            actor[action.method](...args);

            this.cursor++;
            if (action.pause)
                return;
        }
    }

    update(dt) {
        for (let [name, actor] of Object.entries(this.actors)) {
            actor.update(dt);
        }
    }
}

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

function make_sample_step_element(actor_editor, step_type) {
    let el = make_element('div', 'gleam-editor-step');
    // FIXME how does name update?  does the actor editor keep a list, or do these things like listen for an event on us?
    el.appendChild(make_element('div', '-who', actor_editor.name));
    el.appendChild(make_element('div', '-what', step_type.name));
    // FIXME how does more than one arg work
    if (step_type.arg_name) {
        el.appendChild(make_element('div', '-how', `[${step_type.arg_name}]`));
    }
    //el.setAttribute('draggable', 'true');
    return el;
}

function make_step_element(actor_editor, step_type) {
    let el = make_element('div', 'gleam-editor-step');
    // FIXME how does name update?  does the actor editor keep a list, or do these things like listen for an event on us?
    el.appendChild(make_element('div', '-who', actor_editor.name));
    el.appendChild(make_element('div', '-what', step_type.name));
    // FIXME how does more than one arg work
    if (step_type.arg_name) {
        el.appendChild(make_element('div', '-how', `[${step_type.arg_name}]`));
    }
    //el.setAttribute('draggable', 'true');
    return el;
}


// -----------------------------------------------------------------------------
// Editors for individual actor types

class ActorEditor {
    constructor(main_editor) {
        this.main_editor = main_editor;

        let throwaway = document.createElement('div');
        throwaway.innerHTML = this.HTML;
        this.container = throwaway.firstElementChild;  // FIXME experimental, ugh
        this.actor = new this.ACTOR_TYPE;

        this.name = 'bogus';

        // Add step templates
        // FIXME this is for picture frame; please genericify
        for (let step_type of this.actor.STEP_TYPES) {
            this.container.appendChild(make_sample_step_element(this, step_type));
        }

        // Enable dragging steps into the script
        for (let el of this.container.querySelectorAll('.gleam-editor-step')) {
            el.setAttribute('draggable', 'true');
        }
        this.container.addEventListener('dragstart', e => {
            e.dataTransfer.dropEffect = 'copy';
            e.dataTransfer.setData('text/plain', null);
            // FIXME oughta create a pristine new step element
            this.main_editor.start_step_drag(e.target.cloneNode(true));
        });
    }

    get name() {
        return this._name;
    }
    set name(name) {
        this._name = name;
        this.container.querySelector('header > h2').textContent = name;
    }
}


// FIXME you should NOT be able to make more of these
class StageEditor extends ActorEditor {
}
StageEditor.prototype.ACTOR_TYPE = Stage;
StageEditor.prototype.HTML = `
    <li class="gleam-editor-component-stage">
        <header>
            <h2>stage</h2>
        </header>
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
        <div class="gleam-editor-step gleam-editor-step-stage">
            <div class="-who">stage</div>
            <div class="-what">pause</div>
        </div>
    </li>
`;


class PictureFrameEditor extends ActorEditor {
}
PictureFrameEditor.prototype.ACTOR_TYPE = PictureFrame;
PictureFrameEditor.actor_type_name = 'picture frame';
PictureFrameEditor.prototype.HTML = `
    <li class="gleam-editor-component-pictureframe">
        <header>
            <h2>backdrop</h2>
        </header>
        <h3>Poses <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
        <ul class="gleam-editor-component-pictureframe-poses">
        </ul>
        <button>preview</button>
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
    </li>
`;


// List of all actor editor types
const ACTOR_EDITOR_TYPES = [
    StageEditor,
    PictureFrameEditor,
];


// -----------------------------------------------------------------------------
// Main editor

class Editor {
    constructor(script, container, player_container) {
        // FIXME inject_into method or something?  separate view?
        this.container = container;
        this.player = new Player(script, player_container);

        this.assets = [];

        this.xxx_steps = [];

        let step_list = make_element('ul', 'gleam-editor-steps');
        for (let step of script.steps) {
            let li = make_element('li');
            step_list.appendChild(li);
            //li.innerHTML = `<span class="-actor-type">${step.actor}</span>: <span class="-actor-name">${step.actor}</span> ${step.action}: ${step[2]}`;
            let xxx_step_output = '';
            for (let [key, value] of Object.entries(step)) {
                if (key === 'actor' || key === 'action')
                    continue;

                xxx_step_output += `<p>${key} — ${value}</p>`;
            }
            li.innerHTML = `
                <div class="-who">
                    <span class="-actor-name">${step.actor}</span>
                    <span class="-action">${step.action}</span>
                </div>
                <div class="-what">
                    ${xxx_step_output}
                </div>
            `;
        }
        //this.container.appendChild(step_list);

        this.assets_container = document.getElementById('gleam-editor-assets');

        // XXX test junk for uploading directories
        // FIXME? this always takes a moment to register, not sure why...
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
            let reader = entry.createReader();
            reader.readEntries(entries => {
                entries.sort((a, b) => {
                    let p = a.name;
                    let q = b.name;
                    // By some fucking miracle, JavaScript can do
                    // human-friendly number sorting already, hallelujah
                    return p.localeCompare(q, undefined, { numeric: true });
                });

                let ol = this.assets_container.querySelector('.gleam-editor-assets');
                ol.textContent = '';
                for (let entry of entries) {
                    ol.appendChild(make_element('li', null, entry.name));
                }
                console.log(entries);
                console.log(entries[0]);
                let file = entries[0];
                console.log(file.name);
            }, console.error)
        });

        // Components editor
        this.component_editors = [];
        this.components_container = document.getElementById('gleam-editor-components');
        this.components_el = this.components_container.querySelector('.gleam-editor-components');
        for (let component_editor_type of ACTOR_EDITOR_TYPES) {
            let button = make_element('button', null, 'new');
            button.addEventListener('click', ev => {
                let component_editor = new component_editor_type(this);
                this.component_editors.push(component_editor);
                this.components_el.appendChild(component_editor.container);
            });
            this.components_container.appendChild(button);
        }

        // Wire up the steps container
        this.steps_container = document.getElementById('gleam-editor-steps');
        this.steps_el = this.steps_container.querySelector('.gleam-editor-steps');
        // TODO i dont know how to do this tbh
        for (let el of this.steps_el.querySelectorAll('.gleam-editor-step')) {
            el.setAttribute('draggable', 'true');
        }
        this.step_drag = null;
        /*
         * FIXME restore
        this.steps_el.addEventListener('dragstart', e => {
            e.dataTransfer.dropEffect = 'move';  // FIXME?  should be set in enter/over?
            e.dataTransfer.setData('text/plain', null);
            dragged_step = e.target;
            dragged_step.classList.add('gleam-editor--dragged-step');
        });
        */
        // Note that this fires on the original target, and NOT if the original node is moved???
        this.steps_el.addEventListener('dragend', e => {
            // FIXME return dragged step to where it was, if it was dragged from the step list in the first place
            this.end_step_drag();
        });

        // Set up dropping a step into the script (either from elsewhere in the
        // script, or from an actor)
        // Fires repeatedly on a valid drop target, which FIXME I thought was determined by dragenter???
        this.steps_container.addEventListener('dragover', ev => {
            // Only listen to drags of steps
            if (this.step_drag === null) {
                return;
            }
            ev.preventDefault();

            // GOAL: Find where the step should be inserted based on the mouse
            // position, or in other words, which step the mouse is aiming at.
            let steps = this.steps_el.querySelectorAll('.gleam-editor-step');

            // If there are no steps, there's nothing to do: a new step can
            // only be inserted at position 0.
            let position;
            if (steps.length === 0) {
                position = 0;
            }
            else {
                // If the mouse is already over a step, we're basically done.
                let cy = ev.clientY;
                let pointed_step = ev.target;
                while (pointed_step && ! pointed_step.classList.contains('gleam-editor-step')) {
                    pointed_step = pointed_step.parentNode;
                    if (! this.steps_el.contains(pointed_step)) {
                        pointed_step = null;
                        break;
                    }
                }
                if (pointed_step) {
                    let rect = pointed_step.getBoundingClientRect();
                    position = Array.indexOf(steps, pointed_step);
                    if (cy > (rect.top + rect.bottom) / 2) {
                        position++;
                    }
                }
                else {
                    // The mouse is outside the list.  Resort to a binary
                    // search of the steps' client bounding rects, which are
                    // relative to the viewport, which is pretty appropriate
                    // for a visual effect like drag and drop.
                    let l = steps.length;
                    let a = 0;
                    let b = l;
                    while (a < b) {
                        let n = Math.floor((a + b) / 2);
                        let rect = steps[n].getBoundingClientRect();
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

            this.step_drag.position = position;

            // Ensure the cursor is in the step list, and adjust its position
            // FIXME position changes a bit depending on whether the new step pauses or not
            let cursor = this.step_drag.cursor;
            if (! cursor.parentNode) {
                this.steps_el.appendChild(cursor);
            }

            let cursor_y;
            if (steps.length === 0) {
                cursor_y = 0;
            }
            else if (position >= steps.length) {
                let last_step = steps[steps.length - 1];
                cursor_y = last_step.offsetTop + last_step.offsetHeight;
            }
            else {
                cursor_y = steps[position].offsetTop;
            }
            cursor.style.top = `${cursor_y}px`;
        });
        // Fires when leaving a valid drop target (but actually when leaving
        // any child of it too, ugh?  XXX check on this)
        this.steps_container.addEventListener('dragleave', e => {
            if (! this.step_drag) {
                return;
            }
            if (e.target !== e.currentTarget) {
                return;
            }

            // Hide the cursor and clear out the step position if we're not
            // aiming at the step list
            this.step_drag.position = null;

            let cursor = this.step_drag.cursor;
            if (cursor.parentNode) {
                cursor.parentNode.removeChild(cursor);
            }
        });
        this.steps_container.addEventListener('drop', e => {
            let step_el = this.step_drag.step_el;
            // Dropping onto nothing is a no-op
            if (this.step_drag.position === null) {
                return;
            }
            // Dragging over oneself is a no-op
            if (step_el === this.step_drag.target) {
                return;
            }

            e.preventDefault();

            this.insert_step(step_el, this.step_drag.position);
        });
        // Cancel the default behavior of any step drag that makes its way to
        // the root; otherwise it'll be interpreted as a navigation or
        // something
        document.documentElement.addEventListener('drop', ev => {
            if (this.step_drag) {
                ev.preventDefault();
                this.end_step_drag();
            }
        });
    }

    start_step_drag(step_el) {
        this.step_drag = {
            // Step being dragged
            step_el: step_el,
            // Element showing where the step will be inserted
            cursor: make_element('hr', 'gleam-editor-step-cursor'),
            // Existing step being dragged over
            target: null,
            // Position to insert the step
            position: null,
            // True if the drag is aimed near the bottom of the target, and the
            // drag should insert after it (otherwise, above/before)
            aiming_below: false,
        };
    }
    end_step_drag() {
        let cursor = this.step_drag.cursor;
        if (cursor.parentNode) {
            cursor.parentNode.removeChild(cursor);
        }

        if (this.step_drag.step_el) {
            this.step_drag.step_el.classList.remove('gleam-editor--dragged-step');
        }

        this.step_drag = null;
    }

    remove_step(step_el) {
    }

    insert_step(step_el, position) {
        console.log(step_el, position);
        let steps = this.steps_el.querySelectorAll('.gleam-editor-step');
        // TODO handle pauses...
        if (steps.length === 0) {
            let li = make_element('li');
            this.steps_el.appendChild(li);
            li.appendChild(step_el);
        }
        else {
            let previous_step = steps[position - 1];
            previous_step.parentNode.insertBefore(step_el, previous_step.nextElementSibling);
        }
            // TODO associate with step; add step to our own step list; insert into script; etc, etc
    }
}


// FIXME give a real api for this.  question is, how do i inject into the editor AND the player
window.addEventListener('load', e => {
    //let script = Script.from_legacy_json(XXX_TEST_SCRIPT);
    let script = new Script();
    let editor = new Editor(script, document.querySelector('.gleam-editor'), document.querySelector('.gleam-player'));
    //editor.player.play();
});

return {
    Script: Script,
    Player: Player,
    Editor: Editor,
};
})(window);
