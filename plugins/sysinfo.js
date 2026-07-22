import os from 'os';

export default {
  name: 'sysinfo',
  trigger: 'current sysinfo',
  async run(ghost, input) {
    const totalMemGB = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
    const freeMemGB = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
    const uptimeHrs = (os.uptime() / 3600).toFixed(2);

    return `[Jarvis Plugin - SysInfo]
Platform: ${os.platform()} (${os.arch()})
OS Release: ${os.release()}
Memory: ${freeMemGB} GB free of ${totalMemGB} GB total
Uptime: ${uptimeHrs} hours
User Context: ${JSON.stringify(ghost.userContext)}`;
  }
};
