import Director from "./director";
import GoogleFontLoader from "./google-font-loader";
import PlayerLoadingOverlay from "./player-loading-overlay";
import PlayerPauseOverlay from "./player-pause-overlay";
import {mk, svg_icon_from_path} from "./util";

const GOOGLE_FONT_LOADER = new GoogleFontLoader;

// borrowed from hammer.js
const SWIPE_THRESHOLD = 10;
const SWIPE_VELOCITY = 0.3;

export default class Player {
  /**
   * @param {Script} script
   * @param {AssetLibrary} library
   */
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
    this.pause_button = mk('div.gleam-pause-button');
    this.pause_button.innerHTML = svg_icon_from_path("M 5,1 V 14 M 11,1 V 14");
    this.pause_button.addEventListener('click', ev => {
      // Block counting this as an advancement click
      ev.stopPropagation();

      this.toggle_paused();
    });
    this.container.appendChild(this.pause_button);

    // Playback progress ticker
    this.progress_element = mk('div.gleam-progress');
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
  /**
   * @param {string} family
   */
  set_default_font(family) {
    // TODO add this to the loading progress?  which...  is part of the director, hmmm
    // TODO what if the name is bogus?
    GOOGLE_FONT_LOADER.load(family);
    // TODO escaping?  and this might be the wrong generic fallback
    this.container.style.fontFamily = `"${family}", sans-serif`;
  }

  // ------------------------------------------------------------------------
  // Running stuff

  /**
   * @param {number} dt
   */
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

  /**
   * @param {number} timestamp
   */
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
