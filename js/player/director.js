import {mk} from "./util";

/**
 * The Director handles playback of a Script (including, of course, casting an
 * Actor for each Role).
 */
export default class Director {
  /**
   * @param {Script} script
   * @param {AssetLibrary} library
   */
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

  /**
   * @param {number} dt
   */
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