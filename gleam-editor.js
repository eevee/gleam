// FIXME <button>s should be type=button
// FIXME remove make_element probably
"use strict";
if (! window.Gleam) {
    throw new Error("Gleam player must be loaded first!");
}
Object.assign(window.Gleam, (function() {

let make_element = Gleam.make_element;
let mk = Gleam.mk;
let svg_icon_from_path = Gleam.svg_icon_from_path;

function human_friendly_sort(filenames) {
    filenames.sort((a, b) => {
        // By some fucking miracle, JavaScript can do
        // human-friendly number sorting already, hallelujah
        return a.localeCompare(b, undefined, { numeric: true });
    });
}

// Very basic overlay handling
// TODO maybe the overlay should be an object.
// TODO maybe the overlay should be able to operate as a promise
// TODO the overlay should be able to position itself by the mouse cursor, if opened in response to a click
// TODO a transient overlay should probably disappear on document blur?
function open_overlay(element) {
    let overlay = make_element('div', 'gleam-editor-overlay');
    overlay.appendChild(element);
    document.body.appendChild(overlay);

    // Remove the overlay when clicking outside the element
    overlay.addEventListener('click', ev => {
        close_overlay(overlay);
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
        // Let things respond to the closing
        overlay.dispatchEvent(new CustomEvent('gleam-overlay-closed'));
        overlay.remove();
        return overlay;
    }
}

// Wrapper around a modal that lives above everything else, e.g. a fake popup
// menu or a dialog.  Note that the constructor also displays the overlay!
// TODO maybe it shouldn't?
// TODO unsure about ergonomics
// FIXME this very poorly handles a very long list, i think?
// FIXME convert other overlays to use this
class Overlay {
    constructor(element, is_transient) {
        this.is_transient = is_transient;
        this.element = element;

        this.container = make_element('div', 'gleam-editor-overlay');
        this.container.appendChild(element);
        document.body.appendChild(this.container);

        if (is_transient) {
            // Remove a transient overlay when clicking outside the element
            this.container.addEventListener('click', ev => {
                this.dismiss();
            });
            // But ignore any click on the element itself
            element.addEventListener('click', ev => {
                ev.stopPropagation();
            });
        }
        else {
            // Force reflow so the modal transition happens
            // TODO this is ugly, maybe idk use an animation instead
            // TODO this isn't much of a transition either?
            this.container.offsetTop;
            this.container.classList.add('--modal');
        }

        // Create a promise to contain our state
        this.promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    // Resolve the Promise with a value, then close the overlay
    choose(value) {
        this._resolve(value);
        this._close();
    }

    // Reject the Promise, then close the overlay
    dismiss() {
        this._reject();
        this._close();
    }

    // Close and destroy the overlay, WITHOUT touching the Promise
    _close() {
        this.container.remove();
    }
}

class PopupMenuOverlay extends Overlay {
    constructor(options, make_label, mouse_event = null) {
        // FIXME genericize this class
        let list = mk('ol.gleam-editor-arg-enum-poses');
        for (let [i, option] of options.entries()) {
            let label = make_label(option);
            if (label === null || label === undefined)
                continue;

            let li = mk('li', {'data-index': i});
            if (label instanceof Array) {
                li.append(...label);
            }
            else {
                li.append(label);
            }
            list.append(li);
        }

        super(list, true);
        this.options = options;

        list.addEventListener('click', ev => {
            let li = ev.target.closest('li');
            if (! li)
                return;

            // TODO resolve(li.getAttribute('data-pose'));
            this.choose(this.options[parseInt(li.getAttribute('data-index'), 10)]);
        });

        // TODO should probably scroll to and/or highlight the current selection, if any?
        // TODO try to align with some particular text??
        // TODO finer positioning control would be nice i guess
        if (mouse_event) {
            list.style.left = `${Math.min(mouse_event.clientX, document.body.clientWidth - list.offsetWidth)}px`;
            list.style.top = `${Math.min(mouse_event.clientY, document.body.clientHeight - list.offsetHeight)}px`;
        }
    }
}

function make_inline_string_editor(initial_value, onchange) {
    let el = mk('input.gleam-editor-inline', {
        type: 'text',
        value: initial_value,
    });
    el.addEventListener('focus', ev => {
        // On focus, save the current value so we can restore it on Esc
        el.setAttribute('data-saved-value', el.value);
    });
    el.addEventListener('blur', ev => {
        // On blur, update the value
        onchange(el.value);
    });
    el.addEventListener('keydown', ev => {
        if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey)
            return;

        if (ev.key === 'Enter') {
            ev.preventDefault();
            ev.stopPropagation();
            el.blur();
        }
        else if (ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            el.value = el.getAttribute('data-saved-value');
            el.blur();
        }
    });

    return el;
}

// Dummy implementation that can't find any files, used in a fresh editor
class NullAssetLibrary extends Gleam.AssetLibrary {
    load_image(path, element) {
        let asset = this.asset(path);
        asset.used = true;
        asset.exists = false;
        element = element || mk('img');
        // XXX kind of fuzzy on when this should be added or removed, or if there should be a pending state, in which case should it also be a data attribute,
        element.classList.add('--missing');
        return element;
    }

    load_audio(path, element) {
        let asset = this.asset(path);
        asset.used = true;
        asset.exists = false;
        // TODO hmm this bit is duplicated like everywhere
        return element || mk('audio', {preload: 'auto'});
    }
}
// Entry-based implementation, for local files using the Chrome API
function _entry_to_url(entry) {
    if (entry.toURL) {
        // WebKit only
        return Promise.resolve(entry.toURL());
    }
    else {
        return new Promise((resolve, reject) => {
            entry.file(file => {
                resolve(URL.createObjectURL(file));
            });
        });
    }
}
// FIXME 'used' isn't really handled very well; there's no way to "un-use" something.  but there's also no way to delete a pose/track yet
class EntryAssetLibrary extends Gleam.AssetLibrary {
    constructor(directory_entry) {
        super();
        this.directory_entry = directory_entry;
        let resolve;
        this.done_reading_promise = new Promise((res, rej) => {
            resolve = res;
        });

        // TODO technically should be calling this repeatedly.  also it's asynchronous, not super sure if that's a problem.
        // TODO sometimes this is null?  what the fuck is up with drag and drop.
        // FIXME this should reject on error, you fool
        directory_entry.createReader().readEntries(entries => {
            // TODO hmm, should mark by whether they're present and whether they're used i guess?
            for (let entry of entries) {
                let asset = this.asset(entry.name);
                asset.exists = true;
                asset.entry = entry;
            }
            resolve();
        }, console.error)
    }

    async get_url_for_path(path) {
        // Have to finish reading the directory first
        await this.done_reading_promise;

        let asset = this.asset(path);
        asset.used = true;
        if (! asset.entry) {
            // If there's no directory entry, this can't possibly work
            asset.exists = false;
            throw new Error(`No such local file: ${path}`);
        }

        if (! asset.url) {
            asset.url = await _entry_to_url(asset.entry);
        }
        return asset.url;
    }

    // FIXME the caller never explicitly knows if this is a bogus image
    // FIXME this seems to have different semantics from Remote, especially wrt asset.url and asset.promise
    load_image(path, element) {
        element = element || mk('img');
        element.classList.add('--missing');
        // TODO handle failure somehow?
        this.get_url_for_path(path).then(url => {
            element.src = url;
            element.classList.remove('--missing');
        });

        return element;
    }

    load_audio(path, element) {
        element = element || mk('audio', {preload: 'auto'});
        // TODO handle failure somehow?
        this.get_url_for_path(path).then(url => {
            element.src = url;
        });

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

// Subclass of Script that knows how to edit itself
class MutableScript extends Gleam.Script {
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
            return Gleam.Beat.create_first(this.roles);
        }
    }

    // Call to indicate one or more Steps have been altered
    // FIXME also update bookmarks, both here and below
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

            // Keep recreating (or updating??) beats until all twiddle changes from the new step
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
            if (! beat || beat.pause) {
                new_beat_index++;
                beat = this._make_fresh_beat(new_beat_index);
                this.beats.push(beat);
            }
            new_step.update_beat(beat);
            beat.last_step_index = index;
            // TODO should update_beat do this?
            beat.pause = new_step.kind.pause;

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

            if (new_step.kind.pause) {
                // The new step pauses, so it splits this beat in half
                new_beat.pause = new_step.kind.pause;
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

            if (step.kind.pause && beat_index < this.beats.length - 1) {
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
    // FIXME check bookmarks, both existence and order
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

        this._set_steps(steps);
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
                        console.warn("Role", role, "expected twiddle:", key, "to have value:", value, "but got:", state0[key]);
                    }
                }
            }
        }

        this.steps = steps;
        this.beats = beats;
    }
}

// -----------------------------------------------------------------------------
// Step argument configuration

// FIXME these are un-tabbable.  maybe they should just be regular textboxes all the time?  would still need to do something to the popup ones though
const STEP_ARGUMENT_TYPES = {
    string: {
        view(value) {
            return make_element('div', 'gleam-editor-arg-string', value);
        },
        update(element, value) {
            element.textContent = value;
        },
        edit(element, value) {
            let editor_element = mk('input.gleam-editor-inline', {type: 'text'});
            return new Promise((resolve, reject) => {
                editor_element.value = value;
                // TODO but then, i'd love to have an editor that uses the appropriate styling, anyway
                editor_element.addEventListener('keydown', ev => {
                    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey)
                        return;

                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        resolve(editor_element.value);
                    }
                    else if (ev.key === 'Escape') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        reject();
                    }
                });
                editor_element.addEventListener('blur', ev => {
                    resolve(editor_element.value);
                });
                element.replaceWith(editor_element);
                // FIXME doesn't focus at the point where you clicked in the text, oh dear
                editor_element.focus();
            }).finally(() => {
                editor_element.replaceWith(element);
            });
        },
    },

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

                // TODO should probably scroll to and/or highlight the current pose, if any
                let overlay = open_overlay(editor_element);
                editor_element.style.left = `${Math.min(mouse_event.clientX, document.body.clientWidth - editor_element.offsetWidth)}px`;
                editor_element.style.top = `${Math.min(mouse_event.clientY, document.body.clientHeight - editor_element.offsetHeight)}px`;
                // Clicking the overlay to close the menu means cancel
                overlay.addEventListener('click', ev => {
                    reject();
                });
            });
        },
    },

    track: {
        view(value) {
            return make_element('div', 'gleam-editor-arg-enum', value);
        },
        update(element, value) {
            element.textContent = value;
        },
        edit(element, value, step, mouse_event) {
            // FIXME this is very nearly identical to the poses code
            return new Promise((resolve, reject) => {
                // FIXME this very poorly handles a very long list, and doesn't preview or anything
                // FIXME this ain't poses either
                let editor_element = make_element('ol', 'gleam-editor-arg-enum-poses');
                for (let track_name of Object.keys(step.role.tracks)) {
                    let li = make_element('li', null, track_name);
                    li.setAttribute('data-track', track_name);
                    editor_element.appendChild(li);
                }
                // Save on clicking a track
                editor_element.addEventListener('click', ev => {
                    let li = ev.target.closest('li');
                    if (! li)
                        return;

                    resolve(li.getAttribute('data-track'));
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
// Dialogs

// TODO i wonder if this would make more sense as a feature on the assets panel?  filter files by wildcard, then select all and drag them over.  i don't know how to do multi drag though
// FIXME this is inappropriate for jukebox
class AddByWildcardDialog {
    constructor(role_editor, library) {
        this.role_editor = role_editor;
        this.library = library;
        this.results = [];

        this.element = mk('div.gleam-editor-dialog');
        // TODO initialize wildcard?
        this.element.innerHTML = `
            <header><h1>Add poses in bulk</h1></header>
            <p>Filename pattern: <input type="text" class="-wildcard" placeholder="*.png"></p>
            <ul class="-files"></ul>
            <footer><button type="button" class="-cancel">Cancel</button><button disabled type="button" class="-confirm">Add 0</button></footer>
        `;

        this.textbox = this.element.querySelector('.-wildcard');
        this.result_list = this.element.querySelector('.-files');
        this.cancel_button = this.element.querySelector('.-cancel');
        this.ok_button = this.element.querySelector('.-confirm');

        this.textbox.addEventListener('input', ev => {
            if (this.text_timeout) {
                clearTimeout(this.text_timeout);
            }
            // TODO show a throbber or something while this is going so it doesn't seem just arbitrarily laggy
            this.text_timeout = setTimeout(() => {
                this.text_timeout = null;
                this.update_matches();
            }, 500);
        });

        this.cancel_button.addEventListener('click', ev => {
            close_overlay(this.element);
        });

        this.ok_button.addEventListener('click', ev => {
            this._resolve(this.results);
            // FIXME can't use close_overlay here because it'll get back to us and try to reject, lol whoops
            this.element.closest('.gleam-editor-overlay').remove();
        });
    }

    open() {
        let overlay = open_overlay(this.element);
        // Force reflow so the modal transition happens
        // TODO this is ugly, maybe idk use an animation instead
        overlay.offsetTop;
        overlay.classList.add('--modal');
        // TODO hm, state that assumes this method is only called once but that's not actually guaranteed.  maybe should have another function that actually opens the overlay (or even just do this from open_overlay!), but then how does this thing get at the resolve/reject?
        this._promise = new Promise((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
        overlay.addEventListener('gleam-overlay-closed', ev => {
            this._reject();
        });
        return this._promise;
    }

    compile_regex(wildcard) {
        let parts = wildcard.split(/([*?])/);
        // This will turn abc*def*xyz into ^(abc)(.*def.*)(xyz)$, allowing us
        // to grab the middle part as the name
        // XXX this will make it difficult to allow arbitrary regex matches.
        let rx_parts = ['^('];
        for (let [i, part] of parts.entries()) {
            if (i === 1) {
                // Gap between the first static part and the first wildcard
                rx_parts.push(')(');
            }

            if (i % 2 === 0) {
                // FIXME regex escape
                rx_parts.push(part);
            }
            else if (part === '*') {
                rx_parts.push('.*');
            }
            else if (part === '?') {
                rx_parts.push('.');
            }

            if (i === parts.length - 2) {
                // Gap between the last wildcard and the last static part
                rx_parts.push(')(');
            }
        }
        rx_parts.push(')$');
        return new RegExp(rx_parts.join(''));
    }

    update_matches() {
        let rx = this.compile_regex(this.textbox.value);
        let lib = this.library;
        let list = this.result_list;

        let library_paths = Object.keys(lib.assets);
        human_friendly_sort(library_paths);

        this.results = [];
        this.result_list.textContent = '';
        for (let path of library_paths) {
            let m = path.match(rx);
            if (m) {
                // Entire path is split into 1, 2, 3 where 2 is the name
                let name = m[2];
                // TODO detect which ones are already in use, either as a pose in this picture frame or just by something else (will require backrefs!).
                // TODO detect which names are already poses.  overwrite?  rename?
                // TODO do NOT error for existing poses that this wouldn't change
                this.result_list.append(mk('li',
                    // TODO actually support unchecking this.  also can i style the whole row based on the state of the checkbox??
                    mk('input', {type: 'checkbox', checked: ''}),
                    ' ',
                    m[1],
                    mk('span.-match', m[2]),
                    m[3],
                ));
                this.results.push([name, path]);
            }
        }

        if (this.results.length === 0) {
            this.ok_button.disabled = true;
        }
        else {
            this.ok_button.disabled = false;
        }
        this.ok_button.textContent = `Add ${this.results.length}`;
    }

    finish() {
        // FIXME what if one of these names already exists?
        for (let [name, path] of this.results) {
            this.role_editor.role.add_pose(name, path);
            // FIXME overt c/p job; also kind of invasive; also should there be sorting i wonder
            // FIXME why not just use update_assets for this?
            let li = make_element('li');
            let img = this.library.load_image(path);
            img.classList.add('-asset');
            li.append(img);
            li.appendChild(mk('p.-caption', name));
            this.role_editor.pose_list.appendChild(li);
        }

        // FIXME invasive...
        // FIXME how do i update the existing actor, then?
        this.role_editor.main_editor.player.director.role_to_actor.get(this.role_editor.role).sync_with_role(this.role_editor.main_editor.player.director);

        close_overlay(this.element);
    }
}

class MetadataDialog extends Overlay {
    constructor(metadata) {
        let cancel_button = mk('button.-cancel', {type: 'button'}, "Cancel");
        cancel_button.addEventListener('click', ev => {
            this.dismiss();
        });

        let dialog = mk('form.gleam-editor-dialog',
            mk('header', mk('h1', "Edit title")),
            // TODO style me, consider a generic dl grid
            mk('p', "Title: ", mk('input', {type: 'text', name: 'title', value: metadata.title || ''})),
            mk('p', "Subtitle: ", mk('input', {type: 'text', name: 'subtitle', value: metadata.subtitle || ''})),
            mk('p', "Author: ", mk('input', {type: 'text', name: 'author', value: metadata.author || ''})),
            mk('footer',
                cancel_button,
                mk('button.-confirm', {type: 'submit'}, "Save"),
            ),
        );

        dialog.addEventListener('submit', ev => {
            let results = {};
            let form = this.element;
            results['title'] = form.elements['title'].value || null;
            results['subtitle'] = form.elements['subtitle'].value || null;
            results['author'] = form.elements['author'].value || null;
            this.choose(results);
        });
        // Allow pressing Esc on a field to abandon the dialog
        dialog.addEventListener('keydown', ev => {
            if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey)
                return;

            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                this.dismiss();
            }
        });

        super(dialog, false);
    }
}


// -----------------------------------------------------------------------------
// Editors for individual role types

class RoleEditor {
    constructor(main_editor, role) {
        this.main_editor = main_editor;
        this.role = role;

        this.element = mk('li');
        this.container = this.element;

        // Header
        this.h2_editor = make_inline_string_editor(role.name, new_name => {
            this.role.name = new_name;
            // FIXME actually change the role name in relevant places.  (where is that?  script step elements; other roles that refer to this one; does anything else use name instead of reference?)
        });
        let header = mk('header', mk('h2', this.h2_editor));
        header.classList.add(this.CLASS_NAME);
        this.element.append(header);

        // Add step templates
        for (let [step_kind_name, step_kind] of Object.entries(this.ROLE_TYPE.STEP_TYPES)) {
            let el = this.make_sample_step_element(step_kind);
            el.setAttribute('data-step-kind', step_kind_name);
            this.element.appendChild(el);
        }

        // Enable dragging steps into the script
        // FIXME doesn't check it's hitting a step
        this.element.addEventListener('dragstart', e => {
            e.dataTransfer.dropEffect = 'copy';
            e.dataTransfer.setData('text/plain', null);
            let step_kind_name = e.target.getAttribute('data-step-kind');
            let step_kind = this.role.constructor.STEP_TYPES[step_kind_name];
            let args = [];
            for (let arg_def of step_kind.args) {
                // TODO?
                args.push(null);
            }
            this.main_editor.script_panel.begin_step_drag(new Gleam.Step(this.role, step_kind_name, args));
        });
    }

    static create_role(name) {
        return new this.prototype.ROLE_TYPE(name);
    }

    make_sample_step_element(step_kind) {
        let el = make_element('div', 'gleam-editor-step');

        let handle = make_element('div', '-handle', '⠿');

        // A cheaty hack to make an element draggable only by a child handle: add
        // the 'draggable' attribute (to the whole parent) only on mousedown
        handle.addEventListener('mousedown', ev => {
            ev.target.closest('.gleam-editor-step').setAttribute('draggable', 'true');
        });
        handle.addEventListener('mouseup', ev => {
            ev.target.closest('.gleam-editor-step').removeAttribute('draggable');
        });
        // Also remove it after a successful drag
        el.addEventListener('dragend', ev => {
            ev.target.removeAttribute('draggable');
        });

        // FIXME how does name update?  does the role editor keep a list, or do these things like listen for an event on us?
        el.appendChild(mk('div.-what', handle, step_kind.display_name));
        if (step_kind.hint) {
            el.append(mk('div.-how', mk('div.gleam-editor-arg-hint', step_kind.hint)));
        }
        return el;
    }

    // FIXME i changed my mind and this should go on ScriptPanel.  only trouble is this.CLASS_NAME
    make_step_element(step) {
        let el = make_element('div', 'gleam-editor-step');

        let handle = make_element('div', '-handle', '⠿');

        // A cheaty hack to make an element draggable only by a child handle: add
        // the 'draggable' attribute (to the whole parent) only on mousedown
        handle.addEventListener('mousedown', ev => {
            ev.target.closest('.gleam-editor-step').setAttribute('draggable', 'true');
        });
        handle.addEventListener('mouseup', ev => {
            ev.target.closest('.gleam-editor-step').removeAttribute('draggable');
        });
        // Also remove it after a successful drag
        el.addEventListener('dragend', ev => {
            ev.target.removeAttribute('draggable');
        });

        // FIXME how does name update?  does the role editor keep a list, or do these things like listen for an event on us?
        let role_tag = mk('div.-who', handle, step.role.name);
        role_tag.classList.add(this.CLASS_NAME);
        el.appendChild(role_tag);
        el.appendChild(make_element('div', '-what', step.kind.display_name));

        for (let [i, arg_def] of step.kind.args.entries()) {
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


// Note that this has no role_type_name, which prevents you from creating one
class StageEditor extends RoleEditor {
}
StageEditor.prototype.ROLE_TYPE = Gleam.Stage;
StageEditor.prototype.CLASS_NAME = 'gleam-editor-role-stage';

class CurtainEditor extends RoleEditor {
}
CurtainEditor.prototype.ROLE_TYPE = Gleam.Curtain;
CurtainEditor.role_type_name = 'curtain';
CurtainEditor.prototype.CLASS_NAME = 'gleam-editor-role-curtain';

class MuralEditor extends RoleEditor {
}
MuralEditor.prototype.ROLE_TYPE = Gleam.Mural;
MuralEditor.role_type_name = 'mural';
MuralEditor.prototype.CLASS_NAME = 'gleam-editor-role-mural';

class DialogueBoxEditor extends RoleEditor {
}
DialogueBoxEditor.prototype.ROLE_TYPE = Gleam.DialogueBox;
DialogueBoxEditor.role_type_name = 'dialogue box';
DialogueBoxEditor.prototype.CLASS_NAME = 'gleam-editor-role-dialoguebox';

class JukeboxEditor extends RoleEditor {
    constructor(...args) {
        super(...args);

        this.track_list = mk('dl.gleam-editor-role-jukebox-tracks');
        this.update_assets();

        let button = mk('button', "Add tracks in bulk");
        button.addEventListener('click', async ev => {
            // FIXME Well this is awkward
            try {
                let results = await new AddByWildcardDialog(this, this.main_editor.library).open();

                // FIXME what if one of these names already exists?
                for (let [name, path] of results) {
                    // TODO loop?
                    this.role.add_track(name, path);
                    /*
                    // FIXME overt c/p job; also kind of invasive; also should there be sorting i wonder
                    // FIXME why not just use update_assets for this?
                    let li = make_element('li');
                    let img = this.library.load_image(path);
                    img.classList.add('-asset');
                    li.append(img);
                    li.appendChild(mk('p.-caption', name));
                    this.role_editor.pose_list.appendChild(li);
                    */
                }

                this.update_assets();

                // TODO this seems like it should be part of update_assets, but for ordering reasons it's called explicitly in set_library
                let director = this.main_editor.player.director;
                director.role_to_actor.get(this.role).sync_with_role(director);
            }
            catch (e) {}
        });

        this.element.append(
            mk('h3', "Tracks ", mk('span.gleam-editor-hint', "(drag and drop into script)")),
            this.track_list,
            button,
        );
    }

    update_assets() {
        // FIXME shouldn't this (and the poses list) also show the path?  but that does seem a bit, noisy...
        let fragment = document.createDocumentFragment();
        for (let [track_name, track] of Object.entries(this.role.tracks)) {
            let audio = this.main_editor.library.load_audio(track.path);
            audio.controls = true;
            audio.classList.add('-asset');
            fragment.append(
                mk('dt', track_name),
                mk('dd', audio, mk('div.-path', track.path)),
            );
        }
        this.track_list.textContent = '';
        this.track_list.append(fragment);
    }
}
JukeboxEditor.prototype.ROLE_TYPE = Gleam.Jukebox;
JukeboxEditor.role_type_name = 'jukebox';
JukeboxEditor.prototype.CLASS_NAME = 'gleam-editor-role-jukebox';

class PictureFrameEditor extends RoleEditor {
    constructor(...args) {
        super(...args);

        this.pose_list = mk('ul.gleam-editor-role-pictureframe-poses');
        this.update_assets();

        let button = mk('button', "Add poses in bulk");
        button.addEventListener('click', async ev => {
            // FIXME Well this is awkward
            try {
                let results = await new AddByWildcardDialog(this, this.main_editor.library).open();

                // FIXME what if one of these names already exists?
                for (let [name, path] of results) {
                    this.role.add_pose(name, path);
                }

                this.update_assets();

                // TODO this seems like it should be part of update_assets, but for ordering reasons it's called explicitly in set_library
                let director = this.main_editor.player.director;
                director.role_to_actor.get(this.role).sync_with_role(director);
            }
            catch (e) {}
        });

        let button2 = mk('button', "Add all poses to script (comic mode)");
        button2.addEventListener('click', ev => {
            let script = this.main_editor.script;
            // FIXME this will break if they rename stage oops
            let stage = script.role_index['stage'];
            // TODO insert_step does a lot of work; would be nice to extend it
            // to insert_steps, which adds a block of steps in bulk somewhere
            for (let [name, pose] of Object.entries(this.role.poses)) {
                script.insert_step(new Gleam.Step(this.role, 'show', [name]), script.steps.length);
                script.insert_step(new Gleam.Step(stage, 'pause', []), script.steps.length);
            }
        });

        this.element.append(
            mk('h3', "Poses ", mk('span.gleam-editor-hint', "(drag and drop into script)")),
            this.pose_list,
            button,
            button2,
        );

        // Allow dropping in an asset
        this.element.addEventListener('dragenter', ev => {
            let asset_path = ev.dataTransfer.getData('gleam/asset');
            if (asset_path) {
               ev.stopPropagation();
               ev.preventDefault();
                // TODO react to drag, somehow
            }
        });
        this.element.addEventListener('dragover', ev => {
            let asset_path = ev.dataTransfer.getData('gleam/asset');
            if (asset_path) {
               ev.stopPropagation();
               ev.preventDefault();
                // TODO react to drag, somehow
            }
        });
        this.element.addEventListener('drop', ev => {
            // TODO does this fire if dragenter disallowed the drop?
            // TODO probably don't allow adding the same asset twice...  except, well, there are reasons you might want that, sigh
            // TODO should probably allow dropping in a specific place in the asset list
            let asset_path = ev.dataTransfer.getData('gleam/asset');
            let name = asset_path.replace(/[.][^.]*$/, '');
            this.role.add_pose(name, asset_path);
            this.update_assets();

            // TODO this seems like it should be part of update_assets, but for ordering reasons it's called explicitly in set_library
            let director = this.main_editor.player.director;
            director.role_to_actor.get(this.role).sync_with_role(director);
        });
    }

    update_assets() {
        this.pose_list.textContent = '';
        for (let [pose_name, pose] of Object.entries(this.role.poses)) {
            let frame = pose[0];  // FIXME this format is bonkers
            let li = make_element('li');
            let img = this.main_editor.library.load_image(frame.url);
            // TODO umm i can't tell from here whether there's actually anything, and i'd like to have a dummy element for stuff that didn't load.
            img.classList.add('-asset');
            li.append(img);
            li.appendChild(make_element('p', '-caption', pose_name));
            this.pose_list.appendChild(li);
        }
    }
}
PictureFrameEditor.prototype.ROLE_TYPE = Gleam.PictureFrame;
PictureFrameEditor.role_type_name = 'picture frame';
PictureFrameEditor.prototype.CLASS_NAME = 'gleam-editor-role-pictureframe';


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
CharacterEditor.prototype.ROLE_TYPE = Gleam.Character;
CharacterEditor.role_type_name = 'character';
CharacterEditor.prototype.CLASS_NAME = 'gleam-editor-role-character';


// List of all role editor types
const ROLE_EDITOR_TYPES = [
    StageEditor,
    CurtainEditor,
    MuralEditor,
    DialogueBoxEditor,
    JukeboxEditor,
    PictureFrameEditor,
    CharacterEditor,
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
        this.source_text = this.body.querySelector('#gleam-editor-assets-source');
        this.list = this.body.querySelector('.gleam-editor-assets');
        this.item_index = {};  // filename => <li>

        // DOM stuff: allow dragging a local directory onto us, via the WebKit
        // file entry interface
        // FIXME? this always takes a moment to register, not sure why...
        // FIXME this should only accept an actual directory drag
        // FIXME should have some other way to get a directory.  file upload control?
        // FIXME should indicate where the files are coming from, the source of the directory
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
            console.log(item);
            let entry = item.webkitGetAsEntry();
            console.log(entry);
            // FIXME should this...  change the library entirely?  or what?  needs to update //everything//
            this.editor.set_library(new EntryAssetLibrary(entry));
        });

        // Allow dragging an asset, presumably into a role
        this.list.addEventListener('dragstart', ev => {
            ev.dataTransfer.dropEffect = 'copy';
            ev.dataTransfer.setData('gleam/asset', ev.target.textContent);
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
        let library = this.editor.library;

        if (library instanceof NullAssetLibrary) {
            this.source_text.textContent = 'no assets';
        }
        else if (library instanceof EntryAssetLibrary) {
            this.source_text.textContent = 'local files';
        }
        else if (library instanceof Gleam.RemoteAssetLibrary) {
            this.source_text.textContent = 'via the web';
        }
        else {
            this.source_text.textContent = 'unknown source';
        }

        this.list.textContent = '';
        this.item_index = {};

        let paths = Object.keys(library.assets);
        human_friendly_sort(paths);

        for (let path of paths) {
            let asset = library.assets[path];
            let li = mk('li', {draggable: 'true'}, path);
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

        // Add the toolbar
        // Add role
        let button = make_element('button', {type: 'button'});
        button.innerHTML = svg_icon_from_path("M 8,1 V 14 M 1,8 H 14");
        button.addEventListener('click', ev => {
            // FIXME more general handling of popup list
            let overlay = new PopupMenuOverlay(
                ROLE_EDITOR_TYPES,
                role_editor_type => {
                    if (! role_editor_type.role_type_name)
                        return null;
                    // TODO add explanations of these things too
                    return role_editor_type.role_type_name;
                },
                ev,
            );
            overlay.promise.then(role_editor_type => {
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
            }, () => {});
        });
        this.nav.appendChild(button);
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
            this.editor.player.director.backtrack();
        });
        this.nav.appendChild(button);
        button = make_element('button');
        button.innerHTML = svg_icon_from_path("M 1,8 H 14 M 10,3 L 15,8 L 10,13");
        button.addEventListener('click', ev => {
            this.editor.player.director.advance();
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
        //this.body.appendChild(this.beat_toolbar);

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
                //this.step_toolbar.style.transform = `translateY(${step_el.offsetTop + step_el.offsetParent.offsetTop}px)`;
                step_el.append(this.step_toolbar);
                hovered_step_el = step_el;
            }
            else {
                // TODO and hide toolbar
                hovered_step_el = null;
            }
        });

        // Click to edit an argument
        this.beats_list.addEventListener('click', ev => {
            let arg = ev.target.closest('.gleam-editor-arg');
            if (! arg)
                return;

            ev.stopPropagation();
            ev.preventDefault();

            let step_element = arg.closest('.gleam-editor-step');
            let step = this.element_to_step.get(step_element);
            let i = parseInt(arg.getAttribute('data-arg-index'), 10);
            let arg_def = step.kind.args[i];
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
                    this.drag.step.kind.pause &&
                    this.editor.script.steps[position - 1].kind.pause)
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
            this.footer.append(box);

            let dl = make_element('dl');
            box.append(
                make_element('h2', role_editor.CLASS_NAME, role_editor.role.name),
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
                // FIXME oops we don't add a new thing for new roles.
                if (dd_map)
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
    constructor(launcher) {
        this.launcher = launcher;

        // Set by load_script, called after all this setup
        this.script = null;
        this.script_slot = null;
        this.library = null;
        this.player = null;

        // Assets panel
        this.assets_panel = new AssetsPanel(this, document.getElementById('gleam-editor-assets'));
        this.roles_panel = new RolesPanel(this, document.getElementById('gleam-editor-roles'));
        this.script_panel = new ScriptPanel(this, document.getElementById('gleam-editor-script'));

        // Wire up some main UI
        this.toolbar = document.body.querySelector('#gleam-editor-toolbar');
        let make_button = (label, onclick) => {
            let button = mk('button', {type: 'button'}, label);
            this.toolbar.append(button);
            button.addEventListener('click', onclick);
            return button;
        };
        make_button("Edit title", ev => {
            new MetadataDialog(this.script).promise.then(metadata => {
                this.script.title = metadata.title;
                this.script.subtitle = metadata.subtitle;
                this.script.author = metadata.author;
                this.update_script_metadata();
            }, () => {});
        });
        make_button("Save", ev => {
            // TODO some kinda feedback, probably do this automatically, etc
            if (this.script_slot) {
                this.launcher.save_script(this.script_slot, this.script);
            }
        });
        make_button("Publish", ev => {
            let json = this.script.to_json();
            let blob = new Blob([JSON.stringify(json, null, 2)], {type: 'text/json'});
            let url = URL.createObjectURL(blob);
            let a = mk('a', {
                href: url,
                download: 'gleam-script.json',
            }, "gleam-script.json");
            // TODO dang i wish i could drag this to the local folder?
            // TODO wait.  can't i...  create this myself.
            let dialog = mk('div.gleam-editor-dialog', mk('p', "Save this file in the same directory as your assets, gleam-player.css, gleam-player.js, and index.html:"), a);
            new Overlay(dialog, true).promise.finally(() => {
                URL.revokeObjectURL(url);
            });
        });

        // Start with an empty script
        this.load_script(new MutableScript, new NullAssetLibrary);
    }

    // TODO this obviously needs ui, some kinda "i'm downloading" indication, etc
    // TODO this /has/ to be a MutableScript passed in, but boy that's awkward?  should enforce here?  can i cast it, change the prototype???
    load_script(script, library, slot) {
        if (this.player) {
            // TODO explicitly ask it to destroy itself?  dunno what that would do though
            this.player.detach();
            this.player = null;
        }

        this.script_slot = slot;
        this.script = script;
        this.library = library;
        this.player = new Gleam.Player(this.script, library);
        // XXX stupid hack, disable the loading overlay, which for local files will almost certainly not work
        this.player.loaded = true;
        this.player.loading_overlay.hide();
        this.player.container.classList.remove('--loading');

        this.update_script_metadata();

        this.assets_panel.refresh_dom();

        // XXX? Roles must be loaded FIRST, so the script panel can reference them in steps
        this.roles_panel.load_script(script, this.player.director);

        this.script_panel.load_script(script, this.player.director);
        this.script_panel.create_twiddle_footer();
        // XXX hmm, very awkward that the ScriptPanel can't do this itself because we inject the step elements into it; maybe fix that
        this.script_panel.select_beat(this.player.director.cursor);

        // Finally, set the player going
        this.player.inject(document.querySelector('#gleam-editor-player .gleam-editor-panel-body'));
    }

    update_script_metadata() {
        // TODO kind of a mess, should hold refs, etc., but the layout isn't set yet
        let meta = document.body.querySelector('#gleam-editor-header-metadata');
        // TODO show author?  show slot?
        meta.querySelector('h2').textContent = this.script.title || '(untitled)';
        meta.querySelector('h3').textContent = this.script.subtitle || '';
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

        this.player.director.library = library;
        // FIXME tell actors to re-fetch assets (aaa) (this should be the role editors' responsibility?)

        for (let actor of this.player.director.role_to_actor.values()) {
            actor.sync_with_role(this.player.director);
        }
        //this.main_editor.player.director.role_to_actor.get(this.role).sync_with_role(this.main_editor.player.director);
    }
}


////////////////////////////////////////////////////////////////////////////////
// Editor launcher, which offers some light help and a list of projects

class EditorLauncher {
    constructor() {
        this.editor = new Editor(this);
        
        // FIXME handle errors
        this.main_json = JSON.parse(window.localStorage.getItem('GLEAM'));
        if (! this.main_json) {
            this.main_json = {
                projects: {},
            };
        }

        this.root = document.querySelector('#gleam-editor-launcher');

        this.projects_ol = document.querySelector('#gleam-editor-projects-list');
        let temp_json = window.localStorage.getItem('gleam-temp');
        let temp_script = JSON.parse(temp_json);
        this.projects_ol.append(mk('li', mk('button',
            temp_script['meta']['title'] || "(untitled)",
            mk('br'),
            temp_json.length,
        )));
        for (let [slot, project] of Object.entries(this.main_json.projects)) {
            let button = mk('button', {type: 'button'},
                mk('span.-title', project.title || "(untitled)"),
                mk('span.-subtitle', project.subtitle || ""),
                mk('span.-author', project.author || ""),
                mk('span.-date', new Date(project.modified).toISOString().split(/T/)[0]),
                mk('span.-filesize', `${project.size} bytes`),
                mk('span.-beats', `${project.beat_count} beats`),
            );
            button.addEventListener('click', ev => {
                let script = MutableScript.from_json(JSON.parse(window.localStorage.getItem(slot)));
                this.editor.load_script(script, new NullAssetLibrary, slot);

                // Reveal the editor
                this.root.setAttribute('hidden', '');
                document.getElementById('gleam-editor-main').removeAttribute('hidden');
            });
            this.projects_ol.append(mk('li', button));
        }

        this.new_form = this.root.querySelector('#gleam-editor-new form');
        this.new_form.addEventListener('submit', ev => {
            ev.preventDefault();

            // Create a fresh new script
            let script = new MutableScript;
            script.add_role(new Gleam.Stage('stage'));
            script.title = this.new_form.elements['title'].value;
            script.subtitle = this.new_form.elements['subtitle'].value;
            script.author = this.new_form.elements['author'].value;
            let slot = `gleam-${Date.now()}`;
            this.save_script(slot, script);
            this.editor.load_script(script, new NullAssetLibrary, slot);

            // Reveal the editor
            this.root.setAttribute('hidden', '');
            document.getElementById('gleam-editor-main').removeAttribute('hidden');
        });
    }

    load_from_url(url) {
        let root = url;
        let root_url = new URL(root, document.location);
        //root_url = new URL('https://apps.veekun.com/flora-cutscenes/res/prompt2-itchyitchy-final/');
        // TODO should get the asset root from the script...?  that's a thing in old ones but not so much new ones
        let library = new Gleam.RemoteAssetLibrary(root_url);
        let xhr = new XMLHttpRequest;
        xhr.addEventListener('load', ev => {
            // FIXME handle errors yadda yadda
            let script = Gleam.MutableScript.from_legacy_json(JSON.parse(xhr.responseText));
            // FIXME editor doesn't know how to handle something not already in a save slot
            this.editor.load_script(script, library, null);

            // Reveal the editor
            // TODO show some kinda loading indicator
            // TODO factor this out
            this.root.setAttribute('hidden', '');
            document.getElementById('gleam-editor-main').removeAttribute('hidden');
        });
        // XXX lol
        xhr.open('GET', new URL('script.json', root_url));
        xhr.send();
    }

    save_script(slot, script) {
        let json = script.to_json();
        json.meta._editor = {
            // FIXME put library root in here so we know where to get the files, or what folder to tell the author to fetch
        };
        console.log(json);
        // TODO there's a storage event for catching if this was changed in another tab, ho hum
        /*
        let index_json = window.localStorage.getItem('gleam-editor');
        let index;
        if (index_json === undefined) {
            index = {
                projects: [],
            };
        }
        else {
            index = JSON.parse(index_json);
        }
        */

        let json_string = JSON.stringify(json);
        window.localStorage.setItem(slot, JSON.stringify(json));

        this.main_json.projects[slot] = {
            size: json_string.length,
            beat_count: script.beats.length,
            step_count: script.steps.length,
            title: script.title,
            subtitle: script.subtitle,
            author: script.author,
            modified: Date.now(),
            // TODO created?  published?
        };
        window.localStorage.setItem('GLEAM', JSON.stringify(this.main_json));
    }
}



////////////////////////////////////////////////////////////////////////////////
// Entry point

function attach_editor() {
    let launcher = new EditorLauncher();
    window._gleam_launcher = launcher;
    return launcher;
}

return {
    NullAssetLibrary: NullAssetLibrary,
    MutableScript: MutableScript,
    Editor: Editor,
    EditorLauncher: EditorLauncher,
    attach_editor: attach_editor,
};
})());
