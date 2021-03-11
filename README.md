[![NPM](https://nodei.co/npm/zip-a-folder.png)](https://nodei.co/npm/zip-a-folder/)

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
