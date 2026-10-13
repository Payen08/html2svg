import fs from 'node:fs';
import path from 'node:path';

export const pingFangFaces = [
    { weight: 100, style: 'Ultralight' },
    { weight: 200, style: 'Thin' },
    { weight: 300, style: 'Light' },
    { weight: 400, style: 'Regular' },
    { weight: 500, style: 'Medium' },
    { weight: 600, style: 'Semibold' },
];

function postscriptName(data: Buffer, fontOffset: number): string {
    const count = data.readUInt16BE(fontOffset + 4);
    for (let index = 0; index < count; index++) {
        const record = fontOffset + 12 + index * 16;
        if (data.toString('ascii', record, record + 4) !== 'name') continue;
        const nameOffset = data.readUInt32BE(record + 8);
        const names = data.readUInt16BE(nameOffset + 2);
        const strings = nameOffset + data.readUInt16BE(nameOffset + 4);
        for (let item = 0; item < names; item++) {
            const entry = nameOffset + 6 + item * 12;
            if (data.readUInt16BE(entry + 6) !== 6) continue;
            const start = strings + data.readUInt16BE(entry + 10);
            const value = Buffer.from(data.subarray(start, start + data.readUInt16BE(entry + 8)));
            const platform = data.readUInt16BE(entry);
            const name = platform === 0 || platform === 3 ? value.swap16().toString('utf16le') : value.toString('ascii');
            if (name.startsWith('PingFangSC-')) return name;
        }
    }
    return '';
}

function checksum(bytes: Buffer): number {
    let sum = 0;
    for (let index = 0; index < bytes.length; index += 4) sum = (sum + bytes.readUInt32BE(index)) >>> 0;
    return sum;
}

/** Fontkit needs a single SFNT font rather than the system TTC collection. */
export function extractPingFangFace(collection: Buffer, style: string): Buffer {
    if (collection.toString('ascii', 0, 4) !== 'ttcf') throw new Error('苹方字体不是有效的 TTC 集合。');
    const fonts = collection.readUInt32BE(8);
    let fontOffset = -1;
    for (let index = 0; index < fonts; index++) {
        const offset = collection.readUInt32BE(12 + index * 4);
        if (postscriptName(collection, offset) === `PingFangSC-${style}`) { fontOffset = offset; break; }
    }
    if (fontOffset < 0) throw new Error(`找不到 PingFang SC ${style} 字体。`);
    const tables = collection.readUInt16BE(fontOffset + 4);
    const headerSize = 12 + tables * 16;
    const records = Array.from({ length: tables }, (_, index) => {
        const entry = fontOffset + 12 + index * 16;
        const length = collection.readUInt32BE(entry + 12);
        return {
            tag: collection.toString('ascii', entry, entry + 4),
            offset: collection.readUInt32BE(entry + 8), length, paddedLength: Math.ceil(length / 4) * 4,
        };
    });
    const result = Buffer.alloc(headerSize + records.reduce((sum, record) => sum + record.paddedLength, 0));
    collection.copy(result, 0, fontOffset, fontOffset + 4);
    result.writeUInt16BE(tables, 4);
    const selector = Math.floor(Math.log2(tables));
    result.writeUInt16BE(2 ** selector * 16, 6);
    result.writeUInt16BE(selector, 8);
    result.writeUInt16BE(tables * 16 - 2 ** selector * 16, 10);
    let next = headerSize;
    let headOffset = 0;
    records.forEach((record, index) => {
        collection.copy(result, next, record.offset, record.offset + record.length);
        if (record.tag === 'head') { headOffset = next; result.writeUInt32BE(0, next + 8); }
        const entry = 12 + index * 16;
        result.write(record.tag, entry, 4, 'ascii');
        result.writeUInt32BE(checksum(result.subarray(next, next + record.paddedLength)), entry + 4);
        result.writeUInt32BE(next, entry + 8);
        result.writeUInt32BE(record.length, entry + 12);
        next += record.paddedLength;
    });
    if (headOffset) result.writeUInt32BE((0xB1B0AFBA - checksum(result)) >>> 0, headOffset + 8);
    return result;
}

function findPingFangPath(): string {
    const direct = '/System/Library/Fonts/PingFang.ttc';
    if (fs.existsSync(direct)) return direct;
    const root = '/System/Library/AssetsV2';
    try {
        for (const family of fs.readdirSync(root).filter(name => /^com_apple_MobileAsset_Font\d+$/.test(name))) {
            const directory = path.join(root, family);
            for (const asset of fs.readdirSync(directory).filter(name => name.endsWith('.asset'))) {
                const candidate = path.join(directory, asset, 'AssetData', 'PingFang.ttc');
                if (fs.existsSync(candidate)) return candidate;
            }
        }
    } catch {}
    throw new Error('本机没有找到 PingFang SC 字体，请在 macOS 中安装苹方字体后重试。');
}

const cache = new Map<string, Buffer>();
export function getLocalPingFangFont(weight: number): { bytes: Buffer; weight: number; style: string } {
    const face = pingFangFaces.reduce((best, candidate) =>
        Math.abs(candidate.weight - weight) < Math.abs(best.weight - weight) ? candidate : best
    );
    let bytes = cache.get(face.style);
    if (!bytes) {
        bytes = extractPingFangFace(fs.readFileSync(findPingFangPath()), face.style);
        cache.set(face.style, bytes);
    }
    return { bytes, weight: face.weight, style: face.style };
}
