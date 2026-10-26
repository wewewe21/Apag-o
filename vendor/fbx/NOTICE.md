# Three.js FBX runtime

These files were copied, without modification, from the project's installed
`three@0.170.0` package under `examples/jsm/`:

- `loaders/FBXLoader.js`
- `curves/NURBSCurve.js`, `curves/NURBSUtils.js`
- `utils/SkeletonUtils.js`
- `libs/fflate.module.js` (bundled fflate 0.8.2)

Three.js is MIT licensed; its full license is in `THREE-LICENSE.txt`.
The fflate source preserves its original MIT license notice and attribution to
https://github.com/101arrowz/fflate.

Imports use the game's existing bare `three` import map, or its installed
package in Node. No runtime download or additional third-party package is needed.
The user's original `assets/Character/Guardiao.fbx` remains unchanged.
