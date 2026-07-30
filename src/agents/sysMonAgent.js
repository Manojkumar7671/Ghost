const os = require('os');
const { exec } = require('child_process');

function getCpuLoad() {
  const cpus = os.cpus();
  let user = 0, sys = 0, idle = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
  }
  const total = user + sys + idle;
  return {
    userPct: ((user / total) * 100).toFixed(1),
    sysPct: ((sys / total) * 100).toFixed(1),
    idlePct: ((idle / total) * 100).toFixed(1),
    cores: cpus.length
  };
}

async function getSystemMetrics() {
  const totalMemMb = (os.totalmem() / (1024 * 1024)).toFixed(0);
  const freeMemMb = (os.freemem() / (1024 * 1024)).toFixed(0);
  const usedMemMb = totalMemMb - freeMemMb;
  const memPct = ((usedMemMb / totalMemMb) * 100).toFixed(1);
  const cpu = getCpuLoad();
  const uptimeHours = (os.uptime() / 3600).toFixed(1);

  let diskInfo = 'N/A';
  try {
    diskInfo = await new Promise((resolve) => {
      exec('df -h /', (err, stdout) => {
        if (err) return resolve('N/A');
        const lines = stdout.trim().split('\n');
        resolve(lines[1] ? lines[1].replace(/\s+/g, ' ') : 'N/A');
      });
    });
  } catch (e) {}

  let pm2Info = 'N/A';
  try {
    pm2Info = await new Promise((resolve) => {
      exec('pm2 jlist', (err, stdout) => {
        if (err) return resolve('PM2 offline');
        try {
          const list = JSON.parse(stdout);
          const summary = list.map(p => `${p.name} (PID: ${p.pid}, Status: ${p.pm2_env.status}, Mem: ${(p.monit.memory / 1024 / 1024).toFixed(1)}MB, CPU: ${p.monit.cpu}%)`);
          resolve(summary.join(' | '));
        } catch {
          resolve('PM2 status parse error');
        }
      });
    });
  } catch (e) {}

  return {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptimeHours,
    cpu,
    memory: { totalMemMb, usedMemMb, freeMemMb, memPct },
    diskInfo,
    pm2Info
  };
}

async function run(task = 'system health check') {
  const metrics = await getSystemMetrics();
  const summary = `🖥️ **Ghost System Diagnostics & Performance Monitor**
- **Platform**: ${metrics.platform} (${metrics.arch}) on ${metrics.hostname}
- **Uptime**: ${metrics.uptimeHours} hours
- **CPU**: ${metrics.cpu.userPct}% User, ${metrics.cpu.sysPct}% System (${metrics.cpu.cores} Cores)
- **Memory**: ${metrics.memory.usedMemMb}MB / ${metrics.memory.totalMemMb}MB used (${metrics.memory.memPct}%)
- **Primary Disk (df -h /)**: ${metrics.diskInfo}
- **PM2 Managed Processes**: ${metrics.pm2Info}`;

  return {
    success: true,
    metrics,
    text: summary
  };
}

module.exports = { run, getSystemMetrics };
