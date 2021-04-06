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
    static async tar(srcFolder, zipFilePath, compression) {
        if (compression === undefined || compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'tar');
        }
        else {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'tar', {
                gzip: true,
                gzipOptions: { level: compression },
            });
        }
    }
    static async zip(srcFolder, zipFilePath, compression) {
        if (compression === undefined || compression === COMPRESSION_LEVEL.uncompressed) {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'zip', {
                store: true,
            });
        }
        else {
            await ZipAFolder.compress(srcFolder, zipFilePath, 'zip', {
                zlib: { level: compression },
            });
        }
    }
    static async compress(srcFolder, zipFilePath, format, archiverOptions) {
        const targetBasePath = path.dirname(zipFilePath);
        if (targetBasePath === srcFolder) {
            throw new Error('Source and target folder must be different.');
        }
        try {
            await fs.promises.access(srcFolder, fs.constants.R_OK | fs.constants.W_OK);
            await fs.promises.access(targetBasePath, fs.constants.R_OK | fs.constants.W_OK);
        }
        catch (e) {
            throw new Error(`Permission error: ${e.message}`);
        }
        const output = fs.createWriteStream(zipFilePath);
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