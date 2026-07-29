import fs from 'fs';
import path from 'path';

export const businessSkill = {
    name: 'business_action',
    inputSchema: { 
        actionType: 'string', // 'routine', 'financial_unclear', 'alert'
        description: 'string', 
        details: 'object' 
    },
    outputSchema: { 
        status: 'string', 
        message: 'string' 
    },
    requiresApproval: false, // The 'financial_unclear' state handles its own queueing logic here or via return state
    execute: async (inputs) => {
        const { actionType, description, details } = inputs;
        const logFile = path.join(process.cwd(), 'logs', 'business_actions.log');
        
        // Ensure logs directory exists
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const timestamp = new Date().toISOString();
        let logEntry = `[${timestamp}] TYPE: ${actionType.toUpperCase()} | DESC: ${description} | DETAILS: ${JSON.stringify(details || {})}\n`;
        
        let result = {};

        switch (actionType) {
            case 'routine':
                logEntry = `[ROUTINE_EXECUTED] ` + logEntry;
                result = { status: 'success', message: `Routine action executed: ${description}` };
                break;
            case 'financial_unclear':
                logEntry = `[QUEUED_FOR_APPROVAL] ` + logEntry;
                result = { status: 'pending_approval', message: `Action queued for owner approval: ${description}` };
                break;
            case 'alert':
                logEntry = `[OWNER_ALERTED] ` + logEntry;
                // Future: Send Telegram/Slack message here
                result = { status: 'alert_sent', message: `Owner alerted: ${description}` };
                break;
            default:
                logEntry = `[UNKNOWN_ACTION] ` + logEntry;
                result = { status: 'error', message: `Unknown action type: ${actionType}` };
        }

        fs.appendFileSync(logFile, logEntry);
        console.log(`[Skill: business_action] ${result.message}`);
        
        return result;
    }
};
