const fs = require('fs');
const path = require('path');

const GHOST_DIR = path.resolve(__dirname, '..');
const AGENTS_DIR = path.join(GHOST_DIR, 'src/agents');
const SKILLS_DIR = path.join(GHOST_DIR, 'skills');
const PENDING_AGENTS = new Map();

function sanitizeAgentName(rawName) {
    let clean = rawName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean.endsWith('agent')) clean += 'Agent';
    return clean;
}

/**
 * Scaffolds a new agent file, creates SKILL.md, and registers pending approval.
 */
async function createAgent({ rawName, description, instructions, tags = [], triggers = [], isAdmin = false }) {
    if (!isAdmin) {
        return {
            success: false,
            error: '[Security Gate]: Agent creation is restricted to admin (Master Manoj).'
        };
    }

    const agentName = sanitizeAgentName(rawName);
    const agentFilePath = path.join(AGENTS_DIR, `${agentName}.js`);
    const skillFolderPath = path.join(SKILLS_DIR, agentName);
    const skillMdPath = path.join(skillFolderPath, 'SKILL.md');

    // 1. Generate JS Agent Code
    const agentCode = `const { chat } = require('../tools/llm');

/**
 * Self-Created Ghost Agent: ${agentName}
 * Description: ${description}
 */
async function run(task) {
    const systemPrompt = \`You are ${agentName}, a specialized AI agent in the Ghost ecosystem.
Description: ${description}
Specialized Instructions: ${instructions}
Always respond clearly and concisely in Ghost's tone.\`;

    try {
        const response = await chat([
            { role: 'user', content: \`\${systemPrompt}\\n\\nTask: \${task}\` }
        ], { temperature: 0.7 });
        return response;
    } catch (err) {
        return \`[${agentName} Error]: \${err.message}\`;
    }
}

module.exports = { run };
`;

    // 2. Generate SKILL.md Content
    const skillMdContent = `---
name: ${agentName}
description: "${description}"
tags: [${tags.map(t => `'${t}'`).join(', ')}]
triggers: [${triggers.map(t => `'${t}'`).join(', ')}]
---

# ${agentName} Skill Specification

## Overview
${description}

## Instructions
${instructions}
`;

    // Write files to disk
    if (!fs.existsSync(skillFolderPath)) {
        fs.mkdirSync(skillFolderPath, { recursive: true });
    }

    fs.writeFileSync(agentFilePath, agentCode, 'utf8');
    fs.writeFileSync(skillMdPath, skillMdContent, 'utf8');

    // Register pending approval
    PENDING_AGENTS.set(agentName, {
        agentName,
        agentFilePath,
        skillMdPath,
        description,
        status: 'pending_approval',
        createdAt: new Date().toISOString()
    });

    // Reset Tool Router Cache
    try {
        const toolRouter = await import('../services/toolRouter.js');
        if (toolRouter.resetCatalogCache) toolRouter.resetCatalogCache();
    } catch (e) {}

    console.log(`[Agent Creator] Scaffolding complete for ${agentName}. Status: PENDING_APPROVAL.`);

    return {
        success: true,
        agentName,
        agentFilePath,
        skillMdPath,
        status: 'pending_approval',
        text: `[Self-Serve Agent Created ➔ Admin Review Required]
- **Agent Name**: ${agentName}
- **Agent Code**: file://${agentFilePath}
- **Skill File**: file://${skillMdPath}
- **Description**: ${description}
- **Status**: ⏳ PENDING_APPROVAL

*Security Requirement*: New self-created agents require explicit admin review before auto-execution.
Please reply **"approve agent ${agentName}"** to approve and activate this agent.`
    };
}

/**
 * Approves and activates a pending agent.
 */
async function approveAgent(rawName, isAdmin = false) {
    if (!isAdmin) {
        return { success: false, error: '[Security Gate]: Approval restricted to admin.' };
    }

    const agentName = sanitizeAgentName(rawName);
    const pending = PENDING_AGENTS.get(agentName);
    const agentFilePath = path.join(AGENTS_DIR, `${agentName}.js`);

    if (!fs.existsSync(agentFilePath)) {
        return { success: false, error: `Agent "${agentName}" not found at ${agentFilePath}.` };
    }

    if (pending) {
        pending.status = 'active';
    }

    console.log(`[Agent Creator] Agent ${agentName} approved by admin.`);
    return {
        success: true,
        agentName,
        status: 'active',
        text: `[Ghost Agent Manager]: Agent "${agentName}" has been APPROVED and is now ACTIVE. You can now execute tasks using ${agentName}.`
    };
}

module.exports = {
    createAgent,
    approveAgent,
    sanitizeAgentName,
    PENDING_AGENTS
};
