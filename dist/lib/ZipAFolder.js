'use strict';
import path from 'path';
import archiver from 'archiver';
import fs from 'fs';
import isGlob from 'is-glob';
import { glob } from 'glob';
export var COMPRESSION_LEVEL;
(function(COMPRESSION_LEVEL) {
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["uncompressed"] = 0] = "uncompressed";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["medium"] = 5] = "medium";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["high"] = 9] = "high";
})(COMPRESSION_LEVEL || (COMPRESSION_LEVEL = {}));
export class ZipAFolder {
    /**
     * Tars a given folder or a glob into a gzipped tar archive.
     * If no zipAFolderOptions are passed in, the default compression level is high.
     * @param src can be a string path or a glob
     * @param tarFilePath path to the zip file
     * @param zipAFolderOptions
     */ static async tar(src, tarFilePath, zipAFolderOptions) {
        const o = zipAFolderOptions || {
            compression: COMPRESSION_LEVEL.high
        };
        if (o.compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress({
                src,
                targetFilePath: tarFilePath,
                format: 'tar',
                zipAFolderOptions
            });
        } else {
            await ZipAFolder.compress({
                src,
                targetFilePath: tarFilePath,
                format: 'tar',
                zipAFolderOptions,
                archiverOptions: {
                    gzip: true,
                    gzipOptions: {
                        level: o.compression
                    }
                }
            });
        }
    }
    /**
     * Zips a given folder or a glob into a zip archive.
     * If no zipAFolderOptions are passed in, the default compression level is high.
     * @param src can be a string path or a glob
     * @param zipFilePath path to the zip file
     * @param zipAFolderOptions
     */ static async zip(src, zipFilePath, zipAFolderOptions) {
        const o = zipAFolderOptions || {
            compression: COMPRESSION_LEVEL.high
        };
        if (o.compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress({
                src,
                targetFilePath: zipFilePath,
                format: 'zip',
                zipAFolderOptions,
                archiverOptions: {
                    store: true
                }
            });
        } else {
            await ZipAFolder.compress({
                src,
                targetFilePath: zipFilePath,
                format: 'zip',
                zipAFolderOptions,
                archiverOptions: {
                    zlib: {
                        level: o.compression
                    }
                }
            });
        }
    }
    static async compress({ src, targetFilePath, format, zipAFolderOptions, archiverOptions }) {
        let output;
        if (!zipAFolderOptions?.customWriteStream && targetFilePath) {
            const targetBasePath = path.dirname(targetFilePath);
            if (targetBasePath === src) {
                throw new Error('Source and target folder must be different.');
            }
            try {
                if (!isGlob(src)) {
                    await fs.promises.access(src, fs.constants.R_OK); //eslint-disable-line no-bitwise
                }
                await fs.promises.access(targetBasePath, fs.constants.R_OK | fs.constants.W_OK); //eslint-disable-line no-bitwise
            } catch (e) {
                throw new Error(`Permission error: ${e.message}`);
            }
            if (isGlob(src)) {
                const globList = [];
                for (const globPart of src.split(',')){
                    globList.push(...await glob(globPart.trim()));
                }
                if (globList.length === 0) {
                    throw new Error(`Glob "${src}" does not match any files or folders.`);
                }
            }
            output = fs.createWriteStream(targetFilePath);
        } else if (zipAFolderOptions && zipAFolderOptions.customWriteStream) {
            output = zipAFolderOptions?.customWriteStream;
        } else {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }
        const zipArchive = archiver(format, archiverOptions || {});
        return new Promise((resolve, reject)=>{
            output.on('close', resolve);
            output.on('error', reject);
            zipArchive.pipe(output);
            if (isGlob(src)) {
                for (const globPart of src.split(',')){
                    zipArchive.glob(globPart);
                }
            } else {
                zipArchive.directory(src, false);
            }
            zipArchive.finalize();
        });
    }
}
export const zip = ZipAFolder.zip;
export const tar = ZipAFolder.tar;

//# sourceMappingURL=ZipAFolder.js.map