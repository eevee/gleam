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
        // tabindex to the root itself -- see what LL currently has
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
        overlay.classList.add('--transient');

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
    constructor({items, make_label, on_select, current = null}) {
        let list = mk('ol.popup-list');
        let current_el = null;
        for (let [i, item] of items.entries()) {
            let label = make_label(item);
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

            if (item === current && current_el === null) {
                li.classList.add('-current');
                current_el = li;
            }
        }

        list.addEventListener('click', ev => {
            let li = ev.target.closest('li');
            if (! li || ! list.contains(li))
                return;

            if (li === this.current_el) {
                this.close();
                return;
            }

            let i = parseInt(li.getAttribute('data-index'), 10);
            let item = this.items[i];
            this.on_select(item, i);
            this.close();
        });

        super(list);
        this.items = items;
        this.current_el = current_el;
        this.on_select = on_select;
    }

    set_position(relto) {
        // TODO cap top/bottom if this goes off the edge of the screen
        let anchor = relto.getBoundingClientRect();
        let rect = this.root.getBoundingClientRect();

        // Set a min-width equal to the width of the anchor; this is handy for places like a
        // Character's dialogue box selection, where the list will then match the size of the area
        // you click to spawn it
        this.root.style.minWidth = `${anchor.width}px`;

        // Prefer left anchoring, but use right if that would go off the screen
        if (anchor.left + rect.width > document.body.clientWidth) {
            this.root.style.right = `${document.body.clientWidth - anchor.right}px`;
        }
        else {
            this.root.style.left = `${anchor.left}px`;
        }

        // Open vertically in whichever direction has more space (with a slight bias towards opening
        // downwards).  If we would then run off the screen, also set the other anchor to constrain
        // the height.
        let top_space = anchor.top - 0;
        let bottom_space = document.body.clientHeight - anchor.bottom;
        if (top_space > bottom_space) {
            this.root.style.bottom = `${document.body.clientHeight - anchor.top}px`;
            if (rect.height > top_space) {
                this.root.style.top = `${0}px`;
            }
            if (this.current_el) {
                this.current_el.scrollIntoView({block: 'end'});
            }
        }
        else {
            this.root.style.top = `${anchor.bottom}px`;
            if (rect.height > bottom_space) {
                this.root.style.bottom = `${0}px`;
            }
            if (this.current_el) {
                this.current_el.scrollIntoView({block: 'start'});
            }
        }
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

    /**
     * @param {string} title
     */
    set_title(title) {
        this.header.textContent = '';
        this.header.append(mk('h1', {}, title));
    }

    /**
     * @param {string} label
     * @param {function} onclick
     */
    add_button(label, onclick) {
        let button = mk('button', {type: 'button'}, label);
        button.addEventListener('click', onclick);
        this.footer.append(button);
        return button;
    }

    /**
     * @param {string} label
     * @param {function} onsubmit
     */
    add_submit_button(label, onsubmit) {
        let button = mk('button', {type: 'submit'}, label);
        this.root.addEventListener('submit', onsubmit);
        this.footer.append(button);
        return button;
    }
}

/**
 * Yes/no popup dialog
 */
export class ConfirmOverlay extends DialogOverlay {
    /**
     * @param {string} message
     * @param {function} what
     */
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
