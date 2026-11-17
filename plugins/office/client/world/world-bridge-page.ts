import { WORLD_API_VERSION } from "./world-api.js";

/**
 * The page's side of the bridge. It runs inside the frame, after ScriptFrame's bootstrap has set
 * `window.paseoFrame`, and before the scene's own script: it listens for the plugin's calls and
 * forwards each to `PaseoOfficeWorld`, which the scene sets when it loads. Callbacks given to
 * `start` become stand-ins that post `{ callback, args }`. A scene that throws, or one that is not
 * the contract's version, posts `{ problem }`, which the office shows as any other failure.
 *
 * It also turns Full screen off: whether a WebView reports `fullscreenEnabled` is the WebView's
 * business, and the bar's button reads it at `start`.
 */
export function bridgePageScript(scene: string): string {
  return `(function () {
  var frame = window.paseoFrame;
  var tell = function (message) { frame.post(JSON.stringify(message)); };
  var problem = function (error) { tell({ problem: String((error && error.message) || error) }); };
  try { Object.defineProperty(document, "fullscreenEnabled", { value: false }); } catch (e) {}
  function standIns(options) {
    var names = options.callbacks || [];
    delete options.callbacks;
    names.forEach(function (name) {
      options[name] = function () {
        tell({ callback: name, args: Array.prototype.slice.call(arguments) });
      };
    });
    return options;
  }
  frame.onMessage = function (text) {
    var message;
    try { message = JSON.parse(text); } catch (e) { return; }
    var world = window.PaseoOfficeWorld;
    if (!message || !world || typeof world[message.call] !== "function") return;
    var args = message.args || [];
    if (message.call === "start" && args[0]) args[0] = standIns(args[0]);
    try { world[message.call].apply(world, args); } catch (error) { problem(error); }
  };
  try {
${scene}
  } catch (error) { problem(error); return; }
  var world = window.PaseoOfficeWorld;
  if (!world || world.version !== ${WORLD_API_VERSION}) problem("Unexpected office build");
})();`;
}
