// Zero-dependency Streaming ZIP + ZIP64 writer (STORE mode, ideal for already-compressed MP4 clips)
// Streams entries sequentially with CRC32 + Data Descriptors directly into an HTTP Writable stream.

// Standard IEEE 802.3 CRC-32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC_TABLE[i] = c >>> 0;
}

function crc32Update(crc, buf) {
    let c = (crc ^ 0xFFFFFFFF) >>> 0;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function toDosTimeDate(date) {
    const d = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    const year = Math.max(1980, d.getFullYear());
    const dosTime = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    const dosDate = (((year - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { dosTime, dosDate };
}

function writeBufferSafe(res, buf) {
    return new Promise((resolve, reject) => {
        if (res.destroyed || res.writableEnded) {
            return reject(new Error('Stream closed by client'));
        }
        const ok = res.write(buf);
        if (ok) return resolve();
        const onDrain = () => {
            cleanup();
            resolve();
        };
        const onError = (err) => {
            cleanup();
            reject(err);
        };
        const onClose = () => {
            cleanup();
            reject(new Error('Stream closed by client'));
        };
        function cleanup() {
            res.off('drain', onDrain);
            res.off('error', onError);
            res.off('close', onClose);
        }
        res.once('drain', onDrain);
        res.once('error', onError);
        res.once('close', onClose);
    });
}

class ZipStreamWriter {
    constructor(outputStream) {
        this.out = outputStream;
        this.offset = 0n;
        this.entries = [];
    }

    async writeChunk(buf) {
        await writeBufferSafe(this.out, buf);
        this.offset += BigInt(buf.length);
    }

    /**
     * Begin a new file entry, consume chunks from an async source/stream, and write its Data Descriptor.
     * Note: We cannot rewind after streaming, so if the upstream read fails mid-file, the entry is finalized
     * with whatever bytes arrived (or an empty entry if 0 bytes arrived) and an optional error note.
     */
    async addStreamEntry(filePath, mtime, readableStream) {
        const nameBuf = Buffer.from(filePath, 'utf8');
        const { dosTime, dosDate } = toDosTimeDate(mtime);
        const entryOffset = this.offset;

        // Local File Header (30 bytes + filename)
        // Flags: Bit 3 (0x0008 = Data Descriptor) | Bit 11 (0x0800 = UTF-8 filename) => 0x0808
        const lfh = Buffer.alloc(30 + nameBuf.length);
        lfh.writeUInt32LE(0x04034B50, 0);
        lfh.writeUInt16LE(45, 4);          // Version needed: 4.5 (ZIP64 capable)
        lfh.writeUInt16LE(0x0808, 6);      // General purpose bit flag
        lfh.writeUInt16LE(0, 8);           // Compression: 0 = STORE
        lfh.writeUInt16LE(dosTime, 10);
        lfh.writeUInt16LE(dosDate, 12);
        lfh.writeUInt32LE(0, 14);          // CRC-32 (deferred to Data Descriptor)
        lfh.writeUInt32LE(0, 18);          // Compressed size (deferred)
        lfh.writeUInt32LE(0, 22);          // Uncompressed size (deferred)
        lfh.writeUInt16LE(nameBuf.length, 26);
        lfh.writeUInt16LE(0, 28);          // Extra field length
        nameBuf.copy(lfh, 30);

        await this.writeChunk(lfh);

        let crc = 0;
        let size = 0n;
        for await (const rawChunk of readableStream) {
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            if (chunk.length === 0) continue;
            crc = crc32Update(crc, chunk);
            size += BigInt(chunk.length);
            await this.writeChunk(chunk);
        }

        // If individual file >= 4GB, Data Descriptor uses 8-byte sizes; standard video clips are <4GB so 4-byte sizes
        const dd = Buffer.alloc(16);
        dd.writeUInt32LE(0x08074B50, 0);
        dd.writeUInt32LE(crc >>> 0, 4);
        dd.writeUInt32LE(Number(size & 0xFFFFFFFFn), 8);
        dd.writeUInt32LE(Number(size & 0xFFFFFFFFn), 12);
        await this.writeChunk(dd);

        this.entries.push({
            nameBuf,
            dosTime,
            dosDate,
            crc: crc >>> 0,
            size,
            offset: entryOffset
        });

        return size;
    }

    async finalize() {
        const cdOffset = this.offset;
        const needZip64Overall = this.entries.length >= 0xFFFF || cdOffset >= 0xFFFFFFFFn;

        for (const e of this.entries) {
            const needZip64Size = e.size >= 0xFFFFFFFFn;
            const needZip64Offset = e.offset >= 0xFFFFFFFFn;

            let extraLen = 0;
            if (needZip64Size || needZip64Offset) {
                extraLen = 4 + (needZip64Size ? 16 : 0) + (needZip64Offset ? 8 : 0);
            }

            const cdfh = Buffer.alloc(46 + e.nameBuf.length + extraLen);
            cdfh.writeUInt32LE(0x02014B50, 0);
            cdfh.writeUInt16LE(45, 4);          // Version made by
            cdfh.writeUInt16LE(45, 6);          // Version needed
            cdfh.writeUInt16LE(0x0808, 8);      // Flags (Data Descriptor + UTF-8)
            cdfh.writeUInt16LE(0, 10);          // Compression: STORE
            cdfh.writeUInt16LE(e.dosTime, 12);
            cdfh.writeUInt16LE(e.dosDate, 14);
            cdfh.writeUInt32LE(e.crc, 16);
            cdfh.writeUInt32LE(needZip64Size ? 0xFFFFFFFF : Number(e.size), 20);
            cdfh.writeUInt32LE(needZip64Size ? 0xFFFFFFFF : Number(e.size), 24);
            cdfh.writeUInt16LE(e.nameBuf.length, 28);
            cdfh.writeUInt16LE(extraLen, 30);
            cdfh.writeUInt16LE(0, 32);          // File comment length
            cdfh.writeUInt16LE(0, 34);          // Disk number start
            cdfh.writeUInt16LE(0, 36);          // Internal attributes
            cdfh.writeUInt32LE(0, 38);          // External attributes
            cdfh.writeUInt32LE(needZip64Offset ? 0xFFFFFFFF : Number(e.offset), 42);
            e.nameBuf.copy(cdfh, 46);

            if (extraLen > 0) {
                let p = 46 + e.nameBuf.length;
                cdfh.writeUInt16LE(0x0001, p); // ZIP64 Extended Information Extra Field ID
                cdfh.writeUInt16LE(extraLen - 4, p + 2);
                p += 4;
                if (needZip64Size) {
                    cdfh.writeBigUInt64LE(e.size, p);
                    cdfh.writeBigUInt64LE(e.size, p + 8);
                    p += 16;
                }
                if (needZip64Offset) {
                    cdfh.writeBigUInt64LE(e.offset, p);
                }
            }

            await this.writeChunk(cdfh);
        }

        const cdSize = this.offset - cdOffset;
        const useZip64 = needZip64Overall || cdSize >= 0xFFFFFFFFn;

        if (useZip64) {
            const zip64EocdOffset = this.offset;
            const z64 = Buffer.alloc(56);
            z64.writeUInt32LE(0x06064B50, 0);
            z64.writeBigUInt64LE(44n, 4);      // Size of remaining ZIP64 EOCD record
            z64.writeUInt16LE(45, 12);         // Version made by
            z64.writeUInt16LE(45, 14);         // Version needed
            z64.writeUInt32LE(0, 16);          // Disk number
            z64.writeUInt32LE(0, 20);          // Start disk
            z64.writeBigUInt64LE(BigInt(this.entries.length), 24);
            z64.writeBigUInt64LE(BigInt(this.entries.length), 32);
            z64.writeBigUInt64LE(cdSize, 40);
            z64.writeBigUInt64LE(cdOffset, 48);
            await this.writeChunk(z64);

            const loc = Buffer.alloc(20);
            loc.writeUInt32LE(0x07064B50, 0);
            loc.writeUInt32LE(0, 4);           // Disk with ZIP64 EOCD
            loc.writeBigUInt64LE(zip64EocdOffset, 8);
            loc.writeUInt32LE(1, 16);          // Total disks
            await this.writeChunk(loc);
        }

        // Standard End of Central Directory (22 bytes)
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054B50, 0);
        eocd.writeUInt16LE(0, 4);
        eocd.writeUInt16LE(0, 6);
        eocd.writeUInt16LE(this.entries.length >= 0xFFFF ? 0xFFFF : this.entries.length, 8);
        eocd.writeUInt16LE(this.entries.length >= 0xFFFF ? 0xFFFF : this.entries.length, 10);
        eocd.writeUInt32LE(cdSize >= 0xFFFFFFFFn ? 0xFFFFFFFF : Number(cdSize), 12);
        eocd.writeUInt32LE(cdOffset >= 0xFFFFFFFFn ? 0xFFFFFFFF : Number(cdOffset), 16);
        eocd.writeUInt16LE(0, 20);
        await this.writeChunk(eocd);
    }
}

module.exports = { ZipStreamWriter, crc32Update };
