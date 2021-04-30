import Role from "./role";
import Actor from "./actor";
import {CAN_PLAY_AUDIO} from "./can-play-audio";
import {mk} from "./util";

export default class Jukebox extends Role {
    /**
     * @param {string} name
     */
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

    /**
     * @param {string} track_name
     * @param {string} path
     * @param {boolean} loop
     */
    add_track(track_name, path, loop = true) {
        this.tracks[track_name] = {
            path: path,
            loop: loop,
        };
    }

    generate_initial_state() {
        return {
            track: null,
        };
    }
}
Jukebox.register('jukebox');
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
    /**
     * @param {Role} role
     * @param {Director} director
     */
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
