import { lookup } from 'node:dns/promises';
import { BlockList, isIPv4 } from 'node:net';
import { request, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';

export const NEWS_IMAGE_FETCH = Symbol('NEWS_IMAGE_FETCH');
export const IMAGE_MAX_BYTES = 384 * 1024;
export type ImageDownload = { bytes: Buffer; contentType: string };
export type NewsImageFetcher = (url: URL) => Promise<ImageDownload>;
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');

export function isPublicImageAddress(address: string) {
  return isIPv4(address) && !blocked.check(address, 'ipv4');
}

/** Only public IPv4 CDN addresses; pin DNS result to this TLS connection.
 * No redirects, proxies, cookies, authorization, decompression or arbitrary ports.
 */
export function createImageDownloader(
  resolveHost: (hostname: string) => Promise<{ address: string }[]> = (
    hostname,
  ) => lookup(hostname, { family: 4, all: true }),
  send: (
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) => ClientRequest = request,
): NewsImageFetcher {
  return async (url) => {
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      throw new Error('Invalid image URL');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const answers = await Promise.race([
        resolveHost(url.hostname),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error('Image timeout')),
            { once: true },
          ),
        ),
      ]);
      if (
        !answers.length ||
        answers.some(({ address }) => !isPublicImageAddress(address))
      )
        throw new Error('Non-public image address');
      if (controller.signal.aborted) throw new Error('Image timeout');
      return await new Promise<ImageDownload>((resolve, reject) => {
        const req = send(
          {
            protocol: 'https:',
            hostname: url.hostname,
            port: 443,
            path: url.pathname + url.search,
            method: 'GET',
            servername: url.hostname,
            family: 4,
            agent: false,
            lookup: (_host, _options, callback) =>
              callback(null, answers[0].address, 4),
            signal: controller.signal,
            maxHeaderSize: 8192,
            headers: {
              Accept: 'image/png,image/jpeg,image/webp',
              'Accept-Encoding': 'identity',
            },
          },
          (response) => {
            const contentType =
              response.headers['content-type']
                ?.split(';')[0]
                .trim()
                .toLowerCase() ?? '';
            const length = response.headers['content-length'];
            if (
              response.statusCode !== 200 ||
              !['image/png', 'image/jpeg', 'image/webp'].includes(
                contentType,
              ) ||
              (response.headers['content-encoding'] &&
                response.headers['content-encoding'] !== 'identity') ||
              (length &&
                (!/^\d+$/.test(length) || Number(length) > IMAGE_MAX_BYTES))
            ) {
              response.destroy();
              req.destroy();
              reject(new Error('Invalid image response'));
              return;
            }
            const parts: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > IMAGE_MAX_BYTES) {
                response.destroy();
                req.destroy();
                reject(new Error('Image exceeds limit'));
              } else parts.push(chunk);
            });
            response.once('error', reject);
            response.once('aborted', () =>
              reject(new Error('Incomplete image')),
            );
            response.once('end', () =>
              resolve({ bytes: Buffer.concat(parts), contentType }),
            );
          },
        );
        req.once('error', reject);
        req.end();
      });
    } finally {
      clearTimeout(timer);
    }
  };
}
export const downloadNewsImage = createImageDownloader();

/** Header bounds are checked before a native decoder sees the image. Corrupt
 * image bodies can still fail decoding: mobile must retain its error fallback.
 */
export function imageDimensions({ bytes: data, contentType }: ImageDownload) {
  if (data.length < 12 || data.length > IMAGE_MAX_BYTES)
    throw new Error('Invalid image size');
  let width = 0,
    height = 0;
  if (contentType === 'image/png') {
    if (
      data.length < 33 ||
      data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      data.readUInt32BE(8) !== 13 ||
      data.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error('Invalid PNG');
    width = data.readUInt32BE(16);
    height = data.readUInt32BE(20);
    let offset = 8,
      ended = false;
    while (offset + 12 <= data.length) {
      const length = data.readUInt32BE(offset);
      if (length > data.length - offset - 12)
        throw new Error('Invalid PNG chunk');
      const kind = data.toString('ascii', offset + 4, offset + 8);
      if (['acTL', 'fcTL', 'fdAT'].includes(kind))
        throw new Error('Animated images are unsupported');
      offset += length + 12;
      if (kind === 'IEND') {
        ended = true;
        break;
      }
    }
    if (!ended || offset !== data.length) throw new Error('Incomplete PNG');
  } else if (contentType === 'image/jpeg') {
    if (data[0] !== 0xff || data[1] !== 0xd8) throw new Error('Invalid JPEG');
    let offset = 2;
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 0xff) throw new Error('Invalid JPEG marker');
      while (data[offset] === 0xff) offset++;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > data.length) break;
      const size = data.readUInt16BE(offset);
      if (size < 2 || offset + size > data.length)
        throw new Error('Invalid JPEG segment');
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) throw new Error('Invalid JPEG frame');
        height = data.readUInt16BE(offset + 3);
        width = data.readUInt16BE(offset + 5);
        break;
      }
      offset += size;
    }
  } else if (contentType === 'image/webp') {
    if (
      data.length < 25 ||
      data.toString('ascii', 0, 4) !== 'RIFF' ||
      data.toString('ascii', 8, 12) !== 'WEBP' ||
      data.readUInt32LE(4) + 8 !== data.length
    )
      throw new Error('Invalid WebP');
    const kind = data.toString('ascii', 12, 16);
    if (kind === 'VP8X' && data.length >= 30 && !(data[20] & 2)) {
      width = data.readUIntLE(24, 3) + 1;
      height = data.readUIntLE(27, 3) + 1;
    } else if (kind === 'VP8L' && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21);
      if (bits >>> 29) throw new Error('Unsupported WebP version');
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (
      kind === 'VP8 ' &&
      data.length >= 30 &&
      data.toString('hex', 23, 26) === '9d012a'
    ) {
      width = data.readUInt16LE(26) & 0x3fff;
      height = data.readUInt16LE(28) & 0x3fff;
    }
  }
  if (
    !width ||
    !height ||
    width > 2048 ||
    height > 2048 ||
    width * height > 4_000_000
  )
    throw new Error('Unsupported image dimensions');
  return { width, height };
}
