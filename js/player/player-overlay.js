import {mk} from "./util";
import {VERSION} from "./version";

export default class PlayerOverlay {
  /**
   * @param {Player} player
   */
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