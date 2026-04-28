import * as zlib from 'zlib';
import { normalizeMindMapFile, type MindMapFile, type MindMapItem, type MindMapIdFactory } from './mindmap-model';

interface ZipEntry {
  name: string;
  data: Buffer;
}

function defaultIdFactory(): string {
  return `xmind-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function xmlUnescape(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .trim();
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const signature = 0x06054b50;
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset--) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }
  throw new Error('不是有效的 XMind/ZIP 文件：找不到中央目录。');
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  let offset = centralOffset;
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('不是有效的 XMind/ZIP 文件：中央目录损坏。');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf-8');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`不是有效的 XMind/ZIP 文件：${name} 本地文件头损坏。`);
    }
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) {
      entries.set(name, Buffer.from(compressed));
    } else if (method === 8) {
      entries.set(name, zlib.inflateRawSync(compressed));
    } else {
      throw new Error(`暂不支持该 XMind 压缩方式：${method}`);
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8');
    const data = entry.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralStart = offset;
  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, eocd]);
}

function parseModernTopic(topic: unknown, idFactory: MindMapIdFactory, fallback: string): MindMapItem {
  const record = isRecord(topic) ? topic : {};
  const childrenRecord = isRecord(record.children) ? record.children : {};
  const attached = Array.isArray(childrenRecord.attached) ? childrenRecord.attached : [];
  const notesRecord = isRecord(record.notes) ? record.notes : {};
  const plainNote = isRecord(notesRecord.plain) ? notesRecord.plain.content : undefined;
  return {
    id: text(record.id, idFactory()),
    text: text(record.title, fallback),
    note: text(plainNote),
    children: attached.map((child, index) => parseModernTopic(child, idFactory, `分支 ${index + 1}`)),
  };
}

function findMatchingTopicEnd(xml: string, start: number): number {
  const topicTag = /<\/?[^>]*topic\b[^>]*>/gi;
  topicTag.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = topicTag.exec(xml))) {
    const tag = match[0];
    if (tag.startsWith('</')) {
      depth -= 1;
      if (depth === 0) {
        return topicTag.lastIndex;
      }
    } else if (!tag.endsWith('/>')) {
      depth += 1;
    }
  }
  throw new Error('XMind content.xml 中 topic 结构不完整。');
}

function parseLegacyTopic(xml: string, start: number, idFactory: MindMapIdFactory, fallback: string): MindMapItem {
  const openEnd = xml.indexOf('>', start);
  if (openEnd < 0) {
    throw new Error('XMind content.xml 中 topic 结构不完整。');
  }
  const openTag = xml.slice(start, openEnd + 1);
  const end = findMatchingTopicEnd(xml, start);
  const inner = xml.slice(openEnd + 1, end - '</topic>'.length);
  const id = /id=(["'])(.*?)\1/i.exec(openTag)?.[2] ?? idFactory();
  const firstNestedTopic = inner.search(/<[^>]*topic\b/i);
  const directHead = firstNestedTopic >= 0 ? inner.slice(0, firstNestedTopic) : inner;
  const title = xmlUnescape(/<[^>]*title[^>]*>([\s\S]*?)<\/[^>]*title>/i.exec(directHead)?.[1] ?? fallback);
  const children: MindMapItem[] = [];
  const childRegex = /<[^/!][^>]*topic\b[^>]*>/gi;
  childRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = childRegex.exec(inner))) {
    const absolute = openEnd + 1 + match.index;
    children.push(parseLegacyTopic(xml, absolute, idFactory, `分支 ${children.length + 1}`));
    const childEnd = findMatchingTopicEnd(xml, absolute);
    childRegex.lastIndex = childEnd - openEnd - 1;
  }
  return { id, text: title || fallback, children };
}

function parseModernXMind(content: string, idFactory: MindMapIdFactory): MindMapFile {
  const parsed = JSON.parse(content) as unknown;
  const sheets = Array.isArray(parsed) ? parsed : [parsed];
  const sheet = sheets.find(item => isRecord(item) && isRecord(item.rootTopic));
  if (!isRecord(sheet) || !isRecord(sheet.rootTopic)) {
    throw new Error('content.json 中未找到 rootTopic。');
  }
  const root = parseModernTopic(sheet.rootTopic, idFactory, text(sheet.title, '思维导图'));
  const now = new Date().toISOString();
  return normalizeMindMapFile({
    version: '1.0',
    id: idFactory(),
    title: root.text || text(sheet.title, '思维导图'),
    root,
    metadata: { created_at: now, updated_at: now },
  }, idFactory);
}

function parseLegacyXMind(content: string, idFactory: MindMapIdFactory): MindMapFile {
  const firstTopic = content.search(/<[^/!][^>]*topic\b/i);
  if (firstTopic < 0) {
    throw new Error('content.xml 中未找到 topic。');
  }
  const root = parseLegacyTopic(content, firstTopic, idFactory, '思维导图');
  const now = new Date().toISOString();
  return normalizeMindMapFile({
    version: '1.0',
    id: idFactory(),
    title: root.text || '思维导图',
    root,
    metadata: { created_at: now, updated_at: now },
  }, idFactory);
}

export function xmindBufferToMindMap(buffer: Buffer, idFactory: MindMapIdFactory = defaultIdFactory): MindMapFile {
  const entries = readZipEntries(buffer);
  const contentJson = entries.get('content.json');
  if (contentJson) {
    return parseModernXMind(contentJson.toString('utf-8'), idFactory);
  }
  const contentXml = entries.get('content.xml');
  if (contentXml) {
    return parseLegacyXMind(contentXml.toString('utf-8'), idFactory);
  }
  throw new Error('未找到 XMind 内容文件 content.json 或 content.xml。');
}

function mindMapItemToXMindTopic(item: MindMapItem): Record<string, unknown> {
  const topic: Record<string, unknown> = {
    id: item.id,
    title: item.text || '未命名条目',
  };
  if (item.note?.trim()) {
    topic.notes = {
      plain: { content: item.note.trim() },
    };
  }
  if (item.children.length > 0) {
    topic.children = {
      attached: item.children.map(mindMapItemToXMindTopic),
    };
  }
  return topic;
}

function mindMapItemToXmlTopic(item: MindMapItem): string {
  const children = item.children.length > 0
    ? `<children><topics type="attached">${item.children.map(mindMapItemToXmlTopic).join('')}</topics></children>`
    : '';
  const note = item.note?.trim()
    ? `<notes><plain>${xmlEscape(item.note.trim())}</plain></notes>`
    : '';
  return `<topic id="${xmlEscape(item.id)}"><title>${xmlEscape(item.text || '未命名条目')}</title>${note}${children}</topic>`;
}

export function mindMapToXMindBuffer(input: MindMapFile): Buffer {
  const file = normalizeMindMapFile(input);
  const now = new Date().toISOString();
  const contentJson = JSON.stringify([
    {
      id: file.id,
      class: 'sheet',
      title: file.title || file.root.text || '思维导图',
      rootTopic: mindMapItemToXMindTopic(file.root),
    },
  ], null, 2);
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><xmap-content><sheet id="${xmlEscape(file.id)}"><title>${xmlEscape(file.title || file.root.text || '思维导图')}</title>${mindMapItemToXmlTopic(file.root)}</sheet></xmap-content>`;
  const metadata = JSON.stringify({
    creator: { name: 'Research Space' },
    created: now,
    modified: now,
  }, null, 2);
  const manifest = JSON.stringify({
    'file-entries': {
      'content.json': {},
      'content.xml': {},
      'metadata.json': {},
    },
  }, null, 2);
  return writeZip([
    { name: 'content.json', data: Buffer.from(contentJson, 'utf-8') },
    { name: 'content.xml', data: Buffer.from(contentXml, 'utf-8') },
    { name: 'metadata.json', data: Buffer.from(metadata, 'utf-8') },
    { name: 'manifest.json', data: Buffer.from(manifest, 'utf-8') },
  ]);
}
