[![NPM](https://nodei.co/npm/zip-a-folder.png)](https://nodei.co/npm/zip-a-folder/)

[![CircleCI](https://circleci.com/gh/maugenst/zip-a-folder.svg?style=shield&downloads=true&downloadRank=true&stars=true)](https://circleci.com/gh/maugenst/zip-a-folder)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/df3f742eabe741029c221fd602407d0f)](https://app.codacy.com/gh/maugenst/zip-a-folder/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)
[![Codacy Badge](https://app.codacy.com/project/badge/Coverage/df3f742eabe741029c221fd602407d0f)](https://app.codacy.com/gh/maugenst/zip-a-folder/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_coverage)
[![Known Vulnerabilities](https://snyk.io/test/github/maugenst/zip-a-folder/badge.svg)](https://snyk.io/test/github/maugenst/zip-a-folder)

# zip-a-folder
Easy to use zip (or tar) a complete folder or a list of globs plain into a zip/tar/tgz file 
including compression ratio handling and custom write streams.

## incompatible changes
* Version 2 adds glob lists handling as a src. So please be aware that using globs intentionally breaks up the "create-a-zip/tar-file-from-a-folder" approach.
* Version 3 adds the possibility to zip-a-folder to be usable either in commonjs or esm module environments.
* Version 3.1 adds the possibility to specify target folder within a zip file. By default the structure within a zip file doesn't contain the src folder, but the files and folder underneath.  

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

ATTENTION: `customWriteStream` is not checked. So it is up to the user to check 
on non-existing target folders or if the targetfolder equals to the sourcefolder 
(ending up in circularity).

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

### Glob handling

The first parameter can be either a path or a glob. Globs are separated by comma.

```js
import {zip} from 'zip-a-folder';

class TestMe {

    static async main() {
        // zip all json into an archive
        await zip('**/*.json', '/path/to/archive.zip');
        // zip all json AND txt files into a second archive
        await zip('**/*.json, **/*.txt', '/path/to/archive2.zip');
    }
}

TestMe.main();
```

### Destination path handling (>=3.1.x)

With passing a destination path to zip-a-folder options object you can define the target folder structure
within the generated zip.

```js
import {zip} from 'zip-a-folder';

class TestMe {

    static async main() {
        // zip all json into an archive
        await zip('data/', '/path/to/archive.zip', {destPath: 'data/'});
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
* Thanks to dallenbaldwin
* Thanks to wiralegawa
* Thanks to karan-gaur
* Thanks to malthe 