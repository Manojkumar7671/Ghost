export function validateGraph(nodes, edges) {
    const adjList = new Map();
    nodes.forEach(n => adjList.set(n.id, []));

    for (const edge of edges) {
        if (!adjList.has(edge.source) || !adjList.has(edge.target)) {
            return {
                isValid: false,
                error: `Edge references non-existent node: ${edge.source} -> ${edge.target}`
            };
        }
        adjList.get(edge.source).push(edge.target);
    }

    const visited = new Set();
    const recStack = new Set();

    function dfs(nodeId) {
        if (recStack.has(nodeId)) return true;
        if (visited.has(nodeId)) return false;

        visited.add(nodeId);
        recStack.add(nodeId);

        const neighbors = adjList.get(nodeId) || [];
        for (const neighbor of neighbors) {
            if (dfs(neighbor)) return true;
        }

        recStack.delete(nodeId);
        return false;
    }

    for (const node of nodes) {
        if (!visited.has(node.id)) {
            if (dfs(node.id)) {
                return { isValid: false, error: 'Graph validation failed: Cycle detected in pipeline.' };
            }
        }
    }

    return { isValid: true };
}