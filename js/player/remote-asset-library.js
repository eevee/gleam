import AssetLibrary from './asset-library'

// Regular HTTP fetch, the only kind available to the player
export default class RemoteAssetLibrary extends AssetLibrary {
  // Should be given a URL object as a root
  constructor(root) {
    super();
    this.root = root;
  }

  async get_url_for_path(path) {
    return new URL(path, this.root);
  }

  load_image(path, element) {
    element = element || mk('img');
    let asset = this.assets[path];
    if (asset) {
      // After trying to load this once, there's no point in doing all
      // the mechanical checking again; it'd be cached regardless
      element.src = asset.url;
      this.images.set(element, path);
      return element;
    }

    // Bind the event handlers FIRST -- if the image is cached, it might
    // load instantly!
    let promise = promise_event(element, 'load', 'error');

    // TODO indicating more fine-grained progress would be nice, but i
    // would need to know the sizes of all the assets upfront for it to be
    // meaningful.  consider including that in the new script format,
    // maybe?  urgh.  ALSO, note that it would need to use XHR and could
    // only be done same-origin anyway, because cross-origin XHR doesn't
    // populate the cache the same way as a regular <img>!

    let url = new URL(path, this.root);
    asset = this.assets[path] = {
      url: url,
      used: true,
      exists: null,
      progress: 0,
    };

    promise = promise.then(
      () => {
        asset.exists = true;
        asset.progress = 1;
        asset.promise = null;
      },
      ev => {
        console.error("error loading image", path, ev);
        asset.exists = false;
        asset.promise = null;
        throw ev;
      }
    );
    asset.promise = promise;

    // TODO fire an event here, or what?
    element.src = url;
    this.images.set(element, path);
    return element;
  }

  load_audio(path, element) {
    element = element || mk('audio', {preload: 'auto'});
    let asset = this.asset(path);
    if (asset.url) {
      element.src = asset.url;
      return element;
    }

    // Bind the event handlers FIRST -- if the audio is cached, it might
    // load instantly!
    // Note: 'canplaythrough' fires when the entire sound can be played
    // without buffering.  But Chrome doesn't like downloading the entire
    // file, and the spec never guarantees this is possible anyway, so go
    // with 'canplay' and hope for the best.
    let promise = promise_event(element, 'canplay', 'error');

    let url = new URL(path, this.root);
    asset.url = url;
    asset.used = true;
    asset.exists = null;
    asset.progress = 0;

    // FIXME if the audio fails to download, the VN should probably still be playable?

    promise = promise.then(
      () => {
        asset.exists = true;
        asset.progress = 1;
        asset.promise = null;
      },
      ev => {
        console.error("error loading", path, ev);
        asset.exists = false;
        asset.promise = null;
        throw ev;
      }
    );
    asset.promise = promise;

    // TODO fire an event here, or what?
    element.src = url;
    // Unlike images, the downloading doesn't start without this, because
    // the source selection is potentially more complicated
    element.load();

    return element;
  }
}