const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            if (c & 1) {
                c = 0xedb88320 ^ (c >>> 1);
            }
            else {
                c = c >>> 1;
            }
        }
        table[i] = c >>> 0;
    }
    return table;
})();
export function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        const byte = buf[i];
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
export function dateToDosTime(date, useLocal) {
    const secs = Math.floor((useLocal ? date.getSeconds() : date.getUTCSeconds()) / 2);
    const mins = useLocal ? date.getMinutes() : date.getUTCMinutes();
    const hrs = useLocal ? date.getHours() : date.getUTCHours();
    return (hrs << 11) | (mins << 5) | secs;
}
export function dateToDosDate(date, useLocal) {
    const year = useLocal ? date.getFullYear() : date.getUTCFullYear();
    const month = (useLocal ? date.getMonth() : date.getUTCMonth()) + 1;
    const day = useLocal ? date.getDate() : date.getUTCDate();
    const dosYear = year < 1980 ? 0 : year - 1980;
    return (dosYear << 9) | (month << 5) | day;
}
export function writeString(buf, str, offset, length) {
    const bytes = Buffer.from(str, 'utf8');
    bytes.copy(buf, offset, 0, Math.min(bytes.length, length));
}
export function writeOctal(buf, value, offset, length) {
    const oct = value.toString(8);
    const padded = oct.padStart(length - 1, '0');
    writeString(buf, padded, offset, length - 1);
    buf[offset + length - 1] = 0;
}
export function writeUInt64LE(buf, value, offset) {
    const low = value >>> 0;
    const high = Math.floor(value / 0x100000000) >>> 0;
    buf.writeUInt32LE(low, offset);
    buf.writeUInt32LE(high, offset + 4);
}
export function writeToStream(stream, data) {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            stream.removeListener('error', onError);
            reject(err);
        };
        stream.once('error', onError);
        stream.write(data, (err) => {
            stream.removeListener('error', onError);
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
export function looksLikeGlob(source) {
    return /[*?[\]{},]/.test(source);
}
//# sourceMappingURL=utils.js.map