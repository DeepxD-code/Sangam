'use strict';

const { spawn, execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const TUNNEL_PID_FILE = path.join(__dirname, '..', '.tunnel.pid');
const CONFIG_FILE = path.join(__dirname, '..', '..', '.network.env');

/**
 * SANGAM Hybrid Network Bootstrap (Day 72-74)
 *
 * Automates the TCP 5432 firewall workaround for air-gapped / multi-subnet
 * Indian Army deployments where the app container cannot reach the Postgres
 * host directly.
 *
 * Strategy (tried in order):
 *   1. DIRECT — test TCP connectivity to $REMOTE_DB_HOST:5432
 *   2. SSH TUNNEL — if direct fails, open a local -> remote SSH tunnel
 *   3. SIDECAR — if neither works, emit instructions for the operator
 */

function log(...args) { console.log('[network]', ...args); }
function fatal(...args) { console.error('[network] FATAL:', ...args); process.exit(1); }

function env(key, fallback) {
  return process.env[key] || fallback;
}

async function tcpConnect(host, port, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(timeoutMs);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => { s.destroy(); resolve(false); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.connect(port, host);
  });
}

function readPid() {
  try { return parseInt(fs.readFileSync(TUNNEL_PID_FILE, 'utf8').trim(), 10); }
  catch { return null; }
}

function writePid(pid) { fs.writeFileSync(TUNNEL_PID_FILE, String(pid)); }

function cleanupTunnel() {
  const pid = readPid();
  if (pid) {
    try { process.kill(pid, 'SIGTERM'); log('Stopped existing tunnel (pid', pid + ')'); }
    catch { /* already dead */ }
    try { fs.unlinkSync(TUNNEL_PID_FILE); } catch {}
  }
}

function spawnTunnel(sshHost, sshUser, remoteDbHost, localPort) {
  const args = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'ExitOnForwardFailure=yes',
    '-N', '-L', `${localPort}:${remoteDbHost}:5432`,
    `${sshUser}@${sshHost}`
  ];

  log('Spawning SSH tunnel:', 'ssh', args.join(' '));
  const child = spawn('ssh', args, { stdio: 'ignore', detached: true });
  child.unref();
  writePid(child.pid);

  child.on('exit', (code) => {
    if (code !== 0) log('SSH tunnel exited with code', code);
  });

  return child;
}

async function verifyDirect(host, port) {
  log(`Checking direct TCP connectivity to ${host}:${port}...`);
  const ok = await tcpConnect(host, port);
  if (ok) log('Direct connection OK');
  else     log('Direct connection FAILED');
  return ok;
}

async function verifyTunnel(localPort) {
  log(`Verifying SSH tunnel on 127.0.0.1:${localPort}...`);
  const ok = await tcpConnect('127.0.0.1', localPort);
  if (ok) log('Tunnel connection OK');
  else    log('Tunnel connection FAILED');
  return ok;
}

async function run() {
  log('SANGAM Hybrid Network Bootstrap');
  log('─'.repeat(50));

  const REMOTE_DB_HOST = env('REMOTE_DB_HOST');
  const SSH_BASTION    = env('SSH_BASTION_HOST');
  const SSH_USER       = env('SSH_USER', 'sangam');
  const LOCAL_TUNNEL_PORT = parseInt(env('LOCAL_TUNNEL_PORT', '15432'), 10);

  if (!REMOTE_DB_HOST && !SSH_BASTION) {
    log('No REMOTE_DB_HOST or SSH_BASTION_HOST set — assuming local Docker bridge.');
    log('If your DB is behind a firewall, set these env vars and re-run.');
    log('  REMOTE_DB_HOST=10.x.x.x    # Postgres IP');
    log('  SSH_BASTION_HOST=jump.example.com  # SSH bastion (optional)');
    log('  SSH_USER=sangam              # SSH user on bastion');
    log('  LOCAL_TUNNEL_PORT=15432      # Local tunnel endpoint');
    return;
  }

  // Step 1: Try direct connection
  const directHost = REMOTE_DB_HOST || 'db';
  let tunnelActive = false;

  if (await verifyDirect(directHost, 5432)) {
    log('Using direct connection.');
    cleanupTunnel();
    process.env.DATABASE_URL = process.env.DATABASE_URL ||
      `postgresql://${env('POSTGRES_USER', 'sangam_user')}:${env('POSTGRES_PASSWORD', '')}@${directHost}:5432/${env('POSTGRES_DB', 'sangam')}`;
    return;
  }

  // Step 2: Try SSH tunnel via bastion
  if (SSH_BASTION) {
    log('Direct connection failed. Attempting SSH tunnel via', SSH_BASTION);
    cleanupTunnel();

    // Try to reach the bastion itself first
    if (!await tcpConnect(SSH_BASTION, 22)) {
      log('Cannot reach bastion host', SSH_BASTION + ':22 — is it on the network?');
      fatal('No network path to database or bastion. See docs/air-gapped-deployment.md for manual steps.');
    }

    spawnTunnel(SSH_BASTION, SSH_USER, directHost, LOCAL_TUNNEL_PORT);

    // Wait for tunnel to establish
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await verifyTunnel(LOCAL_TUNNEL_PORT)) {
        tunnelActive = true;
        break;
      }
    }

    if (!tunnelActive) {
      fatal('SSH tunnel failed to establish. Check bastion credentials and network.');
    }

    log('Tunnel active on 127.0.0.1:' + LOCAL_TUNNEL_PORT);
    process.env.DATABASE_URL =
      `postgresql://${env('POSTGRES_USER', 'sangam_user')}:${env('POSTGRES_PASSWORD', '')}@127.0.0.1:${LOCAL_TUNNEL_PORT}/${env('POSTGRES_DB', 'sangam')}`;
    log('DATABASE_URL set to tunnel endpoint.');
    return;
  }

  // Step 3: Neither direct nor tunnel available
  fatal(`Cannot reach ${directHost}:5432 and no SSH_BASTION_HOST configured.`);
}

run().catch(err => { console.error(err); process.exit(1); });
