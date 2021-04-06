[![NPM](https://nodei.co/npm/zip-a-folder.png)](https://nodei.co/npm/zip-a-folder/)

[![Zip-A-Folder](https://circleci.com/gh/maugenst/zip-a-folder.svg?style=svg)](https://circleci.com/gh/maugenst/zip-a-folder)

# zip-a-folder
Easy to use zip (or tar) a complete folder plain into a zip file 
including compression ratio handling.

Version 1.0+ is incompatible to elder versions since it introduces a
breaking API change. 
* Callback function is NOT supported anymore. 
* Provide the possibility to create tar archives. 
* Set compression ratio (three levels supported by now uncompressed, medium and high)

## Basic Usage

Install via npm

```
npm install zip-a-folder
```

### Creating a ZIP file

```js
import { zip } from 'zip-a-folder';

class TestMe {

    static async main() {
        await zip('/path/to/the/folder', '/path/to/archive.zip');
    }
}

TestMe.main();
```

### Creating a gzipped TAR file

```js
import { tar } from 'zip-a-folder';

class TestMe {

    static async main() {
        await tar('/path/to/the/folder', '/path/to/archive.tgz');
    }
}

TestMe.main();
```

### Compression handling

For the sake of easy use, supported compression levels are (by now):
`COMPRESSION_LEVEL.high`, `COMPRESSION_LEVEL.medium` or `COMPRESSION_LEVEL.uncompressed`. 

```js
import { zip, COMPRESSION_LEVEL } from 'zip-a-folder';

class TestMe {

    static async main() {
        await zip('/path/to/the/folder', '/path/to/archive.zip', COMPRESSION_LEVEL.high);
    }
}

TestMe.main();
```

### Tests

Tests can be found in `/test` and run by jest. To run the tests call ``npm test``.

## Thanks

* Special thanks to @sole for her initial work.
* Thanks to YOONBYEONGIN
* Thanks to Wunschik
* Thanks to ratbeard
* Thanks to Xotabu4 
