import {describe, expect, it} from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {PassThrough} from 'stream';
import {NativeZip} from '../lib/zip/NativeZip'; // adjust path if needed

// Helper: parse central directory entries from a zip Buffer.
// We only parse enough to extract: file name, version made by, external file attributes.
function parseCentralDirectory(buffer: Buffer) {
    const entries: Array<{name: string; versionMadeBy: number; externalAttrs: number}> = [];
    // Find End of Central Directory record (EOCD, 0x06054b50)
    const eocdSig = 0x06054b50;
    // Search from end
    for (let i = buffer.length - 22; i >= 0; i--) {
        if (buffer.readUInt32LE(i) === eocdSig) {
            const cdSize = buffer.readUInt32LE(i + 12);
            const cdOffset = buffer.readUInt32LE(i + 16);
            let p = cdOffset;
            const cdEnd = cdOffset + cdSize;
            while (p < cdEnd) {
                // Central file header signature 0x02014b50
                const sig = buffer.readUInt32LE(p);
                if (sig !== 0x02014b50) {
                    throw new Error('Bad central header sig');
                }
                const versionMadeBy = buffer.readUInt16LE(p + 4);
                const nameLen = buffer.readUInt16LE(p + 28);
                const extraLen = buffer.readUInt16LE(p + 30);
                const commentLen = buffer.readUInt16LE(p + 32);
                // Correct offset for external file attributes is 38 bytes from start
                const externalAttrs = buffer.readUInt32LE(p + 38);
                const nameStart = p + 46;
                const name = buffer.slice(nameStart, nameStart + nameLen).toString('utf8');
                entries.push({name, versionMadeBy, externalAttrs});
                p = nameStart + nameLen + extraLen + commentLen;
            }
            break;
        }
    }
    return entries;
}

// Helper to write NativeZip to buffer via a writable stream
async function zipToBuffer(zip: NativeZip): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', (c: Buffer) => chunks.push(c));
    await zip.writeToStream(stream);
    return Buffer.concat(chunks);
}

describe('ZIP mode and version fields', () => {
    it('writes version-made-by upper byte = 3 (Unix) and stores mode in external attributes', async () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-test-'));
        try {
            // prepare files/dirs with known modes
            const dirPath = path.join(tmp, 'subdir');
            fs.mkdirSync(dirPath);
            fs.chmodSync(dirPath, 0o755);

            const filePath = path.join(tmp, 'hello.txt');
            fs.writeFileSync(filePath, 'hello');
            fs.chmodSync(filePath, 0o644);

            // create zip via NativeZip (adjust calls if your API differs)
            const zip = new NativeZip();
            // add directory entry
            zip.addDirectoryEntry('subdir/', new Date(), 0o755);
            // add file entry from fs
            await zip.addFileFromFs(filePath, 'hello.txt', new Date(), 0o644);

            // get buffer by writing to stream
            const zipBuffer: Buffer = await zipToBuffer(zip);

            // parse central directory and find entries
            const entries = parseCentralDirectory(zipBuffer);
            const fileEntry = entries.find((e) => e.name === 'hello.txt');
            const dirEntry = entries.find((e) => e.name === 'subdir/' || e.name === 'subdir');

            expect(fileEntry).toBeDefined();
            expect(dirEntry).toBeDefined();

            // versionMadeBy: upper byte should be 3
            const fileVm = ((fileEntry as any).versionMadeBy >> 8) & 0xff;
            const dirVm = ((dirEntry as any).versionMadeBy >> 8) & 0xff;
            expect(fileVm).toBe(3);
            expect(dirVm).toBe(3);

            // externalAttrs upper 16 bits contain mode as written by NativeZip
            const fileModeStored = (fileEntry as any).externalAttrs >>> 16;
            const dirModeStored = (dirEntry as any).externalAttrs >>> 16;

            expect(fileModeStored & 0o7777).toBe(0o644);
            // For directories the original code also ORs 0x10 for directory attribute in low byte.
            expect(dirModeStored & 0o7777).toBe(0o755);

            // also ensure directory low attributes include directory flag (0x10)
            expect(((dirEntry as any).externalAttrs & 0x10) === 0x10).toBe(true);
        } finally {
            // cleanup
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    });
});
