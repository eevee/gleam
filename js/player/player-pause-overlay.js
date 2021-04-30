import PlayerOverlay from "./player-overlay";
import {mk} from "./util";
import Jukebox from "./jukebox";

export default class PlayerPauseOverlay extends PlayerOverlay {
  /**
   * @param {Player} player
   */
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
      let li = mk('li');
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
        fragment.append(mk('hr'));
        number_next_beat = true;
      }
    }

    this.beats_list.textContent = '';
    this.beats_list.append(fragment);

    super.show();
  }
}