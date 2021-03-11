'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZipAFolder = void 0;
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
class ZipAFolder {
    static async zip(srcFolder, zipFilePath) {
        const targetBasePath = path.dirname(zipFilePath);
        if (targetBasePath === srcFolder) {
            throw new Error('Source and target folder must be different.');
        }
        return new Promise((resolve, reject) => {
            ZipAFolder.zipFolder(srcFolder, zipFilePath, (err) => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        });
    }
    static zipFolder(srcFolder, zipFilePath, callback) {
        fs.access(srcFolder, fs.constants.F_OK, (notExistingError) => {
            if (notExistingError) {
                return callback(notExistingError);
            }
            fs.access(path.dirname(zipFilePath), fs.constants.F_OK, (notExistingErrorInner) => {
                if (notExistingErrorInner) {
                    return callback(notExistingErrorInner);
                }
                const output = fs.createWriteStream(zipFilePath);
                const zipArchive = archiver('zip');
                output.on('close', function () {
                    callback();
                });
                zipArchive.pipe(output);
                zipArchive.directory(srcFolder, false);
                zipArchive.finalize();
            });
        });
    }
}
exports.ZipAFolder = ZipAFolder;
//# sourceMappingURL=ZipAFolder.js.map