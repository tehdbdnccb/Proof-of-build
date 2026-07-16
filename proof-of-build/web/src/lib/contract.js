import { JsonRpcProvider, Contract } from "ethers";

export const CONTRACT_ADDRESS = import.meta.env.VITE_PROOF_OF_BUILD_ADDRESS;
export const RPC_URL = import.meta.env.VITE_MONAD_RPC_URL;
export const EXPLORER_TX_BASE = import.meta.env.VITE_MONAD_EXPLORER_TX_BASE || "";

const ABI = [
  "function getHistory(address builder) view returns (tuple(bytes32 commitHash, uint64 timestamp, string label)[])",
  "function count(address builder) view returns (uint256)",
  "function firstAnchorTimestamp(address builder) view returns (uint64)",
  "event Anchored(address indexed builder, uint256 indexed index, bytes32 commitHash, uint64 timestamp, string label)",
];

let providerInstance = null;

function getProvider() {
  if (!providerInstance) {
    providerInstance = new JsonRpcProvider(RPC_URL);
  }
  return providerInstance;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lightweight rate limiter for RPC calls.
 *
 * Tracks the timestamp of the last request. Before issuing a new request,
 * if less than `minInterval` has elapsed since the last one, it sleeps the
 * difference. Requests are issued sequentially (never batched via
 * Promise.all) so that each queryFilter call goes out as its own JSON-RPC
 * request — some RPC providers (e.g. Ankr) reject batched requests outright.
 */
class RateLimiter {
  constructor(maxRequestsPerSecond) {
    this.minInterval = 1000 / maxRequestsPerSecond;
    this.lastRequestTime = 0;
  }

  async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minInterval) {
      await sleep(this.minInterval - elapsed);
    }
    this.lastRequestTime = Date.now();
  }
}

// Monad RPC nodes cap requests at 25/sec — stay comfortably under that.
const rateLimiter = new RateLimiter(25);

async function fetchChunk(contract, filter, fromBlock, toBlock) {
  await rateLimiter.throttle();
  return contract.queryFilter(filter, fromBlock, toBlock);
}

async function hasCode(provider, address, blockNumber) {
  await rateLimiter.throttle();
  const code = await provider.getCode(address, blockNumber);
  return code !== "0x" && code !== "0x0";
}

/**
 * Binary search for the block in which the contract was deployed.
 *
 * Some RPC providers (e.g. Ankr) run archive nodes with limited historical
 * range and respond with error -32603 when eth_getLogs is queried from block
 * 0 on a chain with a long history. Rather than always starting event
 * queries at genesis, we binary search for the earliest block at which the
 * contract has code deployed, and use that as our starting point instead.
 * This costs 1-2 extra getCode() calls up front but avoids ever touching
 * block ranges the archive node can't serve.
 */
async function findDeploymentBlock(provider, address, latestBlockNumber) {
  const deployed = await hasCode(provider, address, latestBlockNumber);
  if (!deployed) {
    // Contract doesn't exist (yet) at the latest block — nothing to search for.
    return latestBlockNumber;
  }

  let low = 0;
  let high = latestBlockNumber;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const codeAtMid = await hasCode(provider, address, mid);
    if (codeAtMid) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  return low;
}

export function getContract() {
  return new Contract(CONTRACT_ADDRESS, ABI, getProvider());
}

/**
 * Fetches a builder's full anchor history, sorted oldest -> newest.
 *
 * getHistory() alone can't give us a transaction hash to link to — the struct
 * only stores commitHash, timestamp, and label, none of which is the tx hash.
 * The Anchored event is emitted on every anchor() call, so we read the event
 * log instead, which gives us `event.transactionHash` for free alongside the
 * same data. This is what makes the "view on explorer" links actually work.
 *
 * Pagination: 50-block chunks, starting from contract deployment block.
 * We never query from block 0. Some RPC providers (e.g. Ankr) run archive
 * nodes with limited historical range, and eth_getLogs from genesis fails
 * with error -32603. We binary search for the contract's deployment block
 * and start pagination there (with a safety margin).
 */
export async function fetchHistory(address) {
  const contract = getContract();
  const provider = getProvider();
  const filter = contract.filters.Anchored(address);
  
  // Get the latest block number
  const latestBlockNumber = await provider.getBlockNumber();

  // Find the contract's deployment block so we never query history that
  // predates it (and that the archive node may not be able to serve).
  const deploymentBlock = await findDeploymentBlock(provider, CONTRACT_ADDRESS, latestBlockNumber);

  // Start slightly before the deployment block as a safety margin.
  const SAFETY_MARGIN = 1000;
  const startBlock = Math.max(0, deploymentBlock - SAFETY_MARGIN);
  
  // Fetch events in 50-block chunks to reduce archive/trie load on RPC node
  const CHUNK_SIZE = 50;
  const allEvents = [];

  for (let fromBlock = startBlock; fromBlock <= latestBlockNumber; fromBlock += CHUNK_SIZE) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockNumber);
    const events = await fetchChunk(contract, filter, fromBlock, toBlock);
    allEvents.push(...events);
  }

  return allEvents
    .map((event) => ({
      commitHash: event.args.commitHash,
      timestamp: Number(event.args.timestamp) * 1000, // ms for JS Date
      label: event.args.label,
      txHash: event.transactionHash,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

