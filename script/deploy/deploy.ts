import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import { Contract, Wallet } from "ethers";
import { getSignerFromChainSlug } from "../helpers/networks";
import {
  ChainSlug,
  IntegrationTypes,
  getAddresses,
} from "@socket.tech/dl-core";
import {
  getMode,
  isSuperBridge,
  isSuperToken,
  getConfigs,
  printConfigs,
} from "../constants/config";
import {
  createObj,
  getOrDeploy,
  getOrDeployConnector,
  getAllAddresses,
  storeTokenAddresses,
} from "../helpers";
import {
  SuperBridgeContracts,
  Hooks,
  ProjectType,
  TokenContracts,
  CommonContracts,
  SuperTokenContracts,
  Tokens,
  TokenConstants,
  STTokenAddresses,
  SBTokenAddresses,
  SBAddresses,
  STAddresses,
  DeployParams,
  ReturnObj,
} from "../../src";
import { isSBAppChain, getTokenConstants } from "../helpers/projectConstants";
import { ExistingTokenAddresses } from "../constants/existing-token-addresses";
import { deployHookContracts } from "./deployHook";
import { verifyConstants } from "../helpers/verifyConstants";
import { getBridgeContract } from "../helpers/common";

let projectType: ProjectType;
let pc: { [token: string]: TokenConstants } = {};
let projectName: string;
let tokens: Tokens[];
/**
 * Deploys contracts for all networks
 */

export const deploy = async () => {
  await verifyConstants();
  ({ projectName, projectType, tokens } = getConfigs());
  printConfigs();
  let allAddresses: SBAddresses | STAddresses = {};

  for (let token of tokens) {
    console.log(`Deploying contracts for ${token}...`);
    pc[token] = getTokenConstants(token);
    let addresses: SBAddresses | STAddresses;
    try {
      addresses = getAllAddresses();
    } catch (error) {
      addresses = {} as SBAddresses | STAddresses;
    }
    let allChains: ChainSlug[] = [
      ...pc[token].controllerChains,
      ...pc[token].vaultChains,
    ];
    const hookType = pc[token].hook.hookType;
    await Promise.all(
      allChains.map(async (chain: ChainSlug) => {
        let allDeployed = false;
        const signer = getSignerFromChainSlug(chain);

        let chainAddresses: SBTokenAddresses | STTokenAddresses = (addresses[
          chain
        ]?.[token] ?? {}) as SBTokenAddresses | STTokenAddresses;

        let siblings: ChainSlug[] = [],
          isAppchain: boolean = false;
        if (projectType == ProjectType.SUPERBRIDGE) {
          isAppchain = isSBAppChain(chain, token);
          siblings = isAppchain
            ? pc[token].vaultChains
            : [pc[token].controllerChains[0]];
        } else if (projectType == ProjectType.SUPERTOKEN)
          siblings = allChains.filter((c) => c !== chain);

        // console.log({ siblings, hook });
        while (!allDeployed) {
          const results: ReturnObj = await deployChainContracts(
            isAppchain,
            pc[token].vaultChains.includes(chain),
            signer,
            chain,
            token,
            siblings,
            hookType,
            chainAddresses
          );

          allDeployed = results.allDeployed;
          chainAddresses = results.deployedAddresses;
          if (!allAddresses[chain]) allAddresses[chain] = {};
          allAddresses[chain]![token] = chainAddresses;
        }
      })
    );
  }

  return allAddresses;
};
/**
 * Deploys network-independent contracts
 */
const deployChainContracts = async (
  isAppChain: boolean,
  isVaultChain: boolean,
  socketSigner: Wallet,
  chainSlug: number,
  token: Tokens,
  siblings: number[],
  hookType: Hooks,
  deployedAddresses: SBTokenAddresses | STTokenAddresses
): Promise<ReturnObj> => {
  let allDeployed = false;

  let deployUtils: DeployParams = {
    addresses: deployedAddresses,
    signer: socketSigner,
    currentChainSlug: chainSlug,
    currentToken: token,
    hookType,
  };

  try {
    const addr = deployUtils.addresses as SBTokenAddresses;
    if (isSuperBridge()) {
      addr.isAppChain = isAppChain;
      deployUtils.addresses = addr;

      if (isAppChain) {
        deployUtils = await deployControllerChainContracts(
          isVaultChain,
          deployUtils
        );
      } else {
        deployUtils = await deployVaultChainContracts(
          isVaultChain,
          deployUtils
        );
      }
    }
    if (isSuperToken()) {
      if (isVaultChain)
        deployUtils = await deployVaultChainContracts(
          isVaultChain,
          deployUtils
        );
      else
        deployUtils = await deployControllerChainContracts(
          isVaultChain,
          deployUtils
        );
    }

    for (let sibling of siblings) {
      deployUtils = await deployConnectors(isVaultChain, sibling, deployUtils);
    }
    allDeployed = true;
    console.log(chainSlug, " Contracts deployed! ✔");
  } catch (error) {
    console.log(
      `Error in deploying setup contracts for ${deployUtils.currentChainSlug}`,
      error
    );
    throw error;
  }

  await storeTokenAddresses(
    deployUtils.addresses as SBTokenAddresses,
    deployUtils.currentChainSlug,
    token
  );
  return {
    allDeployed,
    deployedAddresses: deployUtils.addresses as SBTokenAddresses,
  };
};

