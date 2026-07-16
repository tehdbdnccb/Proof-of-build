#!/usr/bin/env node
/**
 * anchor.js
 *
 * Hashes the current git commit and anchors it on Monad via ProofOfBuild.anchor().
 * Intended to run locally (`node cli/anchor.js "my label"`) or inside CI
 * (see .github/workflows/anchor.yml).
 *
 * Required environment variables:
 *   MONAD_RPC_URL           - RPC endpoint for Monad testnet
 *   ANCHOR_PRIVATE_KEY      - private key of a throwaway wallet used only for anchoring
 *   PROOF_OF_BUILD_ADDRESS  - deployed ProofOfBuild contract address
 */

import { execSync } from "node:child_process";
import { keccak256, toUtf8Bytes, JsonRpcProvider, Wallet, Contract } from "ethers";

const ABI = [
  "function anchor(bytes32 commitHash, string calldata label) external",
  "event Anchored(address indexed builder, uint256 indexed index, bytes32 commitHash, uint64 timestamp, string label)",
];

function getCommitSha() {
  return execSync("git rev-parse HEAD").toString().trim();
}

function getCommitMessage() {
  return execSync("git log -1 --pretty=%B").toString().trim();
}

async function main() {
  const { MONAD_RPC_URL, ANCHOR_PRIVATE_KEY, PROOF_OF_BUILD_ADDRESS } = process.env;

  if (!MONAD_RPC_URL || !ANCHOR_PRIVATE_KEY || !PROOF_OF_BUILD_ADDRESS) {
    console.error(
      "Missing required env vars. Need MONAD_RPC_URL, ANCHOR_PRIVATE_KEY, PROOF_OF_BUILD_ADDRESS."
    );
    process.exit(1);
  }

  const commitSha = getCommitSha();
  const rawLabel = process.argv[2] || getCommitMessage();
  const label = rawLabel.slice(0, 200); // matches contract's MAX_LABEL_LENGTH

  const commitHash = keccak256(toUtf8Bytes(commitSha));

  const provider = new JsonRpcProvider(MONAD_RPC_URL);
  const wallet = new Wallet(ANCHOR_PRIVATE_KEY, provider);
  const contract = new Contract(PROOF_OF_BUILD_ADDRESS, ABI, wallet);

  console.log(`Anchoring commit ${commitSha.slice(0, 10)}... with label: "${label}"`);

  const tx = await contract.anchor(commitHash, label);
  console.log(`Submitted tx: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);
}

main().catch((err) => {
  console.error("Anchor failed:", err.message || err);
  process.exit(1);
});