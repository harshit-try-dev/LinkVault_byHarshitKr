import dns from 'node:dns'
import { configureDns } from './dns-config.js'

configureDns({ setServers: dns.setServers.bind(dns) })
