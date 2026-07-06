import crypto from 'crypto';
import { pendingActions } from '../state/pendingActions.js';

function topologicalSort(nodes, edges) {
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    const adjList = new Map(nodes.map(n => [n.id, []]));

    for (const edge of edges) {
        adjList.get(edge.source).push(edge.target);
        inDegree.set(edge.target, inDegree.get(edge.target) + 1);
    }

    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
        if (deg === 0) queue.push(id);
    }

    const sortedNodeIds = [];
    while (queue.length > 0) {
        const current = queue.shift();
        sortedNodeIds.push(current);

        for (const neighbor of adjList.get(current)) {
            inDegree.set(neighbor, inDegree.get(neighbor) - 1);
            if (inDegree.get(neighbor) === 0) {
                queue.push(neighbor);
            }
        }
    }
    return sortedNodeIds;
}

export async function runPipeline({ nodes, edges, initialInputs = {} }, skillRegistry, state = null) {
    let sortedNodeIds, context, currentIndex;

    if (state) {
        sortedNodeIds = state.sortedNodeIds;
        context = state.context;
        currentIndex = state.currentIndex;
    } else {
        sortedNodeIds = topologicalSort(nodes, edges);
        context = { initial: initialInputs };
        currentIndex = 0;
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    while (currentIndex < sortedNodeIds.length) {
        const nodeId = sortedNodeIds[currentIndex];
        const node = nodeMap.get(nodeId);
        const skill = skillRegistry[node.skillName];

        if (!skill) throw new Error(`Skill '${node.skillName}' not found in registry.`);

        const nodeInputs = {};
        for (const edge of edges) {
            if (edge.target === nodeId) {
                const sourceOutput = context[edge.source] || {};
                if (edge.sourceKey && edge.targetKey) {
                    nodeInputs[edge.targetKey] = sourceOutput[edge.sourceKey];
                } else {
                    Object.assign(nodeInputs, sourceOutput);
                }
            }
        }

        if (Object.keys(nodeInputs).length === 0) {
            Object.assign(nodeInputs, context.initial);
        }

        const isResuming = state?.approved;

        if (skill.requiresApproval && !isResuming) {
            const nonce = crypto.randomBytes(16).toString('hex');

            pendingActions.set(nonce, {
                type: 'pipeline',
                pipelineData: { nodes, edges, initialInputs },
                state: {
                    sortedNodeIds,
                    context,
                    currentIndex,
                    nodeInputs
                },
                nodeId,
                skillName: node.skillName,
                expiresAt: Date.now() + 15 * 60 * 1000
            });

            return {
                status: 'awaiting_approval',
                nonce,
                nodeId,
                skillName: node.skillName,
                approvalLink: `/api/pipeline/execute-action/${nonce}`,
                message: `Execution paused. Node '${nodeId}' (${node.skillName}) requires human approval.`
            };
        }

        const inputsToUse = (isResuming && state.nodeInputs) ? state.nodeInputs : nodeInputs;
        context[nodeId] = await skill.execute(inputsToUse);

        currentIndex++;

        if (state) state.approved = false;
    }

    const finalNodeId = sortedNodeIds[sortedNodeIds.length - 1];

    return {
        status: 'completed',
        finalOutput: context[finalNodeId],
        context
    };
}