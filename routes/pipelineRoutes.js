import express from 'express';
import { validateGraph } from '../engine/validateGraph.js';
import { runPipeline } from '../engine/runPipeline.js';
import { pendingActions } from '../state/pendingActions.js';
import { buildSkillRegistry } from '../skills/BaseSkill.js';

export default function createPipelineRoutes(n8nMcpClient) {
    const router = express.Router();
    const skillRegistry = buildSkillRegistry(n8nMcpClient);

    router.post('/run', async (req, res) => {
        try {
            const { nodes = [], edges = [], initialInputs = {} } = req.body;

            const validation = validateGraph(nodes, edges);
            if (!validation.isValid) {
                return res.status(400).json({ status: 'error', error: validation.error });
            }

            const result = await runPipeline({ nodes, edges, initialInputs }, skillRegistry);
            res.json(result);
        } catch (error) {
            console.error('Pipeline Execution Error:', error);
            res.status(500).json({ status: 'error', error: error.message });
        }
    });

    router.post('/execute-action/:nonce', async (req, res) => {
        try {
            const { nonce } = req.params;
            const pending = pendingActions.get(nonce);

            if (!pending) {
                return res.status(404).json({ status: 'error', error: 'Invalid or already consumed nonce.' });
            }

            if (pending.expiresAt < Date.now()) {
                pendingActions.delete(nonce);
                return res.status(400).json({ status: 'error', error: 'Approval link has expired.' });
            }

            pendingActions.delete(nonce);

            if (pending.type === 'pipeline') {
                pending.state.approved = true;

                if (req.body.overrideInputs) {
                    pending.state.nodeInputs = {
                        ...pending.state.nodeInputs,
                        ...req.body.overrideInputs
                    };
                }

                const result = await runPipeline(pending.pipelineData, skillRegistry, pending.state);
                return res.json(result);
            }

            return res.status(400).json({ status: 'error', error: 'Unknown pending action type.' });

        } catch (error) {
            console.error('Pipeline Resume Error:', error);
            res.status(500).json({ status: 'error', error: error.message });
        }
    });

    return router;
}