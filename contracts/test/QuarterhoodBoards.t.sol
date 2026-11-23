// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {QuarterhoodBoards} from "../src/QuarterhoodBoards.sol";

contract QuarterhoodBoardsTest is Test {
    QuarterhoodBoards boards;
    address op = address(0xA11CE);
    bytes32 constant WEEK = "2026-11-23";

    function setUp() public {
        boards = new QuarterhoodBoards(op);
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function test_commitOnlyOperator() public {
        vm.expectRevert(QuarterhoodBoards.NotOperator.selector);
        boards.commit(WEEK, bytes32(uint256(1)), 1, 1);
        vm.prank(op);
        boards.commit(WEEK, bytes32(uint256(1)), 1, 1);
        assertEq(boards.rootOf(WEEK), bytes32(uint256(1)));
    }

    function test_commitOncePerWeek() public {
        vm.startPrank(op);
        boards.commit(WEEK, bytes32(uint256(1)), 1, 1);
        vm.expectRevert(abi.encodeWithSelector(QuarterhoodBoards.AlreadyCommitted.selector, WEEK));
        boards.commit(WEEK, bytes32(uint256(2)), 1, 1);
    }

    function test_emptyRootRefused() public {
        vm.prank(op);
        vm.expectRevert(QuarterhoodBoards.EmptyRoot.selector);
        boards.commit(WEEK, bytes32(0), 0, 0);
    }

    function test_eventEmitted() public {
        vm.expectEmit(true, false, false, true);
        emit QuarterhoodBoards.WeekCommitted(WEEK, bytes32(uint256(7)), 12, 300);
        vm.prank(op);
        boards.commit(WEEK, bytes32(uint256(7)), 12, 300);
    }

    function test_verifyThreeLeaves() public {
        bytes32 a = boards.leafOf(WEEK, "coin-stack", "ranked", 1, address(1), 410, bytes16(uint128(1)), 0x94b79f1e);
        bytes32 b = boards.leafOf(WEEK, "coin-stack", "ranked", 2, address(2), 300, bytes16(uint128(2)), 0x11111111);
        bytes32 c = boards.leafOf(WEEK, "hood-dash", "ranked", 1, address(3), 990, bytes16(uint128(3)), 0x22222222);
        bytes32 ab = _pair(a, b);
        bytes32 root = _pair(ab, c);
        vm.prank(op);
        boards.commit(WEEK, root, 2, 3);
        bytes32[] memory p = new bytes32[](2);
        p[0] = b;
        p[1] = c;
        assertTrue(boards.verify(WEEK, a, p));
        bytes32[] memory pc = new bytes32[](1);
        pc[0] = ab;
        assertTrue(boards.verify(WEEK, c, pc));
        // a changed score is a different leaf
        bytes32 forged = boards.leafOf(WEEK, "coin-stack", "ranked", 1, address(1), 999, bytes16(uint128(1)), 0x94b79f1e);
        assertFalse(boards.verify(WEEK, forged, p));
        // an uncommitted week never verifies
        assertFalse(boards.verify("2026-11-30", a, p));
    }

    function testFuzz_onlyOperator(address who, bytes32 root) public {
        vm.assume(who != op && root != bytes32(0));
        vm.prank(who);
        vm.expectRevert(QuarterhoodBoards.NotOperator.selector);
        boards.commit(WEEK, root, 1, 1);
    }

    /// The site's TypeScript (app/shared/boards.ts) must hash leaves and pairs exactly like the contract.
    function test_matchesOffchainTree() public {
        bytes32 a = boards.leafOf(WEEK, "coin-stack", "ranked", 1, address(1), 410, bytes16(uint128(1)), 0x94b79f1e);
        assertEq(a, 0x9ef86a13c27e6ef67fa71ed189cfded7066188892be692515393b04551a7082e);
        bytes32 root = 0xc5fd1a873b91639805aee622b0f1407dd00bfe52bdbda16536c51c86c231d0a0;
        vm.prank(op);
        boards.commit(WEEK, root, 2, 3);
        bytes32[] memory p = new bytes32[](2);
        p[0] = 0x541d62c1777d9b9038de45e0c757d02723c05c8ee761015a748278f466a10ff5;
        p[1] = 0xd80d85183f897352fe6f7d33122ffc4e5fb65ed5be3fe0ec4300cf3abd7d815b;
        assertTrue(boards.verify(WEEK, a, p));
    }
}
