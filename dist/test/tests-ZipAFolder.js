'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
require("jest-extended");
const fs = require("fs");
const path = require("path");
const ZipAFolder_1 = require("../lib/ZipAFolder");
describe('Zip-A-Folder Test', function () {
    const testasync = path.resolve(__dirname, 'testasync.zip');
    const testasyncSameDirectory = path.resolve(__dirname, 'data/testasync.zip');
    const testcallback = path.resolve(__dirname, 'testcallback.zip');
    const testnotexisting = path.resolve(__dirname, '/notexisting/testcallback.zip');
    beforeAll(() => {
        if (fs.existsSync(testasync)) {
            fs.unlinkSync(testasync);
        }
        if (fs.existsSync(testasyncSameDirectory)) {
            fs.unlinkSync(testasyncSameDirectory);
        }
        if (fs.existsSync(testcallback)) {
            fs.unlinkSync(testcallback);
        }
    });
    it('ASYNC: Zip test folder and zip target in same directory should throw an error', async () => {
        expect.assertions(1);
        await expect(ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testasyncSameDirectory)).rejects.toThrow(/Source and target folder must be different./);
    });
    it('ASYNC: Zip test folder', async () => {
        expect.assertions(1);
        await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testasync);
        expect(fs.existsSync(testasync)).toBe(true);
    });
    it('ASYNC: Zip test folder failing', async () => {
        expect.assertions(1);
        try {
            await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'notexisting/'), testasync);
        }
        catch (e) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });
    it('ASYNC: Zip test folder into a zipfile in a notexisting folder', async () => {
        expect.assertions(1);
        try {
            await ZipAFolder_1.ZipAFolder.zip(path.resolve(__dirname, 'data/'), testnotexisting);
        }
        catch (e) {
            expect(e.message).toMatch(/no such file or directory/);
        }
    });
    it('CALLBACK: Zip test folder', () => {
        ZipAFolder_1.ZipAFolder.zipFolder(path.resolve(__dirname, 'data/'), testcallback, () => {
            expect(fs.existsSync(testcallback)).toBe(true);
        });
    });
});
//# sourceMappingURL=tests-ZipAFolder.js.map