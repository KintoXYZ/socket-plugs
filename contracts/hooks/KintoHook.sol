// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "./LimitHook.sol";
import "../../contracts/bridge/Controller.sol";

interface IKintoID {
    function isKYC(address) external view returns (bool);
}

interface IKintoFactory {
    function walletTs(address) external view returns (uint256);
}

interface IKintoWallet {
    function isFunderWhitelisted(address) external view returns (bool);
    function owners(uint256) external view returns (address);
}

/**
 * @title Kinto Hook
 * @notice meant to be deployed only Kinto. Inherits from LimitHook.
 */
contract KintoHook is LimitHook {
    IKintoID public immutable kintoID;
    IKintoFactory public immutable kintoFactory;

    // if withdrawalAmount > 0, will trigger a withdrawal back to the vault chain
    uint256 public withdrawalAmount;

    error InvalidSender(address sender);
    error ReceiverNotAllowed(address receiver);
    error KYCRequired();
    error NotEnoughFunds();

    /**
     * @notice Constructor for creating a Kinto Hook
     * @param owner_ Owner of this contract.
     * @param controller_ Controller of this contract.
     * @param useControllerPools_ Whether to use controller pools.
     * @param kintoID_ KintoID contract address.
     * @param kintoFactory_ KintoFactory contract address.
     */
    constructor(
        address owner_,
        address controller_,
        bool useControllerPools_,
        address kintoID_,
        address kintoFactory_
    ) LimitHook(owner_, controller_, useControllerPools_) {
        hookType = keccak256("KINTO");
        kintoID = IKintoID(kintoID_);
        kintoFactory = IKintoFactory(kintoFactory_);
    }

    /**
     * @dev called when Kinto user wants to "withdraw" (bridge out). Checks if sender is a KintoWallet,
     * if the wallet's signer is KYC'd and if the receiver of the funds is whitelisted.
     */
    function srcPreHookCall(
        SrcPreHookCallParams memory params_
    )
        public
        override
        isVaultOrController
        returns (TransferInfo memory transferInfo, bytes memory postHookData)
    {
        // if we are not in a withdrawal scenario, proceed as usual
        if (withdrawalAmount == 0) {
            address sender = params_.msgSender;
            if (kintoFactory.walletTs(sender) == 0)
                revert InvalidSender(sender);
            if (!kintoID.isKYC(IKintoWallet(sender).owners(0)))
                revert KYCRequired();

            address receiver = params_.transferInfo.receiver;
            if (!IKintoWallet(sender).isFunderWhitelisted(receiver))
                revert ReceiverNotAllowed(receiver);
        }
        return super.srcPreHookCall(params_);
    }

    function srcPostHookCall(
        SrcPostHookCallParams memory params_
    ) public override isVaultOrController returns (TransferInfo memory) {
        // if we are in a withdrawal scenario, save the amount to be withdrawn on the transferInfo
        // and reset the withdrawalAmount
        if (withdrawalAmount > 0) {
            params_.transferInfo.amount = withdrawalAmount;
            withdrawalAmount = 0;
            return params_.transferInfo;
        } else {
            return super.srcPostHookCall(params_);
        }
    }

    /**
     * @dev called when user wants to bridge assets into Kinto. It checks if the receiver
     * is a Kinto Wallet, if the wallet's signer is KYC'd and if the "original sender"
     * (initiator of the tx on the vault chain) is whitelisted on the receiver's KintoWallet.
     * If not, it sets the `withdrawalAmount` to the amount to be withdrawn (so the `dstPostHookCall`
     * triggers the withdrawal) and sets the transferInfo amount to 0.
     * The "original sender" is passed as an encoded param through the SenderHook.
     */
    function dstPreHookCall(
        DstPreHookCallParams memory params_
    )
        public
        override
        isVaultOrController
        returns (bytes memory postHookData, TransferInfo memory transferInfo)
    {
        address receiver = params_.transferInfo.receiver;
        address msgSender = abi.decode(params_.transferInfo.data, (address));

        if (
            (kintoFactory.walletTs(receiver) == 0) ||
            !kintoID.isKYC(IKintoWallet(receiver).owners(0)) ||
            !IKintoWallet(receiver).isFunderWhitelisted(msgSender)
        ) {
            withdrawalAmount = params_.transferInfo.amount;
            params_.transferInfo.amount = 0;
        }

        return super.dstPreHookCall(params_);
    }

    /**
     * @dev called when Kinto user wants to "withdraw" (bridge out). It's only used on scenarios in which
     * the Kinto checks fail and we need to trigger a withdrawal.
     * The `bridge()` call is sponsored by this sme contract, which will pay the fees. If there are no funds,
     * it will revert.
     */
    function dstPostHookCall(
        DstPostHookCallParams memory params_
    ) public override isVaultOrController returns (CacheData memory cacheData) {
        if (withdrawalAmount > 0) {
            uint256 fees = Controller(vaultOrController).getMinFees(
                params_.connector,
                400_000, // msgGasLimit_ (safe value for Ethereum)
                0
            );

            // if not enough funds to pay the fees, revert
            if (fees > address(this).balance) revert InsufficientFunds();

            Controller(vaultOrController).bridge{value: fees}(
                abi.decode(params_.transferInfo.data, (address)), // receiver_
                0, // amount_
                400_000, // msgGasLimit_ (safe value for Ethereum)
                params_.connector, // connector_
                "0x", // execPayload_
                "0x" // options_
            );
            uint256 connectorPendingAmount = _getConnectorPendingAmount(
                params_.connectorCache
            );
            cacheData = CacheData(
                bytes(""),
                abi.encode(connectorPendingAmount)
            );
        } else {
            return super.dstPostHookCall(params_);
        }
    }
}
