// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ProofOfBuild} from "../src/ProofOfBuild.sol";

/// @notice Deploys ProofOfBuild. Run with:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url $MONAD_RPC_URL \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast
contract Deploy is Script {
    function run() external returns (ProofOfBuild) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        ProofOfBuild pob = new ProofOfBuild();
        vm.stopBroadcast();

        console.log("ProofOfBuild deployed at:", address(pob));
        return pob;
    }
}