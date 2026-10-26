import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NewsImageService } from './news-image.service.js';
import {
  createImageDownloader,
  IMAGE_MAX_BYTES,
  imageDimensions,
  isPublicImageAddress,
  type NewsImageFetcher,
} from './news-image.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWPgqLL/DwADEAHBRHIeYAAAAABJRU5ErkJggg==',
  'base64',
);
describe('news image validation and public fetch boundary', () => {
  it('rejects private, metadata, special-purpose, IPv6 and non-canonical addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '100.100.100.200',
      '172.31.0.1',
      '192.168.0.1',
      '192.0.0.8',
      '198.18.1.1',
      '198.51.100.5',
      '203.0.113.4',
      '224.0.0.1',
      '255.255.255.255',
      '0.0.0.0',
      '::1',
      '::ffff:8.8.8.8',
      '2130706433',
      'not-an-ip',
    ])
      expect(isPublicImageAddress(address)).toBe(false);
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34'])
      expect(isPublicImageAddress(address)).toBe(true);
  });
  it('checks PNG/JPEG/WebP headers, dimensions, MIME and payload limits', () => {
    expect(imageDimensions({ bytes: png, contentType: 'image/png' })).toEqual({
      width: 1,
      height: 1,
    });
    const animationChunk = Buffer.alloc(12);
    animationChunk.write('acTL', 4);
    expect(() =>
      imageDimensions({
        bytes: Buffer.concat([
          png.subarray(0, 33),
          animationChunk,
          png.subarray(33),
        ]),
        contentType: 'image/png',
      }),
    ).toThrow('Animated');
    const oversized = Buffer.from(png);
    oversized.writeUInt32BE(4096, 16);
    for (const [bytes, contentType] of [
      [png, 'image/jpeg'],
      [Buffer.from('<svg>attack</svg>'), 'image/png'],
      [oversized, 'image/png'],
      [Buffer.alloc(IMAGE_MAX_BYTES + 1), 'image/png'],
    ] as const)
      expect(() => imageDimensions({ bytes, contentType })).toThrow();
    const jpg = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 2, 0, 3, 0, 0xff, 0xd9,
    ]);
    expect(imageDimensions({ bytes: jpg, contentType: 'image/jpeg' })).toEqual({
      width: 3,
      height: 2,
    });
    const webp = Buffer.alloc(30);
    webp.write('RIFF');
    webp.writeUInt32LE(22, 4);
    webp.write('WEBP', 8);
    webp.write('VP8X', 12);
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(2, 24, 3);
    webp.writeUIntLE(1, 27, 3);
    expect(imageDimensions({ bytes: webp, contentType: 'image/webp' })).toEqual(
      { width: 3, height: 2 },
    );
    webp[20] = 2;
    expect(() =>
      imageDimensions({ bytes: webp, contentType: 'image/webp' }),
    ).toThrow();
  });
  function transport({
    status = 200,
    mime = 'image/png',
    chunks = [png],
    encoding = '',
    length = String(png.length),
  } = {}) {
    let options: RequestOptions | undefined;
    const send = vi.fn(
      (opts: RequestOptions, callback: (response: IncomingMessage) => void) => {
        options = opts;
        const req = new EventEmitter() as ClientRequest;
        req.destroy = (() => req) as ClientRequest['destroy'];
        req.end = (() => {
          queueMicrotask(() => {
            const res = new EventEmitter() as IncomingMessage;
            res.statusCode = status;
            res.headers = {
              'content-type': mime,
              'content-length': length,
              'content-encoding': encoding,
            };
            res.destroy = (() => res) as IncomingMessage['destroy'];
            callback(res);
            for (const chunk of chunks) res.emit('data', chunk);
            res.emit('end');
          });
          return req;
        }) as ClientRequest['end'];
        return req;
      },
    );
    return { send, options: () => options };
  }
  it('pins a validated DNS answer, keeps TLS hostname and sends no user credentials', async () => {
    const t = transport();
    const resolveHost = vi.fn(async () => [{ address: '8.8.8.8' }]);
    const image = await createImageDownloader(
      resolveHost,
      t.send,
    )(new URL('https://cdn.example.test/path.png?version=1'));
    expect(image.bytes).toEqual(png);
    expect(resolveHost).toHaveBeenCalledTimes(1);
    const opts = t.options()!;
    expect(opts).toMatchObject({
      hostname: 'cdn.example.test',
      servername: 'cdn.example.test',
      port: 443,
      agent: false,
      family: 4,
    });
    expect(opts.headers).toEqual({
      Accept: 'image/png,image/jpeg,image/webp',
      'Accept-Encoding': 'identity',
    });
    const callback = vi.fn();
    opts.lookup!('ignored', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });
  it('never opens a connection for private/mixed DNS answers or non-HTTPS URLs', async () => {
    for (const answers of [
      [{ address: '127.0.0.1' }],
      [{ address: '8.8.8.8' }, { address: '10.0.0.1' }],
      [],
    ]) {
      const t = transport();
      await expect(
        createImageDownloader(
          async () => answers,
          t.send,
        )(new URL('https://cdn.example.test/img')),
      ).rejects.toThrow();
      expect(t.send).not.toHaveBeenCalled();
    }
    const t = transport();
    await expect(
      createImageDownloader(
        undefined,
        t.send,
      )(new URL('http://cdn.example.test/img')),
    ).rejects.toThrow();
    expect(t.send).not.toHaveBeenCalled();
  });
  it('rejects redirects without following them, MIME tricks, compressed and oversized bodies', async () => {
    for (const input of [
      { status: 302 },
      { mime: 'image/svg+xml' },
      { encoding: 'gzip' },
      { length: String(IMAGE_MAX_BYTES + 1) },
      { length: '', chunks: [Buffer.alloc(IMAGE_MAX_BYTES + 1)] },
    ]) {
      const t = transport(input);
      await expect(
        createImageDownloader(
          async () => [{ address: '8.8.8.8' }],
          t.send,
        )(new URL('https://cdn.example.test/img')),
      ).rejects.toThrow();
      expect(t.send).toHaveBeenCalledTimes(1);
    }
  });
  it('bounds even DNS timeout; no eventual late answer opens a connection', async () => {
    vi.useFakeTimers();
    try {
      const t = transport();
      const result = createImageDownloader(
        () => new Promise(() => {}),
        t.send,
      )(new URL('https://cdn.example.test/img'));
      const rejected = expect(result).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(t.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('news image service', () => {
  function fixture(
    fetcher: NewsImageFetcher = async () => ({
      bytes: png,
      contentType: 'image/png',
    }),
  ) {
    const findFirst = vi
      .fn()
      .mockResolvedValue({ coverUrl: 'https://cdn.example.test/image.png' });
    const download = vi.fn(fetcher);
    const service = new NewsImageService(
      { consumerNews: { findFirst } } as unknown as PrismaService,
      new ConfigService({ PUBLIC_NEWS_IMAGE_HOSTS: 'cdn.example.test' }),
      download,
    );
    return { findFirst, download, service };
  }
  it('only returns whitelisted raster fields, caches but rechecks publication every time', async () => {
    const f = fixture();
    expect(await f.service.cover('id')).toEqual({
      mimeType: 'image/png',
      width: 1,
      height: 1,
      dataBase64: png.toString('base64'),
    });
    await f.service.cover('id');
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.findFirst).toHaveBeenCalledTimes(2);
    expect(f.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPublished: true }),
        select: { coverUrl: true,coverContent:true,coverMimeType:true },
      }),
    );
    f.findFirst.mockResolvedValue(null);
    await expect(f.service.cover('id')).rejects.toThrow('Chưa có ảnh');
  });
  it('does not request forbidden images and sanitizes upstream errors', async () => {
    const f = fixture();
    f.findFirst.mockResolvedValue({
      coverUrl: 'https://evil.example/image.png',
    });
    await expect(f.service.cover('id')).rejects.toThrow('Chưa có ảnh');
    expect(f.download).not.toHaveBeenCalled();
    const broken = fixture(async () => {
      throw new Error('secret URL and token');
    });
    await expect(broken.service.cover('id')).rejects.toThrow(
      'Chưa tải được ảnh',
    );
    await expect(broken.service.cover('id')).rejects.not.toThrow('secret');
  });
  it('single-flights downloads and caps distinct concurrent requests', async () => {
    const releases: (() => void)[] = [];
    const f = fixture(
      () =>
        new Promise((resolve) =>
          releases.push(() =>
            resolve({ bytes: png, contentType: 'image/png' }),
          ),
        ),
    );
    f.findFirst.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({
        coverUrl: `https://cdn.example.test/${where.id}.png`,
      }),
    );
    const a = f.service.cover('a'),
      duplicate = f.service.cover('a'),
      b = f.service.cover('b'),
      c = f.service.cover('c');
    await expect(f.service.cover('d')).rejects.toThrow('Ảnh đang bận');
    expect(f.download).toHaveBeenCalledTimes(3);
    releases.forEach((release) => release());
    await Promise.all([a, duplicate, b, c]);
  });
});