const deployConnectors = async (
  isVaultChain: boolean,
  sibling: ChainSlug,
  deployParams: DeployParams
): Promise<DeployParams> => {
  try {
    if (!deployParams?.addresses) throw new Error("Addresses not found!");

    let integrationTypes: IntegrationTypes[];
    const socket: string = getAddresses(
      deployParams.currentChainSlug,
      getMode()
    ).Socket;
    let bridgeContract: Contract, bridgeAddress: string;

    bridgeContract = await getBridgeContract(
      deployParams.currentChainSlug,
      deployParams.currentToken,
      deployParams.addresses
    );
    bridgeAddress = bridgeContract.address;
    if (!bridgeAddress) throw new Error("Hub not found!");

    integrationTypes = Object.keys(
      pc[deployParams.currentToken].hook.limitsAndPoolId?.[
        deployParams.currentChainSlug
      ]
    ) as IntegrationTypes[];

    for (let intType of integrationTypes) {
      const connector: Contract = await getOrDeployConnector(
        [bridgeAddress, socket, sibling],
        deployParams,
        sibling,
        intType
      );
      deployParams.addresses = createObj(
        deployParams.addresses,
        ["connectors", sibling.toString(), intType],
        connector.address
      );
    }

    console.log(
      deployParams.currentChainSlug,
      " Connector Contracts deployed! ✔"
    );
  } catch (error) {
    console.log("Error in deploying connector contracts", error);
    throw error;
  }

  return deployParams;
};

const deployControllerChainContracts = async (
  isVaultChain: boolean,
  deployParams: DeployParams
): Promise<DeployParams> => {
  try {
    let mintableToken: string = "",
      controller: Contract,
      contractName: string = "",
      contractPath: string = "";

    if (isSuperToken()) {
      deployParams = await deploySuperToken(deployParams);
      let token = deployParams.addresses[TokenContracts.SuperToken];
      if (token) mintableToken = token;
      else throw new Error("SuperToken not found on chain");

      contractName = CommonContracts.Controller;
      contractPath = "contracts/bridge/Controller.sol";
    }

    if (isSuperBridge()) {
      let token =
        deployParams.addresses[SuperBridgeContracts.MintableToken] ??
        ExistingTokenAddresses[deployParams.currentChainSlug]?.[
          deployParams.currentToken
        ];
      if (token) mintableToken = token;
      else throw new Error("Token not found on app chain");

      // if address picked from existing token addresses, update it in addresses object
      if (!deployParams.addresses[SuperBridgeContracts.MintableToken])
        deployParams.addresses[SuperBridgeContracts.MintableToken] =
          mintableToken;

      contractName = pc[deployParams.currentToken].isFiatTokenV2_1
        ? SuperBridgeContracts.FiatTokenV2_1_Controller
        : SuperBridgeContracts.Controller;
      contractPath = pc[deployParams.currentToken].isFiatTokenV2_1
        ? "contracts/bridge/FiatTokenV2_1/FiatTokenV2_1_Controller.sol"
        : "contracts/bridge/Controller.sol";
    }

    controller = await getOrDeploy(
      contractName,
      contractPath,
      [mintableToken],
      deployParams
    );

    deployParams.addresses[SuperBridgeContracts.Controller] =
      controller.address;

    deployParams = await deployHookContracts(isVaultChain, true, deployParams);
    console.log(
      deployParams.currentChainSlug,
      " Controller Chain Contracts deployed! ✔"
    );
  } catch (error) {
    console.log(
      "Error in deploying controller chain contracts: ",
      deployParams.currentChainSlug,
      error
    );
    throw error;
  }
  return deployParams;
};

const deployVaultChainContracts = async (
  isVaultChain: boolean,
  deployParams: DeployParams
): Promise<DeployParams> => {
  console.log(
    `Deploying vault chain contracts, chain: ${deployParams.currentChainSlug}...`
  );
  try {
    let nonMintableToken: string =
      deployParams.addresses[SuperBridgeContracts.NonMintableToken] ??
      ExistingTokenAddresses[deployParams.currentChainSlug]?.[
        deployParams.currentToken
      ];
    if (!nonMintableToken) throw new Error("Token not found on app chain");

    if (!deployParams.addresses[SuperBridgeContracts.NonMintableToken])
      deployParams.addresses[SuperBridgeContracts.NonMintableToken] =
        nonMintableToken;

    const vault: Contract = await getOrDeploy(
      SuperBridgeContracts.Vault,
      "contracts/bridge/Vault.sol",
      [nonMintableToken],
      deployParams
    );
    deployParams.addresses[SuperBridgeContracts.Vault] = vault.address;

    const helperContract: Contract = await getOrDeploy(
      SuperBridgeContracts.HelperContract,
      "contracts/utils/HelperContract.sol",
      [nonMintableToken],
      deployParams
    );
    deployParams.addresses[SuperBridgeContracts.HelperContract] =
      helperContract.address;

    deployParams = await deployHookContracts(isVaultChain, false, deployParams);
    console.log(
      deployParams.currentChainSlug,
      " Vault Chain Contracts deployed! ✔"
    );
  } catch (error) {
    console.log(
      "Error in deploying vault chain contracts: ",
      deployParams.currentChainSlug,
      error
    );
    throw error;
  }
  return deployParams;
};

const deploySuperToken = async (deployParams: DeployParams) => {
  let contractName = SuperTokenContracts.SuperToken;
  let path = `contracts/token/${contractName}.sol`;
  let superTokenInfo = pc[deployParams.currentToken].superTokenInfo;
  if (!superTokenInfo) throw new Error("SuperToken info not found!");
  let { name, symbol, decimals, initialSupply, initialSupplyOwner, owner } =
    superTokenInfo;

  const superTokenContract: Contract = await getOrDeploy(
    contractName,
    path,
    [name, symbol, decimals, initialSupplyOwner, owner, initialSupply],
    deployParams
  );
  deployParams.addresses[contractName] = superTokenContract.address;
  return deployParams;
};
