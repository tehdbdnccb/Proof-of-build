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

/**
 * Simple token-spacing rate limiter.
 *
 * Pagination fires many queryFilter() calls with Promise.all(), which bursts
 * requests at the RPC node all at once. Public RPC endpoints cap requests
 * per second (e.g. ~25 req/s), so a burst of dozens of parallel calls can
 * trip rate limiting and fail the whole page load.
 *
 * schedule() queues callers and releases them at a fixed interval so calls
 * are spaced out evenly across time instead of firing simultaneously, while
 * still resolving as soon as the RPC allows the next slot — no need to await
 * one full round-trip before starting the next request.
 */
class RateLimiter {
  constructor(maxRequestsPerSecond) {
    this.minIntervalMs = 1000 / maxRequestsPerSecond;
    this.lastScheduledAt = 0;
    this.queue = Promise.resolve();
  }

  schedule(fn) {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    this.queue = this.queue.then(() => {
      const now = Date.now();
      const wait = Math.max(0, this.lastScheduledAt + this.minIntervalMs - now);
      this.lastScheduledAt = Math.max(now, this.lastScheduledAt + this.minIntervalMs);
      return new Promise((resolve) => setTimeout(resolve, wait)).then(release);
    });

    return gate.then(fn);
  }
}

// Ankr's public Monad testnet RPC allows 300 requests / 10s (30 req/s).
// We cap slightly below that to leave headroom for other concurrent traffic.
const rpcRateLimiter = new RateLimiter(25);

let providerInstance = null;

function getProvider() {
  if (!providerInstance) {
    providerInstance = new JsonRpcProvider(RPC_URL);
  }
  return providerInstance;
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
 * Note: queryFilter with a 0-to-latest range can exceed RPC node limits (e.g. 100-block range).
 * We paginate in chunks and fetch in parallel for speed.
 */
export async function fetchHistory(address) {
  const contract = getContract();
  const provider = getProvider();
  const filter = contract.filters.Anchored(address);
  
  // Get the latest block number
  const latestBlockNumber = await provider.getBlockNumber();
  
  // Fetch events in 100-block chunks to respect RPC node limits
  // Use Promise.all to fetch chunks in parallel for speed
  const CHUNK_SIZE = 100;
  const chunks = [];
  
  for (let fromBlock = 0; fromBlock <= latestBlockNumber; fromBlock += CHUNK_SIZE) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockNumber);
    chunks.push(
      rpcRateLimiter.schedule(() => contract.queryFilter(filter, fromBlock, toBlock))
    );
  }
  
  // Fetch all chunks in parallel
  const results = await Promise.all(chunks);
  const allEvents = results.flat();

  return allEvents
    .map((event) => ({
      commitHash: event.args.commitHash,
      timestamp: Number(event.args.timestamp) * 1000, // ms for JS Date
      label: event.args.label,
      txHash: event.transactionHash,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

