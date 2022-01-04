[![NPM](https://nodei.co/npm/zip-a-folder.png)](https://nodei.co/npm/zip-a-folder/)

[![CircleCI](https://circleci.com/gh/maugenst/zip-a-folder.svg?style=shield)](https://circleci.com/gh/maugenst/zip-a-folder)
[![Coverage Status](https://coveralls.io/repos/github/maugenst/zip-a-folder/badge.svg?branch=master)](https://coveralls.io/github/maugenst/zip-a-folder?branch=master)

# zip-a-folder
Easy to use zip (or tar) a complete folder plain into a zip file 
including compression ratio handling and custom write streams.

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

The default compression - level is `high`.

```js
import { zip, COMPRESSION_LEVEL } from 'zip-a-folder';

class TestMe {

    static async main() {
        await zip('/path/to/the/folder', '/path/to/archive.zip', {compression: COMPRESSION_LEVEL.high});
    }
}

TestMe.main();
```
### Custom writeStreams
You can now pipe output to any WriteStream (just pass WriteStream as a parameter).

To keep the existing api stable the 2nd parameter (targetFilePath) can now be either undefined or 
an empty string.

ATTENTION: customWritestreams cannot be checked. So it is up to the user to check 
on non existing target folders or if the targetfolder equals to the sourcefolder 
(which leads to a circularity).

```js
import { zip, COMPRESSION_LEVEL } from 'zip-a-folder';
import { fs } from 'fs';

class TestMe {
    static async main() {
        const customWS = fs.createWriteStream('test/1234.zip');
        await zipafolder.zip(path.resolve(__dirname, 'data/'), undefined, {customWriteStream: customWS});    
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
