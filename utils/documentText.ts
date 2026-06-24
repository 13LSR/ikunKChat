const DOCX_DOCUMENT_PATH = 'word/document.xml';

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minOffset = Math.max(0, bytes.length - 0xffff - 22);

  for (let offset = bytes.length - 22; offset >= minOffset; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error('Invalid DOCX archive.');
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support DOCX decompression.');
  }

  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
};

const readZipEntry = async (bytes: Uint8Array, entryName: string): Promise<Uint8Array> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let centralOffset = view.getUint32(eocdOffset + 16, true);

  for (let index = 0; index < entryCount; index++) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) {
      throw new Error('Invalid DOCX central directory.');
    }

    const compressionMethod = view.getUint16(centralOffset + 10, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const fileNameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localHeaderOffset = view.getUint32(centralOffset + 42, true);
    const fileName = decoder.decode(bytes.slice(centralOffset + 46, centralOffset + 46 + fileNameLength));

    if (fileName === entryName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error('Invalid DOCX local file header.');
      }

      const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressedData = bytes.slice(dataOffset, dataOffset + compressedSize);

      if (compressionMethod === 0) return compressedData;
      if (compressionMethod === 8) return inflateRaw(compressedData);

      throw new Error('Unsupported DOCX compression method.');
    }

    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error('DOCX document body was not found.');
};

const collectText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';

  const name = node.nodeName.toLowerCase();
  if (name === 'w:t' || name.endsWith(':t')) return node.textContent || '';
  if (name === 'w:tab' || name.endsWith(':tab')) return '\t';
  if (name === 'w:br' || name.endsWith(':br')) return '\n';

  let text = '';
  node.childNodes.forEach(child => {
    text += collectText(child);
  });
  return text;
};

const extractDocxXmlText = (xml: string): string => {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = document.querySelector('parsererror');
  if (parserError) {
    throw new Error('DOCX text could not be parsed.');
  }

  const paragraphs = Array.from(document.getElementsByTagName('w:p'));
  const lines = paragraphs
    .map(paragraph => collectText(paragraph).trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return lines.join('\n');
  }

  return Array.from(document.getElementsByTagName('w:t'))
    .map(node => node.textContent || '')
    .join('')
    .trim();
};

export const extractDocxText = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const documentXml = await readZipEntry(bytes, DOCX_DOCUMENT_PATH);
  return extractDocxXmlText(new TextDecoder('utf-8').decode(documentXml));
};

export const isDocxFile = (file: File): boolean =>
  file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  file.name.toLowerCase().endsWith('.docx');
