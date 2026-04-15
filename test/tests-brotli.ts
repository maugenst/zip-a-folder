'use strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as zlib from 'zlib';
import {COMPRESSION_LEVEL, tar} from '../lib/ZipAFolder';

describe('Brotli compression for TAR archives', () => {
    const srcDir = path.resolve(__dirname, 'data');
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-a-folder-brotli-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    it('creates brotli-compressed tar archive with compressionType option', async () => {
        const outFile = path.join(tmpDir, 'test.tar.br');

        await tar(srcDir, outFile, {
            compressionType: 'brotli'
        });

        expect(fs.existsSync(outFile)).toBe(true);
        const size = fs.statSync(outFile).size;
        expect(size).toBeGreaterThan(0);

        // Verify it's actually brotli-compressed by decompressing it
        const compressed = fs.readFileSync(outFile);
        const decompressed = zlib.brotliDecompressSync(compressed);
        expect(decompressed.length).toBeGreaterThan(size); // Decompressed should be larger
    });

    it('creates brotli-compressed tar with medium compression level', async () => {
        const outFile = path.join(tmpDir, 'test.medium.tar.br');

        await tar(srcDir, outFile, {
            compressionType: 'brotli',
            compression: COMPRESSION_LEVEL.medium
        });

        expect(fs.existsSync(outFile)).toBe(true);
        const size = fs.statSync(outFile).size;
        expect(size).toBeGreaterThan(0);
    });

    it('creates brotli-compressed tar with high compression level', async () => {
        const outFile = path.join(tmpDir, 'test.high.tar.br');

        await tar(srcDir, outFile, {
            compressionType: 'brotli',
            compression: COMPRESSION_LEVEL.high
        });

        expect(fs.existsSync(outFile)).toBe(true);
        const size = fs.statSync(outFile).size;
        expect(size).toBeGreaterThan(0);
    });

    it('creates brotli-compressed tar with custom brotliOptions', async () => {
        const outFile = path.join(tmpDir, 'test.custom.tar.br');

        await tar(srcDir, outFile, {
            compressionType: 'brotli',
            brotliOptions: {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 4, // Fast compression
                    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT
                }
            }
        });

        expect(fs.existsSync(outFile)).toBe(true);
        const size = fs.statSync(outFile).size;
        expect(size).toBeGreaterThan(0);

        // Verify it's brotli-compressed
        const compressed = fs.readFileSync(outFile);
        const decompressed = zlib.brotliDecompressSync(compressed);
        expect(decompressed.length).toBeGreaterThan(0);
    });

    it('brotli compression produces smaller file than uncompressed tar', async () => {
        const outBrotli = path.join(tmpDir, 'test.compare.tar.br');
        const outPlain = path.join(tmpDir, 'test.compare.tar');

        await tar(srcDir, outBrotli, {
            compressionType: 'brotli',
            compression: COMPRESSION_LEVEL.high
        });

        await tar(srcDir, outPlain, {
            compressionType: 'none'
        });

        const brotliSize = fs.statSync(outBrotli).size;
        const plainSize = fs.statSync(outPlain).size;

        expect(brotliSize).toBeLessThan(plainSize);
    });

    it('compressionType none creates uncompressed tar', async () => {
        const outFile = path.join(tmpDir, 'test.none.tar');

        await tar(srcDir, outFile, {
            compressionType: 'none'
        });

        expect(fs.existsSync(outFile)).toBe(true);
        const size = fs.statSync(outFile).size;
        expect(size).toBeGreaterThan(0);

        // Should NOT be gzip or brotli compressed - verify by checking magic bytes
        const content = fs.readFileSync(outFile);
        // TAR files don't have a magic number at start, but gzip starts with 0x1f 0x8b
        // and brotli doesn't have fixed magic bytes but won't start with typical tar header
        expect(content[0]).not.toBe(0x1f); // Not gzip
    });

    it('compression=uncompressed overrides compressionType', async () => {
        const outFile = path.join(tmpDir, 'test.override.tar');

        await tar(srcDir, outFile, {
            compressionType: 'brotli',
            compression: COMPRESSION_LEVEL.uncompressed
        });

        expect(fs.existsSync(outFile)).toBe(true);

        // Should be uncompressed, not brotli
        const content = fs.readFileSync(outFile);
        // Try to decompress as brotli - should fail
        expect(() => zlib.brotliDecompressSync(content)).toThrow();
    });

    it('works with custom write stream for brotli compression', async () => {
        const outFile = path.join(tmpDir, 'test.stream.tar.br');
        const writeStream = fs.createWriteStream(outFile);

        await tar(srcDir, undefined, {
            compressionType: 'brotli',
            customWriteStream: writeStream
        });

        expect(fs.existsSync(outFile)).toBe(true);
        const size = fs.statSync(outFile).size;
        expect(size).toBeGreaterThan(0);

        // Verify it's brotli-compressed
        const compressed = fs.readFileSync(outFile);
        const decompressed = zlib.brotliDecompressSync(compressed);
        expect(decompressed.length).toBeGreaterThan(0);
    });

    it('brotli quality affects file size', async () => {
        const outLowQuality = path.join(tmpDir, 'test.quality.low.tar.br');
        const outHighQuality = path.join(tmpDir, 'test.quality.high.tar.br');

        // Use bigData for more noticeable size difference
        const bigDataDir = path.resolve(__dirname, 'data', 'bigData');

        await tar(bigDataDir, outLowQuality, {
            compressionType: 'brotli',
            brotliOptions: {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 1 // Minimum quality
                }
            }
        });

        await tar(bigDataDir, outHighQuality, {
            compressionType: 'brotli',
            brotliOptions: {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY // Maximum quality (11)
                }
            }
        });

        const lowQualitySize = fs.statSync(outLowQuality).size;
        const highQualitySize = fs.statSync(outHighQuality).size;

        // Higher quality should produce smaller (or equal) file
        expect(highQualitySize).toBeLessThanOrEqual(lowQualitySize);
    });
});
