import dns from 'node:dns'

export const WINDOWS_DNS_SERVERS = Object.freeze(['1.1.1.1', '8.8.8.8'])

export function configureDns({ platform = process.platform, setServers = dns.setServers.bind(dns) } = {}) {
  if (platform === 'win32') {
    setServers([...WINDOWS_DNS_SERVERS])
  }
}
