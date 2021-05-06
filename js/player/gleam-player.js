"use strict";
// Very high level:
// This isn't really a visual novel engine.  It's just an HTML state engine.
// Each step is a set of states of various components (e.g., "the dialogue box
// is showing this text" or "this background is visible"), and all the engine
// actually does is adjust the states as appropriate.  Even the transitions are
// all CSS.

// Browser features used include:
// Element.closest
// Node.remove

import Actor from "./actor";
import AssetLibrary from "./asset-library";
import Beat from "./beat";
import Character from "./character";
import Curtain from "./curtain";
import DialogueBox from "./dialogue-box";
import Director from "./director";
import Jukebox from "./jukebox";
import Mural from "./mural";
import PictureFrame from "./picture-frame";
import Player from "./player";
import RemoteAssetLibrary from "./remote-asset-library";
import Role from "./role";
import Script from "./script";
import Stage from "./stage";
import Step from "./step";

import {mk, svg_icon_from_path} from "./util";
import {VERSION} from "./version";

export {
    VERSION,
    mk,
    svg_icon_from_path,

    Step,
    Beat,

    Role,
    Actor,
    Stage,
    Curtain,
    Mural,
    DialogueBox,
    Jukebox,
    PictureFrame,
    Character,

    AssetLibrary,
    RemoteAssetLibrary,

    Script,
    Director,
    Player,
}
