*NO LONGER MAINTAINED*
- *WILL PROBABLY BE REWRITTEN SOON*
- *FULL OF VULNERABILITIES. AVOID USAGE*

# NodeCG OBS Utility

[![CodeQL](https://github.com/GGLinnk/nodecg-obs-utility/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/GGLinnk/nodecg-obs-utility/actions/workflows/codeql-analysis.yml) [![NPM Version](https://img.shields.io/npm/v/@nodecg-obs/utility.svg)](https://www.npmjs.com/package/@nodecg-obs/utility)

[`nodecg-obs-utility`] is a fork of [`nodecg-utility-obs`], a [NodeCG] utility that adds a set of Replicants, Messages, and other hooks to your NodeCG bundle. It is meant for use with latest version of NodeCG. You can think of it like a mixin for your NodeCG bundle.

It requires that the instance of OBS have [`obs-websocket`] installed and configured.

Internally, it uses the latest release of [`obs-websocket-js`] to communicate with [`obs-websocket`].


## Requirements

* Latest release of [NodeCG].
* LTS (v16.x) or Current (v17.x) version of [NodeJS].
* [OBS Studio] with latest [`obs-websocket`] installed.

### Tested with
- NodeCG ``1.8.1``
- Node ``16.14.2`` & npm ``8.5.5``
- OBS ``27.2.3`` & websocket ``4.9.1``


## Install

1. Go to your bundle folder
```
cd my-nodecg/bundles/your-bundle
```

2. Add to your bundle
```
npm install @nodecg-obs/utility
```


## License
This project is under MIT License. See [LICENSE]


## Documentation
For full documentation, see the [wiki]


[LICENSE]: LICENSE
[`nodecg-obs-utility`]: https://github.com/GGLinnk/nodecg-obs-utility/
[`nodecg-utility-obs`]: https://github.com/nodecg/nodecg-obs/tree/master/packages/nodecg-utility-obs
[`obs-websocket-js`]: https://github.com/obs-websocket-community-projects/obs-websocket-js
[`obs-websocket`]: https://github.com/obsproject/obs-websocket
[NodeCG]: https://github.com/nodecg/nodecg
[NodeJS]: https://nodejs.org/
[OBS Studio]: https://obsproject.com/
[wiki]: https://github.com/GGLinnk/nodecg-obs-utility/wiki
