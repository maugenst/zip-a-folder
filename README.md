[![NPM](https://nodei.co/npm/zip-a-folder.png)](https://nodei.co/npm/zip-a-folder/)

[![Build](https://travis-ci.org/maugenst/zip-a-folder.svg?branch=master)](https://travis-ci.org/maugenst/zip-a-folder.svg?branch=master)
[![Coverage Status](https://coveralls.io/repos/github/maugenst/zip-a-folder/badge.svg?branch=master)](https://coveralls.io/github/maugenst/zip-a-folder?branch=master)
[![Dependencies](https://david-dm.org/maugenst/zip-a-folder.svg)](https://david-dm.org/maugenst/zip-a-folder)
[![Known Vulnerabilities](https://snyk.io/test/github/maugenst/zip-a-folder/badge.svg?targetFile=package.json)](https://snyk.io/test/github/maugenst/zip-a-folder?targetFile=package.json)


# zip-a-folder
Inspired by ``zip-folder`` to just zip a complete folder plain into a zip file I
recreated this project since zip-folder was very outdated and seemed not 
to be maintained anymore. Also added support for modern ES6 language 
features like promises/async/await.
In version 0.1.0 zip-a-folder got rewritten in Typescript.

## Basic Usage

Install via npm

```
npm install zip-a-folder
```

### Promised Usage

```js
import { zip } from 'zip-a-folder';

class ZipAFolder {

    static async main() {
        await zip('/path/to/the/folder', '/path/to/archive.zip');
    }
}

ZipAFolder.main();
```

### Callback Usage

```js
import { zipFolder } from 'zip-a-folder';

class ZipAFolder {

    static main() {
        zipFolder('/path/to/the/folder', '/path/to/archive.zip', (err) => {
            if(err) {
                console.log('Something went wrong!', err);
            }
        });
    }
}

ZipAFolder.main();
```

### Tests

Tests are written under ``test`` and run by jest. To run the tests call ``npm test``.

## Thanks

* Special thanks to @sole for her initial work.
* Thanks to YOONBYEONGIN
* Thanks to Wunschik
* Thanks to ratbeard
