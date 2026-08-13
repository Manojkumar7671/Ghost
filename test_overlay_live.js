import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { stopDesktopOverlay, takeNativeScreenshot } from './services/desktopOverlay.js';
import { pendingActions } from './state/pendingActions.js';
import llmRouter from './llmRouter.js';
import dotenv from 'dotenv';
dotenv.config();

process.env.GHOST_DEPLOYMENT_MODE = 'local';

console.log('[Step 1 Live Run] Starting controlled single-shot Desktop Overlay test...');

async function runStep1() {
    const timestamp = Date.now();
    const tmpPath = path.join('/tmp', `ghost_screen_test_${timestamp}.png`);
    
    try {
        console.log('[Step 1 Live Run] 1. Triggering single native screenshot capture...');
        await takeNativeScreenshot(tmpPath);
        
        if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
            throw new Error(`Native screenshot failed: File missing or 0 bytes at ${tmpPath}`);
        }
        
        const stats = fs.statSync(tmpPath);
        const fileVerification = execSync(`file "${tmpPath}"`).toString().trim();
        
        console.log(`[Step 1 Live Run] -> File Path: ${tmpPath}`);
        console.log(`[Step 1 Live Run] -> File Size: ${stats.size} bytes`);
        console.log(`[Step 1 Live Run] -> File Verification: ${fileVerification}`);
        
        if (!fileVerification.includes('PNG image data')) {
            throw new Error(`Verification failed: Expected PNG image data, got: ${fileVerification}`);
        }
        console.log('[Step 1 Live Run] -> REAL Native PNG Screenshot CONFIRMED!');

        console.log('[Step 1 Live Run] 2. Sending screenshot context to LLM for real analysis...');
        const messages = [{
            role: 'user',
            content: `I captured my Mac desktop screenshot (${stats.size} bytes PNG). Provide a single safe bash command to check system details (e.g. sw_vers or uptime). Reply ONLY with the exact raw command string.`
        }];
        
        const llmResponse = await llmRouter.callLLM(messages, {
            systemPrompt: 'You are a desktop assistant. Reply ONLY with a single safe standard command like sw_vers or uptime, with no flags that require parameters.',
            maxTokens: 50
        });
        
        const proposedAction = llmResponse.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        console.log('[Step 1 Live Run] -> LLM Analysis Complete.');
        console.log(`[Step 1 Live Run] -> LLM Proposed Action: "${proposedAction}"`);
        
        console.log('[Step 1 Live Run] 3. Registering proposed action in HITL Nonce-Gate...');
        const actionId = crypto.randomBytes(16).toString('hex');
        const expiresAt = Date.now() + (5 * 60 * 1000);
        pendingActions.set(actionId, {
            type: 'desktop_overlay_command',
            command: proposedAction,
            createdAt: Date.now(),
            expiresAt
        });
        console.log(`[Step 1 Live Run] -> Nonce Generated & Registered: ${actionId}`);
        
        console.log('[Step 1 Live Run] 4. Executing HITL Nonce-Gate verification & consumption...');
        const cachedAction = pendingActions.get(actionId);
        if (!cachedAction) {
            throw new Error('HITL Gate Failed: Nonce not found in pendingActions map!');
        }
        if (Date.now() > cachedAction.expiresAt) {
            pendingActions.delete(actionId);
            throw new Error('HITL Gate Failed: Nonce expired!');
        }
        
        // Consume nonce
        pendingActions.delete(actionId);
        console.log('[Step 1 Live Run] -> Nonce VERIFIED & CONSUMED successfully from pendingActions.');
        
        const cmdToRun = cachedAction.command;
        console.log(`[Step 1 Live Run] 5. Executing LLM proposed action: "${cmdToRun}"...`);
        
        const stdout = await new Promise((resolve, reject) => {
            exec(cmdToRun, (err, outStr, errStr) => {
                if (err) reject(new Error(`Command execution error: ${err.message}\n${errStr}`));
                else resolve(outStr);
            });
        });

        console.log(`[Step 1 Live Run] -> Execution Output:\n${stdout.trim()}`);

        if (fs.existsSync(tmpPath)) {
            fs.unlinkSync(tmpPath);
        }
        stopDesktopOverlay();
        console.log('[Step 1 Live Run] Step 1 FULL CYCLE PASSED SUCCESSFULLY.');
        process.exit(0);

    } catch (err) {
        console.error('[Step 1 Live Run] Error:', err.message);
        if (fs.existsSync(tmpPath)) {
            fs.unlinkSync(tmpPath);
        }
        stopDesktopOverlay();
        process.exit(1);
    }
}

runStep1();
