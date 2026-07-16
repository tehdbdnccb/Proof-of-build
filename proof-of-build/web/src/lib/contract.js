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
 * We paginate in chunks and fetch them sequentially, one request at a time.
 *
 * Chunks are intentionally NOT fetched with Promise.all — some RPC providers
 * (e.g. Ankr) bundle concurrent requests from ethers.js into a single JSON-RPC
 * batch POST, and reject oversized batches with error -32062 ("Batch size too
 * large"). Fetching sequentially guarantees each queryFilter call is sent as
 * its own request. The rate limiter still caps us at 25 req/sec so this stays
 * well within provider rate limits while remaining fast (~1-2s for a full
 * history).
 */
export async function fetchHistory(address) {
  const contract = getContract();
  const provider = getProvider();
  const filter = contract.filters.Anchored(address);
  
  // Get the latest block number
  const latestBlockNumber = await provider.getBlockNumber();
  
  // Fetch events in 50-block chunks to reduce archive/trie load on RPC node
  const CHUNK_SIZE = 50;
  const allEvents = [];

  for (let fromBlock = 0; fromBlock <= latestBlockNumber; fromBlock += CHUNK_SIZE) {
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

