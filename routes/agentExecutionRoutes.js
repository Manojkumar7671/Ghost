import express from 'express';

export function createAgentExecutionRouter({ store, authenticateOwner }) {
  const router = express.Router();
  router.use(express.json());

  // Middleware to check DB
  router.use((req, res, next) => {
    if (!store || !store.pool) {
      return res.status(503).json({ error: "Storage unavailable" });
    }
    next();
  });

  const handleError = (e, res) => {
    const msg = e.message || '';
    if (msg.includes('unavailable')) {
      return res.status(503).json({ error: "Storage unavailable" });
    }
    if (msg.includes('not found') || msg.includes('unauthorized') || msg.includes('belong')) {
      return res.status(404).json({ error: "Resource not found" });
    }
    if (msg.includes('Invalid, expired, or cancelled lease') || msg.includes('Worker cannot transition') || msg.includes('Invalid state transition')) {
      return res.status(409).json({ error: "Conflict: lease state invalid" });
    }
    return res.status(400).json({ error: "Bad request" });
  };

  // --- OWNER MIDDLEWARE ---
  const requireOwner = async (req, res, next) => {
    try {
      const principal = await authenticateOwner(req);
      if (!principal || !principal.isOwner || !principal.ownerId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      req.ownerId = principal.ownerId;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  };

  // --- WORKER MIDDLEWARE ---
  const requireWorker = async (req, res, next) => {
    const deviceId = req.headers['x-ghost-device-id'];
    const authHeader = req.headers['authorization'];
    if (!deviceId || !authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Missing worker credentials" });
    }
    const token = authHeader.substring(7);
    try {
      const isValid = await store.verifyDeviceToken(deviceId, token);
      if (!isValid) return res.status(401).json({ error: "Invalid worker credentials" });
      req.deviceId = deviceId;
      req.deviceToken = token; // verified
      next();
    } catch (e) {
      if (e.message && e.message.includes("unavailable")) return res.status(503).json({ error: "Storage unavailable" });
      res.status(401).json({ error: "Invalid worker credentials" });
    }
  };

  const requireLeaseToken = (req, res, next) => {
    const leaseToken = req.headers['x-ghost-lease-token'];
    if (!leaseToken) {
      return res.status(401).json({ error: "Missing lease token" });
    }
    req.leaseToken = leaseToken;
    next();
  };

  // --- OWNER ENDPOINTS ---
  router.post('/repo-profiles', requireOwner, async (req, res) => {
    try {
      const profile = await store.createRepoProfile({ ...req.body, owner_id: req.ownerId });
      res.json({ id: profile.id });
    } catch (e) { handleError(e, res); }
  });

  router.post('/tasks', requireOwner, async (req, res) => {
    try {
      const { goal, repoProfileId } = req.body;
      const taskId = await store.createTask(req.ownerId, goal, repoProfileId);
      res.json({ taskId });
    } catch (e) { handleError(e, res); }
  });

  router.get('/tasks/:taskId', requireOwner, async (req, res) => {
    try {
      const task = await store.getTask(req.params.taskId);
      if (!task || task.owner_id !== req.ownerId) return res.status(404).json({ error: "Resource not found" });
      res.json({
        id: task.id,
        goal: task.goal,
        status: task.status,
        repo_profile_id: task.repo_profile_id,
        plan_hash: task.plan_hash,
        deadline_at: task.deadline_at,
        created_at: task.created_at
      }); // Filtered representation
    } catch (e) { handleError(e, res); }
  });

  router.put('/tasks/:taskId/plan', requireOwner, async (req, res) => {
    try {
      await store.updateTaskPlan(req.params.taskId, req.ownerId, req.body);
      res.json({ success: true });
    } catch (e) { handleError(e, res); }
  });

  router.post('/tasks/:taskId/request-approval', requireOwner, async (req, res) => {
    try {
      await store.requestApproval(req.params.taskId, req.ownerId);
      res.json({ success: true });
    } catch (e) { handleError(e, res); }
  });

  router.post('/tasks/:taskId/approve', requireOwner, async (req, res) => {
    try {
      const { expectedPlanHash, route } = req.body;
      await store.approveTask(req.params.taskId, req.ownerId, expectedPlanHash, route);
      res.json({ success: true });
    } catch (e) { handleError(e, res); }
  });

  router.post('/tasks/:taskId/cancel', requireOwner, async (req, res) => {
    try {
      await store.cancelTask(req.params.taskId, req.ownerId);
      res.json({ success: true });
    } catch (e) { handleError(e, res); }
  });

  router.get('/tasks/:taskId/events', requireOwner, async (req, res) => {
    try {
      const task = await store.getTask(req.params.taskId);
      if (!task || task.owner_id !== req.ownerId) return res.status(404).json({ error: "Resource not found" });
      const eventsRes = await store.pool.query('SELECT actor_kind, event_name, data_json, created_at FROM ghost_task_events WHERE task_id = $1 ORDER BY id ASC', [req.params.taskId]);
      res.json(eventsRes.rows);
    } catch (e) { handleError(e, res); }
  });

  router.get('/tasks/:taskId/artifacts', requireOwner, async (req, res) => {
    try {
      const task = await store.getTask(req.params.taskId);
      if (!task || task.owner_id !== req.ownerId) return res.status(404).json({ error: "Resource not found" });
      const artRes = await store.pool.query('SELECT id, diff_hash, exit_code, output_redacted, final_status, created_at FROM ghost_task_artifacts WHERE task_id = $1 ORDER BY created_at ASC', [req.params.taskId]);
      res.json(artRes.rows);
    } catch (e) { handleError(e, res); }
  });

  router.post('/devices', requireOwner, async (req, res) => {
    try {
      const { publicLabel } = req.body;
      const device = await store.registerDevice(req.ownerId, publicLabel);
      res.json({ deviceId: device.deviceId, token: device.token });
    } catch (e) { handleError(e, res); }
  });

  // --- WORKER ENDPOINTS ---
  router.post('/worker/heartbeat', requireWorker, async (req, res) => {
    try {
      const { protocolVersion } = req.body;
      await store.heartbeat(req.deviceId, protocolVersion);
      res.json({ success: true });
    } catch (e) { handleError(e, res); }
  });

  router.post('/worker/claim', requireWorker, async (req, res) => {
    try {
      const claim = await store.claimApprovedTask(req.deviceId, 'mac');
      if (!claim) return res.json({ claim: null });
      res.json({ 
        claim: {
          taskId: claim.taskId,
          leaseToken: claim.leaseToken,
          plan: claim.plan,
          planHash: claim.planHash,
          cancellationVersion: claim.cancellationVersion
        } 
      });
    } catch (e) { handleError(e, res); }
  });

  router.post('/worker/tasks/:taskId/state', requireWorker, requireLeaseToken, async (req, res) => {
    try {
      const { state, eventData } = req.body;
      await store.updateTaskStateByWorker(req.params.taskId, req.deviceId, req.leaseToken, state, eventData);
      res.json({ success: true });
    } catch (e) { handleError(e, res); }
  });

  router.post('/worker/tasks/:taskId/artifacts', requireWorker, requireLeaseToken, async (req, res) => {
    try {
      const artifactId = await store.saveArtifact(req.params.taskId, req.deviceId, req.leaseToken, req.body);
      res.json({ success: true, artifactId });
    } catch (e) { handleError(e, res); }
  });

  // Fallback error handler
  router.use((err, req, res, next) => {
    res.status(500).json({ error: "Internal error" });
  });

  return router;
}
