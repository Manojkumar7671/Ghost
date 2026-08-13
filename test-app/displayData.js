const sysMonAgent = require('./sysMonAgent');

function displayData() {
  sysMonAgent.getSystemUsage((err, data) => {
    if (err) {
      console.error('Error retrieving system usage:', err);
    } else {
      console.log('Current CPU usage:', data.cpuUsage);
      console.log('Current memory usage:', data.memoryUsage);
    }
  });
}

displayData();