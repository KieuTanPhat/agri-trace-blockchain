#!/usr/bin/env python3
"""Pass Fabric TLS bytes between a reviewed private interface and loopback.

This process never terminates TLS or reads credentials. Install its configuration
as an administrator; expose only these ports through the host's private VPN.
"""
import argparse
import asyncio
import ipaddress
import json
from pathlib import Path


def validate(value):
    if value.get('protocol') != 'agritrace-private-relay/1':
        raise ValueError('Unsupported private relay protocol')
    address = ipaddress.ip_address(value.get('listen', ''))
    if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified or address.is_multicast:
        raise ValueError('Relay must bind one reviewed private IPv4 interface')
    routes = value.get('routes')
    if not isinstance(routes, dict) or not 1 <= len(routes) <= 3:
        raise ValueError('One to three reviewed Fabric routes are required')
    allowed = {7050, 7051, 11051}
    for source, target in routes.items():
        if not isinstance(source, str) or not source.isdecimal() or int(source) not in allowed:
            raise ValueError('Unreviewed Fabric relay source port')
        if type(target) is not int or not 1024 < target <= 65535:
            raise ValueError('Invalid loopback target port')
    return value


async def serve(spec):
    active = 0

    async def connection(reader, writer, target):
        nonlocal active
        if active >= 128:
            writer.close()
            return
        active += 1
        upstream = None
        tasks = []
        try:
            incoming, upstream = await asyncio.wait_for(asyncio.open_connection('127.0.0.1', target), 10)

            async def forward(source, destination):
                while block := await source.read(65536):
                    destination.write(block)
                    await destination.drain()
                if destination.can_write_eof():
                    destination.write_eof()

            tasks = [asyncio.create_task(forward(reader, upstream)), asyncio.create_task(forward(incoming, writer))]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
            for task in done:
                task.result()
            await asyncio.gather(*pending)
        except (OSError, TimeoutError, ConnectionError):
            pass
        finally:
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            for stream in (writer, upstream):
                if stream:
                    stream.close()
            active -= 1

    servers = []
    for source, target in spec['routes'].items():
        async def handler(reader, writer, port=target):
            await connection(reader, writer, port)
        servers.append(await asyncio.start_server(handler, spec['listen'], int(source), limit=65536))
    await asyncio.gather(*(server.serve_forever() for server in servers))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    asyncio.run(serve(validate(json.loads(Path(args.config).read_text()))))
