'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.tar = exports.zip = exports.ZipAFolder = exports.COMPRESSION_LEVEL = void 0;
const path = require("path");
const archiver = require("archiver");
const fs = require("fs");
var COMPRESSION_LEVEL;
(function (COMPRESSION_LEVEL) {
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["uncompressed"] = 0] = "uncompressed";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["medium"] = 5] = "medium";
    COMPRESSION_LEVEL[COMPRESSION_LEVEL["high"] = 9] = "high";
})(COMPRESSION_LEVEL = exports.COMPRESSION_LEVEL || (exports.COMPRESSION_LEVEL = {}));
class ZipAFolder {
    static async tar(srcFolder, tarFilePath, zipAFolderOptions) {
        const o = zipAFolderOptions || {
            compression: COMPRESSION_LEVEL.high,
        };
        if (o.compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress({ srcFolder, targetFilePath: tarFilePath, format: 'tar', zipAFolderOptions });
        }
        else {
            await ZipAFolder.compress({
                srcFolder,
                targetFilePath: tarFilePath,
                format: 'tar',
                zipAFolderOptions,
                archiverOptions: {
                    gzip: true,
                    gzipOptions: {
                        level: o.compression,
                    },
                },
            });
        }
    }
    static async zip(srcFolder, zipFilePath, zipAFolderOptions) {
        const o = zipAFolderOptions || {
            compression: COMPRESSION_LEVEL.high,
        };
        if (o.compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress({
                srcFolder,
                targetFilePath: zipFilePath,
                format: 'zip',
                zipAFolderOptions,
                archiverOptions: {
                    store: true,
                },
            });
        }
        else {
            await ZipAFolder.compress({
                srcFolder,
                targetFilePath: zipFilePath,
                format: 'zip',
                zipAFolderOptions,
                archiverOptions: {
                    zlib: {
                        level: o.compression,
                    },
                },
            });
        }
    }
    static async compress({ srcFolder, targetFilePath, format, zipAFolderOptions, archiverOptions, }) {
        let output;
        if (!(zipAFolderOptions === null || zipAFolderOptions === void 0 ? void 0 : zipAFolderOptions.customWriteStream) && targetFilePath) {
            const targetBasePath = path.dirname(targetFilePath);
            if (targetBasePath === srcFolder) {
                throw new Error('Source and target folder must be different.');
            }
            try {
                await fs.promises.access(srcFolder, fs.constants.R_OK);
                await fs.promises.access(targetBasePath, fs.constants.R_OK | fs.constants.W_OK);
            }
            catch (e) {
                throw new Error(`Permission error: ${e.message}`);
            }
            output = fs.createWriteStream(targetFilePath);
        }
        else if (zipAFolderOptions && zipAFolderOptions.customWriteStream) {
            output = zipAFolderOptions === null || zipAFolderOptions === void 0 ? void 0 : zipAFolderOptions.customWriteStream;
        }
        else {
            throw new Error('You must either provide a target file path or a custom write stream to write to.');
        }
        const zipArchive = archiver(format, archiverOptions || {});
        return new Promise((resolve, reject) => {
            output.on('close', resolve);
            output.on('error', reject);
            zipArchive.pipe(output);
            zipArchive.directory(srcFolder, false);
            zipArchive.finalize();
        });
    }
}
exports.ZipAFolder = ZipAFolder;
exports.zip = ZipAFolder.zip;
exports.tar = ZipAFolder.tar;
//# sourceMappingURL=ZipAFolder.js.map