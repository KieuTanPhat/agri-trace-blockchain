import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
    @Get()
    check() {
        return {
            status: 'ok',
            service: 'agri-trace-blockchain-api',
            timestamp: new Date().toISOString(),
        };
    }
}
