# Deploy v1.2.3

Upload the contents of this directory to the root (or chosen subdirectory) of a static website.

## GitHub Pages

Commit the files to the published branch/folder and enable Pages. `.nojekyll` is included. All application paths are relative, so project-site paths such as `/repository-name/` are supported.

## Cloudflare Pages / Netlify

Use this directory as the publish/output directory. No build command is required.

## Generic server

Serve this folder as static files over HTTP(S). `index.html` is the entry point. MIME types for `.js`, `.json`, `.png`, `.webmanifest`, and `.css` should be conventional browser types.

## Cache note

The service worker cache is `small-machine-web-v1.2.3-r27`. `sw.js`, `index.html`, `engine/*`, and `game_data/*` should not be long-cache immutable at the HTTP layer; `_headers` contains suitable hints for hosts that support it.

## SM-505 renderer candidate identity

Distribution revision **r27** binds the changed normal-game renderer assets to presentation revision **sm505-1** (`engine/game.js`, `webapp.js`, `engine/webgl2_scene_adapter.js`, `engine/webgpu_scene_presenter.js`, and `engine/backend_runtime.js`). Normal `Auto` remains WebGL2 until the exact-candidate physical acceptance gate is complete; explicit WebGPU selection exercises this candidate only.
