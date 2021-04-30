import {mk} from "./util";

export default class GoogleFontLoader {
    constructor() {
        this.loaded_fonts = {};
    }

    // TODO i guess this could get more complicated with variants + subsets
    load(family) {
        if (this.loaded_fonts[family]) {
            return;
        }

        this.loaded_fonts[family] = true;

        let params = new URLSearchParams({
            family: family,
            // This adds font-display: swap; to each @font-face block, which
            // asks the browser to use a fallback font while the web font is
            // downloading -- this avoids invisible text on the loading screen
            display: 'swap',
        });
        document.head.append(mk('link', {
            href: `https://fonts.googleapis.com/css?${params}`,
            rel: 'stylesheet',
            type: 'text/css',
        }));
    }
}
