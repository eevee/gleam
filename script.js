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


// Actors are controlled by Steps
class Step {
    constructor(actor) {
        this.actor = actor;
    }

    static from_legacy_json(actor, json) {
        return new this(actor);
    }
}
// Set to true if this step should pause and wait for user input
Step.prototype.pause = false;
// Set to false if this step's effect should only apply for one verse; for
// example, changing a character pose should propagate, but a line of dialogue
// should not
Step.prototype.propagate = true;


class Stage extends Actor {
}
class Stage_Pause extends Step {}
Stage_Pause.display_name = 'pause';  // TODO?
Stage_Pause.prototype.pause = true;
// XXX i don't love that this is implicitly keyed on json names?  hm
Stage.prototype.STEP_TYPES = {
    pause: Stage_Pause,
};


class Curtain extends Actor {
}
class Curtain_Lower extends Step {}
Curtain.prototype.STEP_TYPES = {
    lower: Curtain_Lower,
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
class Jukebox_Play extends Step {
    constructor(actor, track_name) {
        super(actor);
        this.track_name = track_name;
    }

    static from_legacy_json(actor, json) {
        return new this(actor, json.track);
    }
}
class Jukebox_Stop extends Step {}
Jukebox.prototype.STEP_TYPES = {
    play: Jukebox_Play,
    stop: Jukebox_Stop,
};

class PictureFrame extends Actor {
    constructor(position) {
        super();
        this.poses = [];
        this.active_pose_name = null;

        this.initial_state = {
            pose: null,
        };
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
        let element = make_element('div', 'gleam-pictureframe');
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
                // FIXME who controls urls, eh
                image.setAttribute('src', 'res/species-sirens-new/' + frame.url);
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
    //    @poses[name] = frames

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
            this.poses[this.active_pose_name].element.classList.remove('-visible');
        }
        this.active_pose_name = pose_name;

        let child = pose.element;
        if (child.classList.contains('-visible'))
            return;

        child.classList.add('-visible');
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
            if (! child.classList.has('-visible'))
                continue;

            promises.push(promise_transition(child));
            child.classList.remove('-visible');
        }

        return Promise.all(promises);
    }

    /* FIXME animation stuff
    _advance: ($el, pose_name, current_index) =>
        $pose_elements = $el.data 'pose-elements'
        $current = $pose_elements[pose_name][current_index]
        next_index = (current_index + 1) % $pose_elements[pose_name].length
        $next = $pose_elements[pose_name][next_index]

        if not $current.hasClass '-visible'
            return

        $current.removeClass '-visible'
        $next.addClass '-visible'

        delay = $next.data 'delay'
        if delay
            setTimeout (=> @_advance $el, pose_name, next_index), delay
    */
}
class PictureFrame_Show extends Step {
    constructor(actor, pose_name) {
        super(actor);
        this.pose_name = pose_name;
    }

    static from_legacy_json(actor, json) {
        return new this(actor, json.pose);
    }
}
class PictureFrame_Hide extends Step {
}
PictureFrame.prototype.STEP_TYPES = {
    show: PictureFrame_Show,
    hide: PictureFrame_Hide,
};


class Character extends Actor {
    delegate_say(text) {
        this.xxx_dialogue_box.say(text);
    }
}
class Character_Say extends Step {
    constructor(actor, phrase) {
        super(actor);
        this.phrase = phrase;
    }

