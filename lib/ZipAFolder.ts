'use strict';
import * as fs from 'fs';
import * as path from 'path';
import * as archiver from 'archiver';

export class ZipAFolder {
    static async zip(srcFolder: string, zipFilePath: string): Promise<void | Error> {
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

    static zipFolder(srcFolder: string, zipFilePath: string, callback: (error?: Error) => void): void {
        // folder double check
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

export const zip = ZipAFolder.zip;
export const zipFolder = ZipAFolder.zipFolder;
