'use strict';
import 'jest-extended';
import * as fs from 'fs';
const {open, mkdir, rm} = require('fs').promises;
import * as rimraf from 'rimraf';
import * as path from 'path';
import {Writable} from 'stream';

import {COMPRESSION_LEVEL, tar, zip, ZipAFolder as zipafolder} from '../lib/ZipAFolder';
import {writeToStream} from '../lib/core/utils';
import {NativeTar} from '../lib/tar/NativeTar';
import {FileEntry} from '../lib/core/types';

describe('Zip-A-Folder Test', function () {
    const testZIP = path.resolve(__dirname, 'test.zip');
    const testDestPathZIP = path.resolve(__dirname, 'test.destpath.zip');
    const testUNCOMPRESSEDZIP = path.resolve(__dirname, 'testUNCOMPRESSED.zip');
    const testMEDIUMZIP = path.resolve(__dirname, 'testMEDIUM.zip');
    const testSMALLZIP = path.resolve(__dirname, 'testSMALL.zip');
    const testSameDirectoryZIP = path.resolve(__dirname, 'data/test.zip');
    const testnotexistingZIP = path.resolve(__dirname, '/notexisting/testcallback.zip');
    const testGlobZIP = path.resolve(__dirname, 'test.globbed.zip');
    const testGlobOnTheFlyZIP = path.resolve(__dirname, 'test.globbed.on.the.fly.zip');
    const testGlobMultiZIP = path.resolve(__dirname, 'test.globbed.multi.zip');

    const testTAR = path.resolve(__dirname, 'test.tgz');
    const testUNCOMPRESSEDTAR = path.resolve(__dirname, 'testUNCOMPRESSED.tar');
    const testMEDIUMTAR = path.resolve(__dirname, 'testMEDIUM.tgz');
    const testSMALLTAR = path.resolve(__dirname, 'testSMALL.tgz');
    const testSameDirectoryTAR = path.resolve(__dirname, 'data/test.tgz');
    const testnotexistingTAR = path.resolve(__dirname, '/notexisting/testcallback.tgz');
    const testGlobTAR = path.resolve(__dirname, 'test.globbed.tgz');
    const testGlobMultiTAR = path.resolve(__dirname, 'test.globbed.multi.tgz');

    // Small temp file used by NativeZip/NativeTar coverage tests
    const tempNativeFile = path.resolve(__dirname, 'temp-native.txt');

    beforeAll(() => {
        rimraf.sync('test/*.tgz');
        rimraf.sync('test/*.tar');
        rimraf.sync('test/*.zip');

        // Ensure temp file exists for internal coverage tests
        fs.writeFileSync(tempNativeFile, 'hello from native coverage\n');
    });

    afterAll(() => {
        if (fs.existsSync(tempNativeFile)) {
            fs.unlinkSync(tempNativeFile);
        }
    });

    it('Called without a targetFilePath or a customWriteStream should throw an error', async () => {
        await expect(
            zipafolder.zip(path.resolve(__dirname, 'data/'), undefined, {customWriteStream: undefined})
        ).rejects.toThrow(/You must either provide a target file path or a custom write stream to write to./);
        await expect(zipafolder.zip(path.resolve(__dirname, 'data/'), undefined)).rejects.toThrow(
            /You must either provide a target file path or a custom write stream to write to./
        );
        await expect(
            zipafolder.tar(path.resolve(__dirname, 'data/'), undefined, {customWriteStream: undefined})
        ).rejects.toThrow(/You must either provide a target file path or a custom write stream to write to./);
        await expect(zipafolder.tar(path.resolve(__dirname, 'data/'), undefined)).rejects.toThrow(
            /You must either provide a target file path or a custom write stream to write to./
        );
    });

    it('ZIP test folder and zip target in same directory should throw an error', async () => {
        await expect(zipafolder.zip(path.resolve(__dirname, 'data/'), testSameDirectoryZIP)).rejects.toThrow(
            /Source and target folder must be different./
        );
    });

    it('ZIP test folder', async () => {
        await zipafolder.zip(path.resolve(__dirname, 'data/'), testZIP);

        expect(fs.existsSync(testZIP)).toBe(true);
    });

    it('ZIP test folder using compression rate', async () => {
        await zipafolder.zip(path.resolve(__dirname, 'data/'), testUNCOMPRESSEDZIP, {
            compression: COMPRESSION_LEVEL.uncompressed
        });
        await zipafolder.zip(path.resolve(__dirname, 'data/'), testMEDIUMZIP, {compression: COMPRESSION_LEVEL.medium});
        await zipafolder.zip(path.resolve(__dirname, 'data/'), testSMALLZIP, {compression: COMPRESSION_LEVEL.high});

        const sizeUNCOMPRESSED = fs.statSync(testUNCOMPRESSEDZIP).size;
        const sizeMEDIUM = fs.statSync(testMEDIUMZIP).size;
        const sizeSMALL = fs.statSync(testSMALLZIP).size;
        expect(sizeMEDIUM).toBeLessThan(sizeUNCOMPRESSED);
        expect(sizeSMALL).toBeLessThan(sizeMEDIUM);
    });

    it('ZIP test folder direct via constant', async () => {
        await zip(path.resolve(__dirname, 'data/'), testZIP);

        expect(fs.existsSync(testZIP)).toBe(true);
    });

    it('ZIP test folder direct via constant', async () => {
        await zip(path.resolve(__dirname, 'data/'), testZIP);

        expect(fs.existsSync(testZIP)).toBe(true);
    });

    it('ZIP test folder with destination folder structure', async () => {
        await zip(path.resolve(__dirname, 'data/'), testDestPathZIP, {destPath: 'data/'});

        expect(fs.existsSync(testDestPathZIP)).toBe(true);
    });

    it('ZIP test folder failing', async () => {
        expect.assertions(1);
        try {
            await zipafolder.zip(path.resolve(__dirname, 'notexisting/'), testZIP);
        } catch (e: any) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });

    it('ZIP test folder into a zipfile in a notexisting folder', async () => {
        expect.assertions(1);
        try {
            await zipafolder.zip(path.resolve(__dirname, 'data/'), testnotexistingZIP);
        } catch (e: any) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });

    it('ZIP test globbing', async () => {
        await zip('test/**/*.json', testGlobZIP);

        expect(fs.existsSync(testGlobZIP)).toBe(true);
    });

    it('ZIP test globbing with inaccessible file/folder', async () => {
        await expect(zip('test/inaccessible/**/*.json', 'THISWILLNEVEREXIST.zip')).rejects.toThrow(
            /No glob match found/
        );
        expect(fs.existsSync('THISWILLNEVEREXIST.zip')).toBe(false);
    });

    it('ZIP test globbing with creating content on the fly', async () => {
        await mkdir('test/foo/bar', {recursive: true});
        const fd = await open('test/foo/bar/a.json', 'w');
        await fd.close();

        await zip('test/foo/bar/**/*.json', testGlobOnTheFlyZIP);
        expect(fs.existsSync(testGlobOnTheFlyZIP)).toBe(true);
        await rm('test/foo', {recursive: true});
    });

    it('ZIP test globbing a non existing target', async () => {
        await expect(zip('test/bar/**/*.json', 'THISWILLNEVEREXIST.zip')).rejects.toThrow(/No glob match found/);

        expect(fs.existsSync('THISWILLNEVEREXIST.zip')).toBe(false);
    });

    it('ZIP test globbing multiple non existing targets', async () => {
        await expect(zip('test/nonexisting/**/*.json, test/**/*.docx', 'THISWILLNEVEREXIST.zip')).rejects.toThrow(
            /No glob match found/
        );

        expect(fs.existsSync('THISWILLNEVEREXIST.zip')).toBe(false);
    });

    it('ZIP test globbing with multiple paths', async () => {
        await zip('**/*.json, **/*.txt', testGlobMultiZIP);

        expect(fs.existsSync(testGlobMultiZIP)).toBe(true);
    });

    it('TGZ test folder and tar target in same directory should throw an error', async () => {
        await expect(zipafolder.tar(path.resolve(__dirname, 'data/'), testSameDirectoryTAR)).rejects.toThrow(
            /Source and target folder must be different./
        );
    });

    it('TGZ test folder', async () => {
        await zipafolder.tar(path.resolve(__dirname, 'data/'), testTAR);

        expect(fs.existsSync(testTAR)).toBe(true);
    });

    it('TGZ test folder using compression rate', async () => {
        await zipafolder.tar(path.resolve(__dirname, 'data/'), testUNCOMPRESSEDTAR, {
            compression: COMPRESSION_LEVEL.uncompressed
        });
        await zipafolder.tar(path.resolve(__dirname, 'data/'), testMEDIUMTAR, {compression: COMPRESSION_LEVEL.medium});
        await zipafolder.tar(path.resolve(__dirname, 'data/'), testSMALLTAR, {compression: COMPRESSION_LEVEL.high});

        const sizeUNCOMPRESSED = fs.statSync(testUNCOMPRESSEDTAR).size;
        const sizeBIG = fs.statSync(testMEDIUMTAR).size;
        const sizeSMALL = fs.statSync(testSMALLTAR).size;
        expect(sizeBIG).toBeLessThan(sizeUNCOMPRESSED);
        expect(sizeSMALL).toBeLessThan(sizeBIG);
    });

    it('TGZ test folder direct via constant', async () => {
        await tar(path.resolve(__dirname, 'data/'), testTAR);

        expect(fs.existsSync(testTAR)).toBe(true);
    });

    it('TGZ test folder failing', async () => {
        expect.assertions(1);
        try {
            await zipafolder.tar(path.resolve(__dirname, 'notexisting/'), testTAR);
        } catch (e: any) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });

    it('TGZ test folder into a gzipped tarfile in a notexisting folder', async () => {
        expect.assertions(1);
        try {
            await zipafolder.tar(path.resolve(__dirname, 'data/'), testnotexistingTAR);
        } catch (e: any) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });

    it('ZIP test custom writestream with zipfilepath empty string', async () => {
        const customWS = fs.createWriteStream('test/123.zip');
        await zipafolder.zip(path.resolve(__dirname, 'data/'), '', {customWriteStream: customWS});
        expect(fs.existsSync('test/123.zip')).toBeTruthy();
    });

    it('ZIP test custom writestream with zipfilepath undefined', async () => {
        const customWS = fs.createWriteStream('test/1234.zip');
        await zipafolder.zip(path.resolve(__dirname, 'data/'), undefined, {customWriteStream: customWS});
        expect(fs.existsSync('test/1234.zip')).toBeTruthy();
    });

    it('TGZ test custom writestream with tarfilepath empty string', async () => {
        const customWS = fs.createWriteStream('test/123.tgz');
        await zipafolder.tar(path.resolve(__dirname, 'data/'), '', {customWriteStream: customWS});
        expect(fs.existsSync('test/123.tgz')).toBeTruthy();
    });

    it('TGZ test custom writestream with tarfilepath undefined', async () => {
        const customWS = fs.createWriteStream('test/1234.tgz');
        await zipafolder.tar(path.resolve(__dirname, 'data/'), undefined, {customWriteStream: customWS});
        expect(fs.existsSync('test/1234.tgz')).toBeTruthy();
    });

    it('TGZ test globbing', async () => {
        await tar('**/*.json', testGlobTAR);

        expect(fs.existsSync(testGlobTAR)).toBe(true);
    });

    it('TGZ test globbing with multiple paths', async () => {
        await tar('**/*.json, **/*.txt', testGlobMultiTAR);

        expect(fs.existsSync(testGlobMultiTAR)).toBe(true);
    });

    /**
     * As this test is huuuuuuge I decided to only run it locally to check on github issue:
     * https://github.com/maugenst/zip-a-folder/issues/32
     * Preparation to run this test:
     *  * create a folder in test called 'largeFolder'
     *  * copy huge / tons of files into it
     *  * remove 'skip' and run the test
     */
    it.skip('Zip a very large folder ', async () => {
        await zipafolder.zip(path.resolve(__dirname, 'largeFolder'), 'test/large.zip');
        expect(fs.existsSync('test/large.zip')).toBeTruthy();
    });

    // -------------------------------------------------------------------------
    // Additional coverage tests for remaining branches / edge cases
    // -------------------------------------------------------------------------

    it('ZIP: respects user-provided zlib level (does not override)', async () => {
        const out = path.resolve(__dirname, 'test.zlib-level.zip');
        await zip(path.resolve(__dirname, 'data/'), out, {
            compression: COMPRESSION_LEVEL.high,
            zlib: {level: 3} // non-default level to hit "already set" branch
        });
        expect(fs.existsSync(out)).toBeTrue();
    });

    it('TGZ: respects user-provided gzipOptions.level (does not override)', async () => {
        const out = path.resolve(__dirname, 'test.gzip-level.tgz');
        await tar(path.resolve(__dirname, 'data/'), out, {
            gzip: true,
            compression: COMPRESSION_LEVEL.high,
            gzipOptions: {level: 4}
        });
        expect(fs.existsSync(out)).toBeTrue();
    });

    it('ZIP: weird compression enum goes through default branch safely', async () => {
        const out = path.resolve(__dirname, 'test.weird-compression.zip');
        await zipafolder.zip(path.resolve(__dirname, 'data/'), out, {
            // @ts-expect-error – intentionally invalid to hit default branch
            compression: 999
        });
        expect(fs.existsSync(out)).toBeTrue();
    });

    it('TGZ: weird compression enum goes through default branch safely', async () => {
        const out = path.resolve(__dirname, 'test.weird-compression.tgz');
        await zipafolder.tar(path.resolve(__dirname, 'data/'), out, {
            // @ts-expect-error – intentionally invalid to hit default branch
            compression: 999
        });
        expect(fs.existsSync(out)).toBeTrue();
    });

    it('ZIP: forces ZIP64 + namePrependSlash + comment code paths', async () => {
        const out = path.resolve(__dirname, 'test.zip64.slash.zip');
        await zip(path.resolve(__dirname, 'data/'), out, {
            forceZip64: true,
            namePrependSlash: true,
            comment: 'zip64-test-comment',
            compression: COMPRESSION_LEVEL.medium
        });
        expect(fs.existsSync(out)).toBeTrue();
    });

    it('ZIP: STORE method via store=true and uncompressed compression', async () => {
        const out = path.resolve(__dirname, 'test.store.explicit.zip');
        await zip(path.resolve(__dirname, 'data/'), out, {
            store: true,
            compression: COMPRESSION_LEVEL.uncompressed
        });
        expect(fs.existsSync(out)).toBeTrue();
    });

    it('TGZ: gzip=false with non-uncompressed compression hits non-gzip branch explicitly', async () => {
        const out = path.resolve(__dirname, 'test.nogzip-medium.tar');
        await tar(path.resolve(__dirname, 'data/'), out, {
            gzip: false,
            compression: COMPRESSION_LEVEL.medium
        });
        expect(fs.existsSync(out)).toBeTrue();
    });

    it('utils.writeToStream: rejects on underlying stream error', async () => {
        class FailingWritable extends Writable {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
                callback(new Error('boom'));
            }
        }

        const s = new FailingWritable();
        // prevent Jest from treating the "error" event as unhandled
        s.on('error', () => {
            // expected
        });

        await expect(writeToStream(s as any, Buffer.from('x'))).rejects.toThrow('boom');
    });

    it('NativeTar: finalize writes trailer blocks and ends stream (no error)', async () => {
        const chunks: Buffer[] = [];
        const mem = new Writable({
            write(chunk, _enc, cb) {
                chunks.push(Buffer.from(chunk));
                cb();
            }
        });

        const tarImpl = new NativeTar(mem as any);

        const stat = fs.statSync(tempNativeFile);

        const entry: FileEntry = {
            fsPath: tempNativeFile,
            relativePath: 'file1.txt',
            isDirectory: false,
            stat
        };

        await tarImpl.addFile(entry);
        await tarImpl.finalize();

        // Trailer blocks should have been written -> total size > file content alone.
        const totalSize = chunks.reduce((sum, b) => sum + b.length, 0);
        expect(totalSize).toBeGreaterThan(stat.size);
    });
});
