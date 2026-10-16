import { LOAD } from "./defox/gui/load.js";
import { GUI } from "./defox/gui/gui.js";
import { GUI as GC } from "./cyborg/gui.js";

import { GUI as GA } from "./axanael/gui.js";
import { GUI as GG } from "./gekko/gui_gekko.js";

window.onload = async () => {
    await LOAD.startup();
    await GUI.startup();
    GC.startup();
    GA.startup();
    GG.startup();
};

