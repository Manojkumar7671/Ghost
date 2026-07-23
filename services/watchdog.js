import { Worker, isMainThread, parentPort } from 'worker_threads';

let watchdogStarted = false;

export function startWatchdog() {
    if (!isMainThread) return;
    if (watchdogStarted) return;
    watchdogStarted = true;

    try {
        console.log(`[Watchdog] [${new Date().toISOString()}] Spawning background watchdog worker thread...`);
        const worker = new Worker(new URL(import.meta.url));
        let lastHeartbeat = Date.now();

        worker.on('message', (msg) => {
            if (msg === 'ping') {
                lastHeartbeat = Date.now();
                worker.postMessage('pong');
            }
        });

        worker.on('error', (err) => {
            console.error(`[Watchdog] [${new Date().toISOString()}] Watchdog worker error:`, err.message);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.warn(`[Watchdog] [${new Date().toISOString()}] Watchdog worker exited with code ${code}`);
            }
        });
    } catch (err) {
        console.error(`[Watchdog] [${new Date().toISOString()}] Failed to start watchdog worker:`, err.message);
    }
}

// Worker thread execution path
if (!isMainThread) {
    let mainLastResponse = Date.now();

    parentPort.on('message', (msg) => {
        if (msg === 'pong') {
            mainLastResponse = Date.now();
        }
    });

    // Send a ping every 2 seconds to check event loop availability
    setInterval(() => {
        parentPort.postMessage('ping');
    }, 2000);

    // Monitor response health every 5 seconds
    setInterval(() => {
        const delay = Date.now() - mainLastResponse;
        if (delay > 15000) {
            console.error(`[Watchdog] [${new Date().toISOString()}] CRITICAL: Event loop blocked for ${delay}ms! Runaway CPU spin detected. Terminating process...`);
            process.exit(1);
        }
    }, 5000);
}
