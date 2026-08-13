const os = require('os');
const sysInfo = os.platform() === 'darwin' ? require('osx-cpu') : require('node-cpu');

const getSysMonData = async () => {
  try {
    const cpuData = await sysInfo();
    const memoryData = os.freemem() / (1024 * 1024 * 1024);
    const memoryPercent = os.freemem() / os.totalmem();

    return {
      cpu: cpuData,
      memory: {
        free: memoryData,
        percent: memoryPercent * 100,
      },
    };
  } catch (error) {
    console.error('Error getting system monitor data:', error);
    return null;
  }
};

const main = async () => {
  const sysMonData = await getSysMonData();
  if (sysMonData) {
    console.log('CPU usage:', sysMonData.cpu.usage);
    console.log('Memory usage:', sysMonData.memory);
  }
};

main();