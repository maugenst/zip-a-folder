'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
require("jest-extended");
const fs = require("fs");
const rimraf = require("rimraf");
const path = require("path");
const ZipAFolder_1 = require("../lib/ZipAFolder");
describe('Zip-A-Folder Test', function () {
    const testZIP = path.resolve(__dirname, 'test.zip');
    const testUNCOMPRESSEDZIP = path.resolve(__dirname, 'testUNCOMPRESSED.zip');
    const testMEDIUMZIP = path.resolve(__dirname, 'testMEDIUM.zip');
    const testSMALLZIP = path.resolve(__dirname, 'testSMALL.zip');
    const testSameDirectoryZIP = path.resolve(__dirname, 'data/test.zip');
    const testnotexistingZIP = path.resolve(__dirname, '/notexisting/testcallback.zip');
    const testTAR = path.resolve(__dirname, 'test.tgz');
    const testUNCOMPRESSEDTAR = path.resolve(__dirname, 'testUNCOMPRESSED.tar');
    const testMEDIUMTAR = path.resolve(__dirname, 'testMEDIUM.tgz');
    const testSMALLTAR = path.resolve(__dirname, 'testSMALL.tgz');
    const testSameDirectoryTAR = path.resolve(__dirname, 'data/test.tgz');
    const testnotexistingTAR = path.resolve(__dirname, '/notexisting/testcallback.tgz');
    beforeAll(() => {
        rimraf.sync('test/*.tgz');
        rimraf.sync('test/*.tar');
        rimraf.sync('test/*.zip');
    });
    it('Called without a targetFilePath or a customWriteStream should throw an error', async () => {
        await expect(ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), undefined, { customWriteStream: undefined })).rejects.toThrow(/You must either provide a target file path or a custom write stream to write to./);
        await expect(ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), undefined)).rejects.toThrow(/You must either provide a target file path or a custom write stream to write to./);
        await expect(ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), undefined, { customWriteStream: undefined })).rejects.toThrow(/You must either provide a target file path or a custom write stream to write to./);
        await expect(ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), undefined)).rejects.toThrow(/You must either provide a target file path or a custom write stream to write to./);
    });
    it('ZIP test folder and zip target in same directory should throw an error', async () => {
        await expect(ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testSameDirectoryZIP)).rejects.toThrow(/Source and target folder must be different./);
    });
    it('ZIP test folder', async () => {
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testZIP);
        expect(fs.existsSync(testZIP)).toBe(true);
    });
    it('ZIP test folder using compression rate', async () => {
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testUNCOMPRESSEDZIP, {
            compression: ZipAFolder_1.COMPRESSION_LEVEL.uncompressed,
        });
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testMEDIUMZIP, { compression: ZipAFolder_1.COMPRESSION_LEVEL.medium });
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testSMALLZIP, { compression: ZipAFolder_1.COMPRESSION_LEVEL.high });
        const sizeUNCOMPRESSED = fs.statSync(testUNCOMPRESSEDZIP).size;
        const sizeMEDIUM = fs.statSync(testMEDIUMZIP).size;
        const sizeSMALL = fs.statSync(testSMALLZIP).size;
        expect(sizeMEDIUM).toBeLessThan(sizeUNCOMPRESSED);
        expect(sizeSMALL).toBeLessThan(sizeMEDIUM);
    });
    it('ZIP test folder direct via constant', async () => {
        await (0, ZipAFolder_1.zip)(path.resolve(__dirname, 'data/'), testZIP);
        expect(fs.existsSync(testZIP)).toBe(true);
    });
    it('ZIP test folder failing', async () => {
        expect.assertions(1);
        try {
            await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'notexisting/'), testZIP);
        }
        catch (e) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });
    it('ZIP test folder into a zipfile in a notexisting folder', async () => {
        expect.assertions(1);
        try {
            await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testnotexistingZIP);
        }
        catch (e) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });
    it('TGZ test folder and tar target in same directory should throw an error', async () => {
        await expect(ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), testSameDirectoryTAR)).rejects.toThrow(/Source and target folder must be different./);
    });
    it('TGZ test folder', async () => {
        await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), testTAR);
        expect(fs.existsSync(testTAR)).toBe(true);
    });
    it('TGZ test folder using compression rate', async () => {
        await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), testUNCOMPRESSEDTAR, {
            compression: ZipAFolder_1.COMPRESSION_LEVEL.uncompressed,
        });
        await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), testMEDIUMTAR, { compression: ZipAFolder_1.COMPRESSION_LEVEL.medium });
        await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), testSMALLTAR, { compression: ZipAFolder_1.COMPRESSION_LEVEL.high });
        const sizeUNCOMPRESSED = fs.statSync(testUNCOMPRESSEDTAR).size;
        const sizeBIG = fs.statSync(testMEDIUMTAR).size;
        const sizeSMALL = fs.statSync(testSMALLTAR).size;
        expect(sizeBIG).toBeLessThan(sizeUNCOMPRESSED);
        expect(sizeSMALL).toBeLessThan(sizeBIG);
    });
    it('TGZ test folder direct via constant', async () => {
        await (0, ZipAFolder_1.tar)(path.resolve(__dirname, 'data/'), testTAR);
        expect(fs.existsSync(testTAR)).toBe(true);
    });
    it('TGZ test folder failing', async () => {
        expect.assertions(1);
        try {
            await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'notexisting/'), testTAR);
        }
        catch (e) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });
    it('TGZ test folder into a gzipped tarfile in a notexisting folder', async () => {
        expect.assertions(1);
        try {
            await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), testnotexistingTAR);
        }
        catch (e) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });
    it('ZIP test custom writestream with zipfilepath empty string', async () => {
        const customWS = fs.createWriteStream('test/123.zip');
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), '', { customWriteStream: customWS });
        expect(fs.existsSync('test/123.zip')).toBeTruthy();
    });
    it('ZIP test custom writestream with zipfilepath undefined', async () => {
        const customWS = fs.createWriteStream('test/1234.zip');
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), undefined, { customWriteStream: customWS });
        expect(fs.existsSync('test/1234.zip')).toBeTruthy();
    });
    it('TGZ test custom writestream with tarfilepath empty string', async () => {
        const customWS = fs.createWriteStream('test/123.tgz');
        await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), '', { customWriteStream: customWS });
        expect(fs.existsSync('test/123.tgz')).toBeTruthy();
    });
    it('TGZ test custom writestream with tarfilepath undefined', async () => {
        const customWS = fs.createWriteStream('test/1234.tgz');
        await ZipAFolder_1.ZipAFolder.tar(path.resolve(__dirname, 'data/'), undefined, { customWriteStream: customWS });
        expect(fs.existsSync('test/1234.tgz')).toBeTruthy();
    });
    it.skip('Zip a very large folder ', async () => {
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'largeFolder'), 'test/large.zip');
        expect(fs.existsSync('test/large.zip')).toBeTruthy();
    });
});
//# sourceMappingURL=tests-ZipAFolder.js.map