// Given a path, gets a relevant file.  Mainly exists to abstract over the
// difference between loading a live script from a Web source and pulling from
// the user's hard drive.
// TODO should wire this into player's initial 'loading' screen
// TODO need to SOMEHOW let asset panel know when a thing happens here?  except, wait, it's the asset panel that makes things happen.  maybe a little kerjiggering can fix that then.
// FIXME this just, needs a lot of work.
export default class AssetLibrary {
  constructor() {
    this.assets = {};
    // Map of <img> to asset path, for automatic reloading
    this.images = new Map;
  }

  /**
   * @param {string} path
   * @returns {{}}
   */
  asset(path) {
    let asset = this.assets[path];
    if (asset) {
      return asset;
    }
    else {
      asset = this.assets[path] = {};
      return asset;
    }
  }

  /**
   * @param {AssetLibrary} library
   */
  inherit_uses(library) {
    for (let [path, asset] of Object.entries(library.assets)) {
      if (asset.used) {
        this.asset(path).used = asset.used;
      }
    }

    for (let [img, path] of library.images) {
      // Ignore removed images
      if (! img.isConnected)
        continue;

      let new_img = this.load_image(path, img);
      if (new_img !== img) {
        new_img.className = img.className;
        img.replaceWith(new_img);
      }
    }
  }
}