    static from_legacy_json(actor, json) {
        return new this(actor, json.text);
    }
}
Character_Say.prototype.pause = true;
Character.prototype.STEP_TYPES = {
    say: Character_Say,
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
class DialogueBox_Say extends Step {
    constructor(actor, phrase) {
        super(actor);
        this.phrase = phrase;
    }

    static from_legacy_json(actor, json) {
        return new this(actor, json.text);
    }
}
DialogueBox_Say.prototype.pause = true;
DialogueBox.prototype.STEP_TYPES = {
    say: DialogueBox_Say,
};

class Script {
    constructor() {
        this.actors = {
            __dialogue__: new DialogueBox(),
            stage: new Stage(),
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
        this.steps = []
        for (let json_step of json.script) {
            if (! json_step.actor) {
                // FIXME special actions like roll_credits
                if (json_step.action == 'pause') {
                    this.steps.push(new Stage_Pause(this.actors.stage));
                }
                continue;
            }

            let actor = this.actors[json_step.actor];
            let step_type = actor.STEP_TYPES[json_step.action];
            let step = step_type.from_legacy_json(actor, json_step);
            this.steps.push(step);
        }
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
    el.classList.add(actor_editor.CLASS_NAME);
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

function make_step_element(actor_editor, step) {
    let el = make_element('div', 'gleam-editor-step');
    el.classList.add(actor_editor.CLASS_NAME);
    // FIXME how does name update?  does the actor editor keep a list, or do these things like listen for an event on us?
    el.appendChild(make_element('div', '-who', actor_editor.name));
    el.appendChild(make_element('div', '-what', step.constructor.name));
    // FIXME how does more than one arg work
    if (step.arg_name) {
        el.appendChild(make_element('div', '-how', `[${step_type.arg_name}]`));
    }
    // FIXME oh steps need way more metadata huh
    else if (step instanceof Character_Say) {
        el.appendChild(make_element('div', '-how', step.phrase));
    }
    else if (step instanceof Jukebox_Play) {
        el.appendChild(make_element('div', '-how', step.track_name));
    }
    else if (step instanceof PictureFrame_Show) {
        el.appendChild(make_element('div', '-how', step.pose_name));
    }
    //el.setAttribute('draggable', 'true');
    return el;
}

// Wrapper for a step that also keeps ahold of the step element and the
// associated ActorEditor
class EditorStep {
    constructor(actor_editor, step_type, ...args) {
        this.actor_editor = actor_editor;
        if (step_type instanceof Step) {
            this.step = step_type;
        }
        else {
            this.step = new step_type(...args);
        }
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

        this.name = 'bogus';

        // Add step templates
        // FIXME this is for picture frame; please genericify
        this.step_type_map = new Map();  // step element => step type
        for (let step_type of Object.values(this.actor.STEP_TYPES)) {
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
            // FIXME oughta create a pristine new step element
            let step_type = this.step_type_map.get(e.target);
            this.main_editor.start_step_drag(new EditorStep(this, step_type));
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
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
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
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
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
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
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
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
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
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
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
        <h3>Steps <span class="gleam-editor-hint">(drag and drop into script)</span></h3>
    </li>
`;


// List of all actor editor types
const ACTOR_EDITOR_TYPES = [
    StageEditor,
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

class Editor {
    constructor(script, container, player_container) {
        // FIXME inject_into method or something?  separate view?
        this.container = container;
        this.player = new Player(script, player_container);

        // TODO be able to load existing steps from a script

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
            let button = make_element('button', null, 'new');
            button.addEventListener('click', ev => {
                this.add_actor_editor(new actor_editor_type(this));
            });
            this.actors_container.appendChild(button);
        }

        // Script panel
        // TODO maybe move this into its own type or something, it's pretty noisy
        this.steps = [];  // list of EditorSteps
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

            // If there are no steps, there's nothing to do: a new step can
            // only be inserted at position 0.
            let position;
            if (this.steps.length === 0) {
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
                    for (let [i, step] of this.steps.entries()) {
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
                    let l = this.steps.length;
                    let a = 0;
                    let b = l;
                    while (a < b) {
                        let n = Math.floor((a + b) / 2);
                        let rect = this.steps[n].element.getBoundingClientRect();
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
            if (this.steps.length === 0) {
                cursor_y = 0;
            }
            else if (position >= this.steps.length) {
                let last_step = this.steps[this.steps.length - 1].element;
                cursor_y = last_step.offsetTop + last_step.offsetHeight;
            }
            else {
                cursor_y = this.steps[position].element.offsetTop;
            }
            cursor.style.top = `${cursor_y}px`;
        });
        // Fires when leaving a valid drop target (but actually when leaving
        // any child of it too, ugh?  XXX check on this)
        this.steps_container.addEventListener('dragleave', e => {
            if (! this.step_drag) {
                return;
            }
            // FIXME ah this doesn't always work, christ
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
            if (! this.step_drag) {
                return;
            }

            let step = this.step_drag.step;
            let position = this.step_drag.position;
            // Dropping onto nothing is a no-op
            if (position === null) {
                return;
            }
            // Dragging over oneself is a no-op
            if (step.element === this.step_drag.target) {
                return;
            }

            e.preventDefault();

            // End the drag first, to get rid of the cursor which kinda fucks
            // up element traversal
            this.end_step_drag();

            this.insert_step(step, position);
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
            if (step.pause) {
                this.steps_el.appendChild(group);
                group = make_element('li');
            }
        }
        if (group.children.length > 0) {
            this.steps_el.appendChild(group);
        }

        this.assets.refresh_dom();
    }

    add_actor_editor(actor_editor) {
        this.actor_editors.push(actor_editor);
        this.actors_el.appendChild(actor_editor.container);
    }

    start_step_drag(step) {
        this.step_drag = {
            // EditorStep being dragged
            step: step,
            // Element showing where the step will be inserted
            cursor: make_element('hr', 'gleam-editor-step-cursor'),
            // Existing step being dragged over
            target: null,
            // Position to insert the step
            position: null,
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

        // Add to the DOM
        // FIXME there's a case here that leaves an empty <li> at the end
        if (this.steps.length === 1) {
            // It's the only child!
            let group = make_element('li');
            group.appendChild(step.element);
            this.steps_el.appendChild(group);
        }
        else {
            // FIXME adding at position 0 doesn't work, whoops
            let previous_step = this.steps[position - 1];
            let previous_el = previous_step.element;
            let group = previous_el.parentNode;
            let next_group = group.nextElementSibling;
            // Time to handle pauses.
            if (previous_step.step.pause) {
                // Inserting after a step that pauses means we need to go at
                // the beginning of the next group.
                if (! next_group || step.step.pause) {
                    // If there's no next group, or we ALSO pause, then we end
                    // up in a group by ourselves regardless.
                    let new_group = make_element('li');
                    new_group.appendChild(step.element);
                    this.steps_el.insertBefore(new_group, next_group);
                }
                else {
                    next_group.insertBefore(step.element, next_group.firstElementChild);
                }
            }
            else {
                // Inserting after a step that DOESN'T pause is easy, unless...
                if (step.step.pause) {
                    // Ah, we DO pause, so we need to split everything after
                    // ourselves into a new group.
                    let new_group = make_element('li');
                    while (previous_el.nextElementSibling) {
                        new_group.appendChild(previous_el.nextElementSibling);
                    }
                    if (new_group.children) {
                        this.steps_el.insertBefore(new_group, next_group);
                    }
                }

                // Either way, we end up tucked in after the previous element.
                group.insertBefore(step.element, previous_el.nextElementSibling);
            }
        }
    }
}

let XXX_TEST_SCRIPT = {
    "asset_root": ".",
    "name": "species-sirens-new",
    "title": "Species Ref: Beholding Sirens (new)",
    "date": "2017-09-04",
    "preview": "preview.png",
    "credits": {
        "people": [
            {
                "who": "Glip",
                "for": "Art, Music",
                "website": "http://glitchedpuppet.com/",
                "deviantart": "glitchedpuppet",
                "tumblr": "glitchedpuppet",
                "twitter": "glitchedpuppet"
            },
            {
                "who": "Eevee",
                "for": "Programming",
                "website": "https://eev.ee/",
                "deviantart": "lexyeevee",
                "tumblr": "lexyeevee",
                "twitter": "eevee"
            }
        ],
        "footer_html": [
            "<a href='http://floraverse.com/'>Floraverse</a>",
            "<a href='https://floraverse.bandcamp.com/'>Bandcamp</a>",
            "1ogout successſul",
            "␄"
        ]
    },
    "actors": {
        "curtain": {
            "type": "curtain"
        },
        "jukebox": {
            "type": "jukebox",
            "tracks": {
                "talab_4": "talab_4.ogg",
                "talab_5": "talab_5.ogg"
            }
        },
        "backdrop": {
            "type": "spot",
            "position": "backdrop",
            "views": {
                "splash": "title.png",
                "monitor": "monitor.png",
                "epilogue1": "epilogue1.png",
                "epilogue2": "epilogue2.png",
                "epilogue3": "epilogue3.png",
                "epilogue4": "epilogue4.png"
            }
        },
        "siren": {
            "type": "spot",
            "position": "imagespot-goat",
            "views": {
                "bigtall": "bigtall.png",
                "beehair": "beehair.png",
                "onearm": "onearm.png",
                "flowerball": "flowerball.png",
                "%%%%%": "IMAGE_DAINTY.gif",
                "!!!!!": "IMAGE_NOIMAGE.gif"
            }
        },
        "interaction": {
            "type": "character",
            "position": "interaction",
            "name": null,
            "color": "black"
        },
        "data": {
            "type": "character",
            "position": "data",
            "name": null,
            "color": "black"
        }
    },
    "script": [
        {
            "actor": "backdrop",
            "action": "show",
            "view": "splash"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": ""
        },
        {
            "actor": "jukebox",
            "action": "play",
            "track": "talab_4"
        },
        {
            "actor": "backdrop",
            "action": "show",
            "view": "monitor"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "<span class='-term'>Local Panel TY_KN_01</span>\n\f\f<span class='-panel'>New hardware detected. Connect to the Cybernet to look for drivers?</span>\n\n&gt; \fN\n\n&gt; \fDreamTransfer.tx\n\f\f<span class='-panel'>DREAM DATA AUDIO/VIDEO TRANSFER PROGRAM -K1D NE0N</span>\n\n&gt; \fLATEST\n<span class='-panel'>COZMO77.DDF</span>\n\n&gt; \fCONVERT COZMO77\n<span class='-panel'>PLEASE WAIT...\nCOZMO77.TDF SUCCESSFULLY CREATED</span>\n\n&gt; \fexit"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "<span class='-term'>Local Panel TY_KN_01</span>\n\n&gt; datasheet.txt cozmo77.tdf -scanner\n<span class='-panel'>For help, please type ? or 'help'</span>\n\n&gt; \fdatasheet.txt cozmo77.tdf \f-scan\f\n<span class='-panel'>For help, please type ? or 'help'</span>\n\n&gt; \fhey TAL\n\n<span class='-tal'>Hello, Dr. Neon! Did you mean to type -analyze?</span>\n\n&gt; what's the analyze argument\n&gt; oh\n&gt; ty\n\n<span class='-tal'>Is there anything else I can help with?</span>\n\n&gt; not atm\n\n<span class='-tal'>Understood.</span>\n\n&gt; datasheet.txt cozmo77.tdf -analyze\n\nSIRENS, COMMON\n\n<span class='-panel'>ANALYZING. PLEASE WAIT.\n\f.\f.\f.\fDONE.</span>\n\n&gt; \flist\n<span class='-panel'>SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6</span>\n\n&gt; \fdisplay subj_1 - subj_6"
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "bigtall"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>SUBJ_1 - IMAGE_BIGTALL\nHereditary influence: None\nEnvironmental influence: High\nLanguage: Audio scans detect similarities to Abyssal.\nAffinity: None detected, suggesting Spirit or a variant.\nWeaknesses: No data available.\nResistances: No data available.</span>"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "Neon Note: Build suggests immense physical strength and agility. Despite appearances, its claws are dull. Sirens prefer dealing crushing blows to slashing, as crushing is less likely to kill a fleeing victim."
        },
        {
            "actor": "data",
            "action": "say",
            "text": "Note to self: Ask Cozmo if freckles are real, and if markings around eyes are natural or eyeliner. Sirens aren't ever found on Owel, so how do they possess knowledge of common cosmetic markings?"
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "beehair"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>SUBJ_2 - IMAGE_BEEHAIR\nHereditary influence: None\nEnvironmental influence: High\nLanguage: Audio scans detect similarities to Abyssal.\nAffinity: None detected, suggesting Spirit or its variants.\nWeaknesses: No data available.\nResistances: No data available.</span>"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "Neon Note: The appearance of this siren makes no sense, aesthetically speaking. It may be attempting to camouflage itself as one of the local trees. The presence of the highly venomous bee abominations gives my hypothesis some validity. Its elongated eyelashes are similar to those of the bees, suggesting that it is capable of controlling them, or communicating with them. The bees detected Cozmo almost as soon as he stepped foot into the gorge, which must have been the reason the Sirens knew of his impending arrival."
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "onearm"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>SUBJ_3 - IMAGE_ONEARM\nHereditary influence: None\nEnvironmental influence: High\nLanguage: Audio scans detect similarities to Abyssal.\nAffinity: None detected, suggesting Spirit or its variants.\nWeaknesses: No data available.\nResistances: No data available.</span>"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "Neon Note: This siren seems to have sacrificed its individual \"beauty\" in favor of utility. Its comparatively plain body and stoic expression forces one's eyes to look at the flowers it wears. Initial scans suggest that these flowers are capable of rotating, which would almost certainly produce a hypnotic effect. This would validate theories of individuals being controlled by Sirens.\n\nNote to self: Ask Cozmo if flowers can spin."
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "flowerball"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>SUBJ_4 - IMAGE_FLOWERBALL\nHereditary influence: None\nEnvironmental influence: High\nLanguage: Audio scans detect similarities to Abyssal.\nAffinity: None detected, suggesting Spirit or its variants.\nWeaknesses: No data available.\nResistances: No data available.</span>"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "Neon Note: The smallest and \"cutest\" of the bunch. Cultivating an appearance of meekness and timidity is a proven Siren strategy. And the rosy cheeks are evidence that Sirens are capable of learning what our cultures find appealing. The flower attachment is most likely a lure, similar to that of a deep-sea anglerfish. Probably contains some kind of contact or airborne poison."
        },
        {
            "actor": "siren",
            "action": "hide"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "<span class='-panel'>End of file.</span>"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "&gt; \f\flist\n<span class='-panel'>SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4</span>\n\n&gt; \flist subj_5 subj_6\n<span class='-panel'>SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4</span>\n\n&gt; \f\fdisplay subj_5"
        },
        {
            "actor": "jukebox",
            "action": "play",
            "track": "talab_5"
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "%%%%%"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>SUBJ_5 - No data available\nHereditary influence: No data available\nEnvironmental influence: No data available\nLanguage: No data available\nAffinity: No data available\nWeaknesses: No data available.\nResistances: No data available.</span>"
        },
        {
            "actor": "siren",
            "action": "hide"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "&gt; \f\fdisplay subj_4"
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "flowerball"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>SUBJ_4 - IMAGE_FLOWERBALL\nHereditary influence: None\nEnvironmental influence: High\nLanguage: Audio scans detect similarities to Abyssal.\nAffinity: None detected, suggesting Spirit or its variants.\nWeaknesses: No data available.\nResistances: No data available.</span>"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "Neon Note: The smallest and \"cutest\" of the bunch. Cultivating an appearance of meekness and timidity is a proven Siren strategy. And the rosy cheeks are evidence that Sirens are capable of learning what our cultures find appealing. The flower attachment is most likely a lure, similar to that of a deep-sea anglerfish. Probably contains some kind of contact or airborne poison."
        },
        {
            "actor": "siren",
            "action": "hide"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "&gt; display subj_5"
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "%%%%%"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>SUBJ_5 - No data available\nHereditary influence: No data available\nEnvironmental influence: No data available\nLanguage: No data available\nAffinity: No data available\nWeaknesses: No data available.\nResistances: No data available.</span>"
        },
        {
            "actor": "siren",
            "action": "hide"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "&gt; what??\n&gt; \f\fTAL what's wrong with the image\n\n<span class='-tal'>There does not appear to be anything wrong with it. Could you be more specific about the problem you are experiencing?</span>\n\n&gt; \fit's glitching uot\n&gt; out*\n&gt; \fi can't tell what it's supposed to be at all; there are streaks of purple and white\n\n<span class='-tal'>Are you able to view the other images?</span>\n\n&gt; i could see subj1-4 and just rechecked one to be sure and it's still fine; 5 is the one that has issues"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "&gt; \fwait does that mean you can see it\n\n<span class='-tal'>Yes.</span>\n\n&gt; \fcan you see subj1 through 6??\n\n<span class='-tal'>I can see subj1-5.</span>\n\n&gt; \fokay\n&gt; \fum\n&gt; \fwhat does subj5 look like? a short desc is fine.\n\n<span class='-tal'>A dainty, purple horse. Pink leaves adorning a long white mane and tail. Face with three eyes. Would you like more detail?</span>\n\n&gt; no that's good, thanks. i'll just troubleshoot it later and add more observations myself."
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "<span class='-tal'>Is there anything else I can do for you?</span>\n\n&gt; no. thanks though.\n&gt; \f\fwait yes actually\n&gt; what about subj_6???\n\n<span class='-tal'>What are you referring to?</span>\n\n&gt; \fwhat? there were 6 in the original list, can you see it or not\n\n<span class='-tal'>I do not see a subj_6.</span>\n\n&gt; ugh\n&gt; okay. thanks."
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "&gt; \fdisplay \f\fsubj_6"
        },
        {
            "actor": "siren",
            "action": "show",
            "view": "!!!!!"
        },
        {
            "actor": "data",
            "action": "say",
            "text": "<span class='-panel'>\f\fSUB\f\f\fJ_\f6 - \f\f\f\f\fSUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6 SUBJ_1 SUBJ_2 SUBJ_3 SUBJ_4 SUBJ_5 SUBJ_6...</span>"
        },
        {
            "actor": "siren",
            "action": "hide"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "<span class='-panel'>Too many results to display. Try refining your search.</span>\n\n&gt; \f\fdisplay \"subj_6\"\n<span class='-panel'>PLEASE WAIT.\n\f...DONE.</span>\n\n&gt; \flist\n<span class='-panel'>PLEASE \fWAIT.\n\f...DONE.</span>\n\n&gt; \flist all\n<span class='-panel'>PLE\fAS\fE WA\fIT.\n\f\f\f...DONE.</span>\n\n&gt; \flist subj_6\n<span class='-panel'>P\fL\fE\fA\fS\fE \fW\fA\fI\fT.</span>"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "<span class='-term'>Local Panel TY_KN_01</span>\n\n&gt; \fdatasheet.txt cozmo77.tdf -restore_backup\n<span class='-panel'>PLEA\f\fSE WAI\f\f\f\fT.</span>"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "<span class='-term'>Local Panel TY_KN_01</span>\n\n&gt; \foh my god what\n&gt; TAL please tell me there's a backup of my data\n\n<span class='-tal'>There has been no activity on my end. I can only restore data from remote panels. Are you on a local panel?</span>\n\n&gt; \f\f\f\foh\n&gt; \fmy\n&gt; \fgod\n\n<span class='-tal'>Is there anything I can do to help?</span>\n\n&gt; asjhgfjhdgg\n&gt; \fi'll just try to restore it on my end\n&gt; god damnit\n\n<span class='-panel'>REBOOTING. PLEASE WAIT.</span>\n\n&gt; stop\n&gt; abort"
        },
        {
            "actor": "interaction",
            "action": "say",
            "text": "\f\f\f\f<span class='-term'>Local Panel TY_KN_01</span>\n\f\f<span class='-panel'>New hardware detected. Connect to the Cybernet to look for drivers?</span>\n\n&gt; NO\n\n\f<span class='-panel'>Installing drivers.</span>\n\n&gt; stop\n&gt; abort\n&gt; x\n&gt; ^X\n\n\f\f<span class='-panel'>ERROR</span>\n\n\f\f<span class='-panel'>ERROR</span>\n\n\f\f<span class='-panel'>ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR ERROR</span>\n\n\f\f<span class='-panel'>Hardware-level failure detected. Installation cannot continue.</span>"
        },
        {
            "action": "notext"
        },
        {
            "actor": "jukebox",
            "action": "play",
            "track": "talab_4"
        },
        {
            "actor": "backdrop",
            "action": "show",
            "view": "epilogue1"
        },
        {
            "action": "pause"
        },
        {
            "actor": "backdrop",
            "action": "show",
            "view": "epilogue2"
        },
        {
            "action": "pause"
        },
        {
            "actor": "backdrop",
            "action": "show",
            "view": "epilogue3"
        },
        {
            "action": "pause"
        },
        {
            "actor": "backdrop",
            "action": "show",
            "view": "epilogue4"
        },
        {
            "action": "pause"
        },
        {
            "actor": "jukebox",
            "action": "stop"
        },
        {
            "actor": "curtain",
            "action": "lower"
        },
        {
            "actor": "backdrop",
            "action": "hide"
        },
        {
            "action": "roll_credits"
        }
    ]
};

// FIXME give a real api for this.  question is, how do i inject into the editor AND the player
window.addEventListener('load', e => {
    let script = Script.from_legacy_json(XXX_TEST_SCRIPT);
    //let script = new Script();
    let editor = new Editor(script, document.querySelector('.gleam-editor'), document.querySelector('.gleam-player'));
    //editor.player.play();
});

return {
    Script: Script,
    Player: Player,
    Editor: Editor,
};
})(window);
