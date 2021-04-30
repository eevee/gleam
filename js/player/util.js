/**
 * @param {string} tag_selector
 * @return {HTMLElement}
 */
export function mk(tag_selector, ...children) {
    let [tag, ...classes] = tag_selector.split('.');
    let el = document.createElement(tag);
    el.classList = classes.join(' ');
    if (children.length > 0) {
        if (!(children[0] instanceof Node) && typeof(children[0]) !== "string" && typeof(children[0]) !== "number") {
            let [attrs] = children.splice(0, 1);
            for (let [key, value] of Object.entries(attrs)) {
                el.setAttribute(key, value);
            }
        }
        el.append(...children);
    }
    return el;
}

/**
 * @param {string} d
 * @return {string}
 */
export function svg_icon_from_path(d) {
    return `<svg width="1em" height="1em" viewBox="0 0 16 16"><path d="${d}" stroke-width="2" stroke-linecap="round" stroke="white" fill="none"></svg>`;
}