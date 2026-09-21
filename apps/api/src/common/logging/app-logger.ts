import { ConsoleLogger } from '@nestjs/common';

export function createApplicationLogger(): ConsoleLogger {
  const production = process.env.NODE_ENV === 'production';
  return new ConsoleLogger({
    json: production,
    colors: !production,
    compact: production,
    structuredParams: true,
    flattenParams: production,
  });
}
