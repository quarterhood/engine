// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {QuarterhoodBoards} from "../src/QuarterhoodBoards.sol";

/// forge script script/Deploy.s.sol --rpc-url robinhood --account quarterhood-ops --broadcast
/// The deploying wallet becomes the operator: the only address that can commit weeks.
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        QuarterhoodBoards b = new QuarterhoodBoards(msg.sender);
        vm.stopBroadcast();
        console.log("QuarterhoodBoards", address(b));
        console.log("operator", b.operator());
    }
}
