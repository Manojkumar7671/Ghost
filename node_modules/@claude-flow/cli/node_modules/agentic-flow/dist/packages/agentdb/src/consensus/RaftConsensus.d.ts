/**
 * RaftConsensus - Fault-Tolerant Distributed Consensus
 *
 * Implements the Raft consensus algorithm for multi-agent coordination with:
 * - Leader election with automatic failover (<1s)
 * - Log replication with strong consistency
 * - Byzantine fault tolerance (BFT)
 * - Gossip protocols for large-scale coordination
 * - CRDT synchronization for eventually consistent state
 * - Distributed locks with deadlock detection
 * - Automatic sharding and partitioning
 *
 * References:
 * - Raft Paper: https://raft.github.io/raft.pdf
 * - Byzantine Fault Tolerance: https://pmg.csail.mit.edu/papers/osdi99.pdf
 */
import { EventEmitter } from 'events';
export type NodeState = 'follower' | 'candidate' | 'leader';
export type LogEntryType = 'command' | 'config' | 'noop';
export interface RaftConfig {
    nodeId: string;
    nodes: string[];
    electionTimeoutMin?: number;
    electionTimeoutMax?: number;
    heartbeatInterval?: number;
    maxEntriesPerRequest?: number;
    snapshotThreshold?: number;
    byzantineTolerance?: boolean;
    quorumSize?: number;
}
export interface LogEntry {
    term: number;
    index: number;
    type: LogEntryType;
    command?: any;
    timestamp: number;
    signature?: string;
}
export interface RaftState {
    currentTerm: number;
    votedFor: string | null;
    log: LogEntry[];
    commitIndex: number;
    lastApplied: number;
    state: NodeState;
    leaderId: string | null;
}
export interface PeerState {
    nodeId: string;
    nextIndex: number;
    matchIndex: number;
    lastHeartbeat: number;
    isHealthy: boolean;
}
export interface VoteRequest {
    term: number;
    candidateId: string;
    lastLogIndex: number;
    lastLogTerm: number;
    signature?: string;
}
export interface VoteResponse {
    term: number;
    voteGranted: boolean;
    signature?: string;
}
export interface AppendEntriesRequest {
    term: number;
    leaderId: string;
    prevLogIndex: number;
    prevLogTerm: number;
    entries: LogEntry[];
    leaderCommit: number;
    signature?: string;
}
export interface AppendEntriesResponse {
    term: number;
    success: boolean;
    matchIndex?: number;
    signature?: string;
}
export interface GossipMessage {
    type: 'state' | 'health' | 'metadata';
    nodeId: string;
    data: any;
    timestamp: number;
    signature?: string;
}
export interface CRDTState {
    type: 'counter' | 'set' | 'map' | 'register';
    value: any;
    vectorClock: Map<string, number>;
}
export interface DistributedLock {
    key: string;
    holder: string | null;
    acquiredAt: number;
    expiresAt: number;
    waiters: string[];
}
export declare class RaftConsensus extends EventEmitter {
    private config;
    private state;
    private peers;
    private electionTimer;
    private heartbeatTimer;
    private votesReceived;
    private commandQueue;
    private privateKey?;
    private publicKeys;
    private gossipInterval;
    private gossipState;
    private crdtStates;
    private locks;
    private lockCheckInterval;
    private metrics;
    constructor(config: RaftConfig);
    /**
     * Start the Raft node
     */
    start(): void;
    /**
     * Stop the Raft node
     */
    stop(): void;
    /**
     * Replicate a command to the cluster
     */
    replicate(command: any, timeout?: number): Promise<boolean>;
    /**
     * Handle vote request from candidate
     */
    handleVoteRequest(request: VoteRequest): VoteResponse;
    /**
     * Handle append entries request from leader
     */
    handleAppendEntries(request: AppendEntriesRequest): AppendEntriesResponse;
    /**
     * Handle vote response (exposed for testing/network layer)
     */
    handleVoteResponse(response: VoteResponse, peerId: string): void;
    /**
     * Handle append entries response (exposed for testing/network layer)
     */
    handleAppendEntriesResponse(response: AppendEntriesResponse, peerId: string): void;
    /**
     * Get current cluster status
     */
    getStatus(): {
        nodeId: string;
        state: NodeState;
        term: number;
        leaderId: string;
        logLength: number;
        commitIndex: number;
        lastApplied: number;
        peers: {
            nodeId: string;
            isHealthy: boolean;
            matchIndex: number;
        }[];
        metrics: {
            totalElections: number;
            totalLeaderChanges: number;
            totalCommittedEntries: number;
            lastElectionTime: number;
            avgElectionTimeMs: number;
            uptime: number;
        };
    };
    /**
     * Update CRDT state with eventual consistency
     */
    updateCRDT(key: string, operation: 'increment' | 'add' | 'set', value: any): void;
    /**
     * Get CRDT value
     */
    getCRDT(key: string): any;
    /**
     * Merge CRDT state from remote node
     */
    mergeCRDT(key: string, remoteState: CRDTState): void;
    /**
     * Acquire distributed lock
     */
    acquireLock(key: string, ttlMs?: number): Promise<boolean>;
    /**
     * Release distributed lock
     */
    releaseLock(key: string): Promise<void>;
    /**
     * Check for deadlocks
     */
    detectDeadlocks(): string[][];
    private becomeFollower;
    private becomeCandidate;
    private becomeLeader;
    private requestVotes;
    private processVoteResponse;
    private isLogUpToDate;
    private sendHeartbeat;
    private replicateToFollowers;
    private processAppendEntriesResponse;
    private updateCommitIndex;
    private applyCommittedEntries;
    private resetElectionTimer;
    private clearElectionTimer;
    private clearHeartbeatTimer;
    private setupBFT;
    private signData;
    private verifySignature;
    private startGossipProtocol;
    private stopGossipProtocol;
    private gossipToRandomPeers;
    private gossipCRDTUpdate;
    private startLockMonitoring;
    private stopLockMonitoring;
    private checkExpiredLocks;
}
//# sourceMappingURL=RaftConsensus.d.ts.map