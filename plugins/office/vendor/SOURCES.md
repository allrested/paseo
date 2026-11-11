# Vendored files

The `office` built-in serves `three.module.min.js` to web clients over `office.asset.request`;
the client evaluates it only when the 3D view is shown. Nothing here runs in the daemon.

## three.js

- Package: `three@0.170.0` from https://registry.npmjs.org (tarball integrity
  `sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==`)
- Licence: MIT, Copyright © 2010-2024 three.js authors (`LICENSE-three`, the package's `LICENSE`,
  sha256 `4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454`)
- Kept: `build/three.module.min.js`, unmodified, 691,648 bytes, sha256
  `08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7` (checked again by
  `server/asset.ts` on every read).
- Why r170: from r171 on, `build/three.module.js` imports `./three.core.js`, and a module evaluated
  from a Blob URL cannot import a sibling file. r170's module build is self-contained.

To update the pin, download the new package into an empty temporary directory, confirm its module
build has no `import` or `from"` statements, copy the two files over these, and update the
version, sizes and checksums here and in `server/asset.ts`.
