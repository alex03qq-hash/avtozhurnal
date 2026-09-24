/**
 * Сетевые адреса приложения.
 *
 * Нужны, чтобы открыть журнал с телефона: сервер слушает все интерфейсы,
 * а телефон обращается по адресу компьютера в домашней сети.
 */

import os from 'node:os';

export interface ServerInfo {
  port: number;
  host: string;
  protocol: 'http' | 'https';
  /** Адрес для этого компьютера. */
  localUrl: string;
  /** Адреса в локальной сети — по ним заходит телефон. */
  lanUrls: string[];
}

function isPrivateIpv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Все адреса компьютера в локальной сети (Wi-Fi, Ethernet), приватные — первыми. */
export function listLanAddresses(): string[] {
  const found: string[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      found.push(address.address);
    }
  }
  return found.sort((a, b) => Number(isPrivateIpv4(b)) - Number(isPrivateIpv4(a)));
}

export function buildServerInfo(port: number, host: string, protocol: 'http' | 'https'): ServerInfo {
  const lanUrls = listLanAddresses().map((address) => `${protocol}://${address}:${port}`);
  return { port, host, protocol, localUrl: `${protocol}://localhost:${port}`, lanUrls };
}
