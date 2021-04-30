import PlayerOverlay from "./player-overlay";
import {CAN_PLAY_AUDIO} from "./can-play-audio";
import {mk} from "./util";

export default class PlayerLoadingOverlay extends PlayerOverlay {
    /**
     * @param {Player} player
     */
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
