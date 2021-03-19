import {mk} from './util.js';

export function accept_drop(args) {
    let target = args.target;
    let delegate_selector = args.delegate ?? null;
    let effect = args.effect ?? 'copy';

    let mimetype = args.mimetype ?? null;
    let filter = args.filter ?? (ev => true);

    let dropzone_class = args.dropzone_class ?? null;
    let ondrop = args.ondrop;

    let is_valid = ev => {
        let data;
        if (mimetype !== null) {
            data = ev.dataTransfer.getData(mimetype);
            if (! data)
                return;
        }

        let el;
        if (delegate_selector) {
            el = ev.target.closest(delegate_selector);
            if (! el || ! target.contains(el))
                return;
        }
        else {
            el = target;
        }

        if (! filter(ev))
            return;

        return el;
    };

    let end_drop = () => {
        if (dropzone_class !== null) {
            target.classList.remove(dropzone_class);
        }
    };

    target.addEventListener('dragenter', ev => {
        if (! is_valid(ev))
            return;

        ev.stopPropagation();
        ev.preventDefault();

        ev.dataTransfer.dropEffect = effect;

        if (dropzone_class !== null) {
            target.classList.add(dropzone_class);
        }
    });
    target.addEventListener('dragover', ev => {
        if (! is_valid(ev))
            return;

        ev.stopPropagation();
        ev.preventDefault();

        ev.dataTransfer.dropEffect = effect;
    });
    target.addEventListener('dragleave', ev => {
        if (ev.relatedTarget && target.contains(ev.relatedTarget))
            return;

        end_drop();
    });
    target.addEventListener('drop', ev => {
        let el = is_valid(ev);
        if (! el)
            return;

        ev.stopPropagation();
        ev.preventDefault();

        // TODO duping is_valid, hrmm
        let data;
        if (mimetype !== null) {
            data = ev.dataTransfer.getData(mimetype);
        }

        ondrop(data, ev, el);
        end_drop();
    });
};

// Stackable modal overlay of some kind, usually a dialog
export class Overlay {
    constructor(root) {
        this.root = root;

        // Don't propagate clicks on the root element, so they won't trigger a
        // parent overlay's automatic dismissal
        this.root.addEventListener('click', ev => {
            ev.stopPropagation();
        });

        // Allow pressing Esc on a field to abandon the dialog
        // TODO this should really bind to the body and only work when the dialog is visible, OR add
        // tabindex to the root itself
        this.root.addEventListener('keydown', ev => {
            if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey)
                return;

            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                this.close();
            }
        });
    }

    open() {
        let overlay = mk('div.overlay', this.root);
        document.body.append(overlay);

        // Remove the overlay when clicking outside the element
        overlay.addEventListener('click', ev => {
            this.close();
        });

        return overlay;
    }

    close() {
        this.root.closest('.overlay').remove();
    }
}

// Overlay which vanishes when clicking outside of it
export class TransientOverlay extends Overlay {
    open() {
        let overlay = super.open();

        overlay.addEventListener('click', ev => {
            this.close();
        });

        return overlay;
    }
}

// Transient overlay styled like a popup menu
export class PopupOverlay extends TransientOverlay {
    constructor() {
        let root = mk('div.popup');
        super(root);
    }
}

export class PopupListOverlay extends TransientOverlay {
    constructor() {
        let root = mk('div.popup');
        super(root);
    }
}

// Overlay styled like a dialog box
export class DialogOverlay extends Overlay {
    constructor() {
        super(mk('form.dialog'));

        this.root.append(
            this.header = mk('header'),
            this.main = mk('section'),
            this.footer = mk('footer'),
        );
    }

    set_title(title) {
        this.header.textContent = '';
        this.header.append(mk('h1', {}, title));
    }

    add_button(label, onclick) {
        let button = mk('button', {type: 'button'}, label);
        button.addEventListener('click', onclick);
        this.footer.append(button);
    }
}

// Yes/no popup dialog
export class ConfirmOverlay extends DialogOverlay {
    constructor(message, what) {
        super();
        this.set_title("just checking");
        this.main.append(mk('p', {}, message));
        let yes = mk('button', {type: 'button'}, "yep");
        let no = mk('button', {type: 'button'}, "nope");
        yes.addEventListener('click', ev => {
            this.close();
            what();
        });
        no.addEventListener('click', ev => {
            this.close();
        });
        this.footer.append(yes, no);
    }
}
