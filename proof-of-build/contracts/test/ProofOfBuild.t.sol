// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProofOfBuild} from "../src/ProofOfBuild.sol";

contract ProofOfBuildTest is Test {
    ProofOfBuild internal pob;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        pob = new ProofOfBuild();
    }

    function testAnchorStoresEntry() public {
        vm.prank(alice);
        pob.anchor(keccak256("commit-1"), "initial scaffold");

        assertEq(pob.count(alice), 1);

        ProofOfBuild.Anchor[] memory history = pob.getHistory(alice);
        assertEq(history[0].commitHash, keccak256("commit-1"));
        assertEq(history[0].label, "initial scaffold");
        assertEq(history[0].timestamp, uint64(block.timestamp));
    }

    function testMultipleAnchorsAppendInOrder() public {
        vm.startPrank(alice);
        pob.anchor(keccak256("commit-1"), "first");
        vm.warp(block.timestamp + 1 hours);
        pob.anchor(keccak256("commit-2"), "second");
        vm.stopPrank();

        assertEq(pob.count(alice), 2);
        ProofOfBuild.Anchor[] memory history = pob.getHistory(alice);
        assertEq(history[0].label, "first");
        assertEq(history[1].label, "second");
        assertTrue(history[1].timestamp > history[0].timestamp);
    }

    function testHistoriesAreIsolatedPerBuilder() public {
        vm.prank(alice);
        pob.anchor(keccak256("alice-commit"), "alice work");

        vm.prank(bob);
        pob.anchor(keccak256("bob-commit"), "bob work");

        assertEq(pob.count(alice), 1);
        assertEq(pob.count(bob), 1);
        assertEq(pob.getHistory(alice)[0].label, "alice work");
        assertEq(pob.getHistory(bob)[0].label, "bob work");
    }

    function testRevertsOnEmptyLabel() public {
        vm.prank(alice);
        vm.expectRevert(ProofOfBuild.EmptyLabel.selector);
        pob.anchor(keccak256("commit"), "");
    }

    function testRevertsOnOversizedLabel() public {
        bytes memory longLabel = new bytes(201);
        for (uint256 i = 0; i < 201; i++) {
            longLabel[i] = "a";
        }

        vm.prank(alice);
        vm.expectRevert(ProofOfBuild.LabelTooLong.selector);
        pob.anchor(keccak256("commit"), string(longLabel));
    }

    function testFirstAnchorTimestampReflectsEarliestAnchor() public {
        assertEq(pob.firstAnchorTimestamp(alice), 0);

        vm.prank(alice);
        pob.anchor(keccak256("commit-1"), "first ever");

        assertEq(pob.firstAnchorTimestamp(alice), uint64(block.timestamp));
    }

    function testCannotAnchorForSomeoneElse() public {
        // Bob calls anchor; msg.sender is always the caller, so Alice's history
        // is untouched no matter what Bob does. This test documents that guarantee.
        vm.prank(bob);
        pob.anchor(keccak256("bob-commit"), "bob only");

        assertEq(pob.count(alice), 0);
    }
}