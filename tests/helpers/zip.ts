import { crc32 } from "node:zlib";

export type ZipEntry = {
	name: string;
	data: Buffer;
	isDirectory: boolean;
	/** Offset of the local header, as recorded in the central directory. */
	offset: number;
	/** General purpose bit flag of the central directory record. */
	flags: number;
};

export type ZipArchive = {
	/** Entry count recorded in the end-of-central-directory record. */
	totalEntries: number;
	/** Entry count of this disk recorded in the end-of-central-directory record. */
	diskEntries: number;
	entries: ZipEntry[];
};

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

/**
 * Reads a zip archive whose entries use the stored method (0).
 * Verifies signatures, that each local header agrees with the central directory, and each CRC-32.
 * @throws Error when the archive is malformed or an entry uses another method.
 */
export function readZip(buffer: Buffer): ZipArchive {
	let end = -1;
	for (let i = buffer.length - 22; i >= 0; i--) {
		if (buffer.readUInt32LE(i) === END_SIGNATURE) {
			end = i;
			break;
		}
	}
	if (end === -1) throw new Error("end of central directory not found");

	const totalEntries = buffer.readUInt16LE(end + 10);
	const diskEntries = buffer.readUInt16LE(end + 8);
	const centralSize = buffer.readUInt32LE(end + 12);
	const centralOffset = buffer.readUInt32LE(end + 16);
	if (centralOffset + centralSize !== end) throw new Error("central directory does not end at the end record");

	const entries: ZipEntry[] = [];
	let pos = centralOffset;
	for (let n = 0; n < totalEntries; n++) {
		if (buffer.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw new Error(`bad central directory signature at ${pos}`);
		const flags = buffer.readUInt16LE(pos + 8);
		const method = buffer.readUInt16LE(pos + 10);
		const crc = buffer.readUInt32LE(pos + 16);
		const compressedSize = buffer.readUInt32LE(pos + 20);
		const size = buffer.readUInt32LE(pos + 24);
		const nameLength = buffer.readUInt16LE(pos + 28);
		const extraLength = buffer.readUInt16LE(pos + 30);
		const commentLength = buffer.readUInt16LE(pos + 32);
		const offset = buffer.readUInt32LE(pos + 42);
		const name = buffer.subarray(pos + 46, pos + 46 + nameLength).toString("utf8");
		pos += 46 + nameLength + extraLength + commentLength;

		if (method !== 0) throw new Error(`${name}: unsupported method ${method}`);
		if (compressedSize !== size) throw new Error(`${name}: stored sizes differ`);
		if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw new Error(`${name}: bad local header signature`);
		const localFlags = buffer.readUInt16LE(offset + 6);
		const localMethod = buffer.readUInt16LE(offset + 8);
		const localCrc = buffer.readUInt32LE(offset + 14);
		const localCompressed = buffer.readUInt32LE(offset + 18);
		const localSize = buffer.readUInt32LE(offset + 22);
		const localNameLength = buffer.readUInt16LE(offset + 26);
		const localExtraLength = buffer.readUInt16LE(offset + 28);
		const localName = buffer.subarray(offset + 30, offset + 30 + localNameLength).toString("utf8");
		if (localName !== name) throw new Error(`${name}: local header name is ${localName}`);
		if (localFlags !== flags || localMethod !== method) throw new Error(`${name}: local header flags or method differ`);
		if (localCrc !== crc || localCompressed !== compressedSize || localSize !== size) throw new Error(`${name}: local header sizes or CRC differ`);

		const start = offset + 30 + localNameLength + localExtraLength;
		const data = Buffer.from(buffer.subarray(start, start + size));
		if (data.length !== size) throw new Error(`${name}: data is truncated`);
		const actual = data.length === 0 ? 0 : crc32(data);
		if (actual !== crc) throw new Error(`${name}: CRC-32 mismatch`);

		entries.push({ name, data, isDirectory: name.endsWith("/"), offset, flags });
	}
	if (pos !== end) throw new Error("central directory size does not match its entries");
	return { totalEntries, diskEntries, entries };
}
