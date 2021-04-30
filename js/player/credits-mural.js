import Mural from "./mural";
import {mk} from "./util";

export default class CreditsMural extends Mural {
    /**
     * @param {string} name
     */
    constructor(name, credits) {
        let markup = mk('div');

        let people_markup = mk('dl');
        for (let contributor in credits.people || []) {
            people_markup.append(
                mk('dt', contributor['for']),
                mk('dd', contributor.who),
            );

            /*
            devart = $('<div>', class: '-deviantart').appendTo row
            if contributor.deviantart
                link = $ '<a>', href: "http://#{contributor.deviantart}.deviantart.com/"
                link.append $ '<img>', src: "img/deviantart.png", alt: "deviantArt"
                devart.append link

            tumblr = $('<div>', class: '-tumblr').appendTo row
            if contributor.tumblr
                link = $ '<a>', href: "http://#{contributor.tumblr}.tumblr.com/"
                link.append $ '<img>', src: "img/tumblr.png", alt: "Tumblr"
                tumblr.append link

            twitter = $('<div>', class: '-twitter').appendTo row
            if contributor.twitter
                link = $ '<a>', href: "https://twitter.com/#{contributor.twitter}"
                link.append $ '<img>', src: "img/twitter.png", alt: "Twitter"
                twitter.append link
            */
        }
        markup.append(people_markup);

        for (let line in credits.footer || []) {
            markup.append(mk('p', line));
        }

        /*
        "people": [
            {
                "who": "Glip",
                "for": "Art, Music, Script",
                "website": "http://glitchedpuppet.com/",
                "twitter": "glitchedpuppet"
            },
            {
                "who": "Eevee",
                "for": "Programming",
                "website": "https://eev.ee/",
                "twitter": "eevee"
            }
        ],
        "footer_html": [
            "<a href='http://floraverse.com/'>Floraverse</a>",
            "<a href='https://floraverse.bandcamp.com/'>Bandcamp</a>"
        ]
        */

        super(name, markup);
    }
}
CreditsMural.register('creditsmural');