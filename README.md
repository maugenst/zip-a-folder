[![NPM](https://nodei.co/npm/asyncZipFolder.png)](https://nodei.co/npm/asyncZipFolder/)

[![Build](https://travis-ci.org/maugenst/asyncZipFolder.svg?branch=master)](https://travis-ci.org/maugenst/asyncZipFolder.svg?branch=master)
[![Coverage Status](https://coveralls.io/repos/github/maugenst/asyncZipFolder/badge.svg?branch=master)](https://coveralls.io/github/maugenst/asyncZipFolder?branch=master)
[![Dependencies](https://david-dm.org/maugenst/asyncZipFolder.svg)](https://david-dm.org/maugenst/asyncZipFolder)
[![Known Vulnerabilities](https://snyk.io/test/github/maugenst/asyncZipFolder/badge.svg?targetFile=package.json)](https://snyk.io/test/github/maugenst/asyncZipFolder?targetFile=package.json)


# asyncZipFolder
Inspired by ``zip-folder`` to just zip a folder plain into a zip file I
recreated this project since zip-folder was very outdated and seemed not to be maintained anymore. Also 
I added support for modern ES6 language features like promises/async/await.

## Basic Usage

Install via npm

```
npm install asyncZipFolder
```

### Promised Usage

```
const asyncZipFolder = require('asyncZipFolder');

class ZipAFolder {

    static async main() {
        await asyncZipFolder.zip('/path/to/the/folder', '/path/to/archive.zip');
    }
}

ZipAFolder.main();

```

### Callback Usage

```
const zipFolder = require('asyncZipFolder');

class ZipAFolder {

    static main() {
        zipFolder.zipFolder('/path/to/the/folder', '/path/to/archive.zip', function(err) {
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
