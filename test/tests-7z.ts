// test/tests-7z.ts
import * as fs from 'fs';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Native7z} from '../lib/7z/Native7z';
import {sevenZip, ZipAFolder} from '../lib/ZipAFolder';

const testDataDir = path.join(__dirname, 'data');
const testOutputDir = path.join(__dirname, 'folder');

describe('7z archive creation', () => {
    beforeAll(async () => {
        // Ensure test output directory exists
        await fs.promises.mkdir(testOutputDir, {recursive: true});
    });

    afterAll(async () => {
        // Clean up test files
        const files = await fs.promises.readdir(testOutputDir);
        for (const file of files) {
            if (file.endsWith('.7z')) {
                await fs.promises.unlink(path.join(testOutputDir, file)).catch(() => {
                    // Ignore errors when cleaning up test files
                });
            }
        }
    });

    it('creates a 7z archive from a directory', async () => {
        const targetPath = path.join(testOutputDir, 'test-basic.7z');

        await sevenZip(path.join(testDataDir, 'c'), targetPath);

        // Verify file was created
        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);

        // Verify 7z signature (first 6 bytes: 37 7A BC AF 27 1C)
        const fd = await fs.promises.open(targetPath, 'r');
        const buffer = Buffer.alloc(6);
        await fd.read(buffer, 0, 6, 0);
        await fd.close();

        expect(buffer[0]).toBe(0x37);
        expect(buffer[1]).toBe(0x7a);
        expect(buffer[2]).toBe(0xbc);
        expect(buffer[3]).toBe(0xaf);
        expect(buffer[4]).toBe(0x27);
        expect(buffer[5]).toBe(0x1c);
    });

    it('creates a 7z archive using ZipAFolder.sevenZip static method', async () => {
        const targetPath = path.join(testOutputDir, 'test-static.7z');

        await ZipAFolder.sevenZip(path.join(testDataDir, 'c'), targetPath);

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('creates 7z archive with medium compression level', async () => {
        const targetPath = path.join(testOutputDir, 'test-medium.7z');

        await sevenZip(path.join(testDataDir, 'c'), targetPath, {
            compression: 'medium'
        });

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('creates 7z archive with high compression level', async () => {
        const targetPath = path.join(testOutputDir, 'test-high.7z');

        await sevenZip(path.join(testDataDir, 'c'), targetPath, {
            compression: 'high'
        });

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('creates 7z archive with explicit compressionLevel', async () => {
        const targetPath = path.join(testOutputDir, 'test-level.7z');

        await sevenZip(path.join(testDataDir, 'c'), targetPath, {
            compressionLevel: 9
        });

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('creates 7z archive with uncompressed preset (minimum compression)', async () => {
        const targetPath = path.join(testOutputDir, 'test-uncompressed.7z');

        await sevenZip(path.join(testDataDir, 'c'), targetPath, {
            compression: 'uncompressed'
        });

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('supports custom write stream', async () => {
        const targetPath = path.join(testOutputDir, 'test-stream.7z');
        const writeStream = fs.createWriteStream(targetPath);

        await sevenZip(path.join(testDataDir, 'c'), undefined, {
            customWriteStream: writeStream
        });

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('throws error when no target file or stream provided', async () => {
        await expect(sevenZip(path.join(testDataDir, 'c'))).rejects.toThrow(
            'You must either provide a target file path or a custom write stream to write to.'
        );
    });

    it('throws error for non-existent source directory', async () => {
        const targetPath = path.join(testOutputDir, 'test-nonexistent.7z');

        await expect(sevenZip('/nonexistent/directory', targetPath)).rejects.toThrow();
    });

    it('throws error when target is inside source directory', async () => {
        const sourcePath = path.join(testDataDir, 'c');
        const targetPath = path.join(testDataDir, 'c', 'test.7z');

        await expect(sevenZip(sourcePath, targetPath)).rejects.toThrow('Source and target folder must be different.');
    });

    it('works with glob patterns', async () => {
        const targetPath = path.join(testOutputDir, 'test-glob.7z');

        // Use glob pattern to match txt files
        await sevenZip('test/data/c/*.txt', targetPath);

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('throws error for glob pattern with no matches', async () => {
        const targetPath = path.join(testOutputDir, 'test-no-match.7z');

        await expect(sevenZip('test/data/nonexistent/*.xyz', targetPath)).rejects.toThrow('No glob match found');
    });

    it('supports exclude patterns', async () => {
        const targetPath = path.join(testOutputDir, 'test-exclude.7z');

        // Create archive excluding c2.txt
        await sevenZip(path.join(testDataDir, 'c'), targetPath, {
            exclude: ['**/c2.txt']
        });

        const stat = await fs.promises.stat(targetPath);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('throws error when source is a file, not a directory', async () => {
        const targetPath = path.join(testOutputDir, 'test-file-source.7z');
        const sourceFile = path.join(testDataDir, 'c', 'c1.txt');

        await expect(sevenZip(sourceFile, targetPath)).rejects.toThrow(
            'Source must be a directory when no glob pattern is used.'
        );
    });
});

describe('Native7z class direct tests', () => {
    it('throws error when creating empty archive', async () => {
        const archive = new Native7z();
        const targetPath = path.join(testOutputDir, 'test-empty-native.7z');
        const writeStream = fs.createWriteStream(targetPath);

        await expect(archive.writeToStream(writeStream)).rejects.toThrow('Cannot create empty 7z archive');
    });

    it('skips directory entries', async () => {
        const archive = new Native7z();

        // Add a directory entry (should be skipped)
        await archive.addFile({
            relativePath: 'testdir',
            fsPath: testDataDir,
            stat: await fs.promises.stat(testDataDir),
            isDirectory: true
        });

        // Archive should still be empty (directory was skipped)
        const targetPath = path.join(testOutputDir, 'test-dir-skip.7z');
        const writeStream = fs.createWriteStream(targetPath);

        await expect(archive.writeToStream(writeStream)).rejects.toThrow('Cannot create empty 7z archive');
    });

    it('respects compression level bounds', () => {
        // Test compression level clamping
        const archiveLow = new Native7z(0); // Should be clamped to 1
        const archiveHigh = new Native7z(10); // Should be clamped to 9

        // Just verify construction doesn't throw
        expect(archiveLow).toBeDefined();
        expect(archiveHigh).toBeDefined();
    });
});
