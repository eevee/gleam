window.Gleam = (function() {

class Script {
}

class Player {
    constructor(container) {
        this.container = container;
    }
}

class Editor {
    constructor(container, player_container) {
        // FIXME inject_into method or something?  separate view?
        this.container = container;
        this.player = new Player(player_container);
    }
}

// FIXME give a real api for this.  question is, how do i inject into the editor AND the player
window.addEventListener('load', e => {
    let editor = new Editor(document.querySelector('.gleam-editor'), document.querySelector('.gleam-player'));
});

return {
    Script: Script,
    Player: Player,
    Editor: Editor,
};
})(window);
