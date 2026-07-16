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
 * We paginate in chunks to work around this.
 */
export async function fetchHistory(address) {
  const contract = getContract();
  const provider = getProvider();
  const filter = contract.filters.Anchored(address);
  
  // Get the latest block number
  const latestBlockNumber = await provider.getBlockNumber();
  
  // Fetch events in 100-block chunks to respect RPC node limits
  const CHUNK_SIZE = 100;
  const allEvents = [];
  
  for (let fromBlock = 0; fromBlock <= latestBlockNumber; fromBlock += CHUNK_SIZE) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlockNumber);
    const events = await contract.queryFilter(filter, fromBlock, toBlock);
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

