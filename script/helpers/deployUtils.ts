import { Wallet } from "ethers";
import { network, ethers, run, artifacts } from "hardhat";
import { ContractFactory, Contract } from "ethers";
import {
  deployOnKinto,
  isKinto,
  extractArgTypes,
} from "@kinto-utils/dist/kinto";
import { LEDGER, TREZOR } from "@kinto-utils/dist/utils/constants";

import fs from "fs";
import { Address } from "hardhat-deploy/dist/types";
import {
  ChainSlug,
  IntegrationTypes,
  getAddresses,
} from "@socket.tech/dl-core";
import { overrides } from "./networks";
import {
  getMode,
  getProjectName,
  getProjectType,
  isSuperBridge,
} from "../constants/config";
import {
  SuperBridgeContracts,
  SBTokenAddresses,
  SBAddresses,
  STAddresses,
  DeployParams,
  AllAddresses,
  SocketPlugsConfig,
} from "../../src";
import {
  deploymentPath,
  getAllDeploymentPath,
  getDeploymentPath,
  getVerificationPath,
  readJSONFile,
} from "./utils";
import {
  ExistingTokenAddresses,
  Project,
  Tokens,
  tokenDecimals,
  tokenSymbol,
} from "../../src/enums";
import path from "path";
import { ProjectTypeMap } from "../../src/enums/projectType";

export const getOrDeploy = async (
  contractName: string,
  path: string,
  args: any[],
  deployUtils: DeployParams
): Promise<Contract> => {
  if (!deployUtils || !deployUtils.addresses)
    throw new Error("No addresses found");

  let contract: Contract;
  let storedContactAddress = deployUtils.addresses[contractName];
  if (contractName === SuperBridgeContracts.FiatTokenV2_1_Controller) {
    storedContactAddress =
      deployUtils.addresses[SuperBridgeContracts.Controller];
  }

  if (!storedContactAddress) {
    contract = await deployContractWithArgs(
      contractName,
      args,
      deployUtils.signer
    );

    console.log(
      `${contractName} deployed on ${
        deployUtils.currentChainSlug
      } for ${getMode()}, ${getProjectName()} at address ${contract.address}`
    );

    await storeVerificationParams(
      [contract.address, contractName, path, args],
      deployUtils.currentChainSlug
    );
  } else {
    contract = await getInstance(contractName, storedContactAddress);
    console.log(
      `${contractName} found on ${
        deployUtils.currentChainSlug
      } for ${getMode()}, ${getProjectName()} at address ${contract.address}`
    );
  }

  return contract;
};
export const getOrDeployConnector = async (
  args: any[],
  deployUtils: DeployParams,
  sibling: ChainSlug,
  integrationType: IntegrationTypes
): Promise<Contract> => {
  if (!deployUtils || !deployUtils.addresses)
    throw new Error("No addresses found");

  let contract: Contract;
  let storedContactAddress = (deployUtils.addresses as SBTokenAddresses)
    .connectors?.[sibling]?.[integrationType];

  if (!storedContactAddress) {
    contract = await deployContractWithArgs(
      SuperBridgeContracts.ConnectorPlug,
      args,
      deployUtils.signer
    );

    console.log(
      `${SuperBridgeContracts.ConnectorPlug} deployed on ${
        deployUtils.currentChainSlug
      } for ${getMode()}, ${getProjectName()} at address ${contract.address}`
    );

    await storeVerificationParams(
      [
        contract.address,
        SuperBridgeContracts.ConnectorPlug,
        "contracts/ConnectorPlug.sol",
        args,
      ],
      deployUtils.currentChainSlug
    );
  } else {
    contract = await getInstance(
      SuperBridgeContracts.ConnectorPlug,
      storedContactAddress
    );
    console.log(
      `${SuperBridgeContracts.ConnectorPlug} found on ${
        deployUtils.currentChainSlug
      } for ${getMode()}, ${getProjectName()} at address ${contract.address}`
    );
  }

  return contract;
};

export async function deployContractWithArgs(
  contractName: string,
  args: Array<any>,
  signer: Wallet
) {
  try {
    const Contract: ContractFactory = await ethers.getContractFactory(
      contractName
    );
    let contract: Contract;
    if (isKinto(await signer.getChainId())) {
      const abi = JSON.parse(
        Contract.interface.format(ethers.utils.FormatTypes.json) as string
      );
      const contractAddr = await deployOnKinto({
        kintoWalletAddr: process.env.KINTO_OWNER_ADDRESS,
        bytecode: Contract.bytecode,
        abi,
        args,
        argTypes: await extractArgTypes(abi),
        privateKeys: [
          `0x${process.env.OWNER_SIGNER_KEY}`,
          process.env.HARDWARE_WALLET == "TREZOR" ? TREZOR : LEDGER,
        ],
      });
      contract = await getInstance(contractName, contractAddr);
    } else {
      // gasLimit is set to undefined to not use the value set in overrides
      contract = await Contract.connect(signer).deploy(...args, {
        ...overrides[await signer.getChainId()],
        // gasLimit: undefined,
      });
      contract = await contract.deployed();
    }
    return contract;
  } catch (error) {
    throw error;
  }
}

export const verify = async (
  address: string,
  contractName: string,
  path: string,
  args: any[]
) => {
  try {
    const chainSlug = await getChainSlug();
    if (chainSlug === 31337) return;

    await run("verify:verify", {
      address,
      contract: `${path}:${contractName}`,
      constructorArguments: args,
    });
  } catch (error) {
    console.log("Error during verification", error);
  }
};

export const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay * 1000));

// export const getInstance = async (
//   contractName: string,
//   address: Address
// ): Promise<Contract> => ethers.getContractAt(contractName, address);

export const getInstance = async (contractName: string, address: Address) => {
  const artifact = await artifacts.readArtifact(contractName);
  return new ethers.Contract(address, artifact.abi);
};

export const getChainSlug = async (): Promise<number> => {
  if (network.config.chainId === undefined)
    throw new Error("chain id not found");
  return Number(network.config.chainId);
};

export const getSocket = async (
  chain: ChainSlug,
  signer: Wallet
): Promise<Contract> => {
  const artifact = await artifacts.readArtifact("Socket");
  return new Contract(
    getAddresses(chain, getMode()).Socket,
    artifact.abi,
    signer
  );
};

export const storeTokenAddresses = async (
  addresses: SBTokenAddresses,
  chainSlug: ChainSlug,
  tokenName: Tokens
) => {
  let deploymentAddresses: SBAddresses | STAddresses = readJSONFile(
    getDeploymentPath()
  );

  deploymentAddresses = createObj(
    deploymentAddresses,
    [chainSlug.toString(), tokenName],
    addresses
  );
  fs.writeFileSync(
    getDeploymentPath(),
    JSON.stringify(deploymentAddresses, null, 2)
  );
};

export const storeAllAddresses = async (
  projectName: Project,
  projectAddresses: SBAddresses | STAddresses
) => {
  let filePath = getAllDeploymentPath();
  let allAddresses: AllAddresses = readJSONFile(filePath);

  allAddresses = createObj(allAddresses, [projectName], projectAddresses);
  fs.writeFileSync(filePath, JSON.stringify(allAddresses, null, 2));
};

export const storeProjectAddresses = async (addresses: SBAddresses) => {
  fs.writeFileSync(getDeploymentPath(), JSON.stringify(addresses, null, 2));
};

let addresses: SBAddresses | STAddresses;
export const getProjectAddresses = (): SBAddresses | STAddresses => {
  if (addresses) return addresses;
  addresses = readJSONFile(getDeploymentPath());
  return addresses;
};

export const getSuperBridgeAddresses = (): SBAddresses => {
  return getProjectAddresses() as SBAddresses;
};
export const getSuperTokenAddresses = (): STAddresses => {
  return getProjectAddresses() as STAddresses;
};

export const storeVerificationParams = async (
  verificationDetail: any[],
  chainSlug: ChainSlug
) => {
  let verificationDetails: object = readJSONFile(getVerificationPath());

  if (!verificationDetails[chainSlug]) verificationDetails[chainSlug] = [];
  verificationDetails[chainSlug] = [
    verificationDetail,
    ...verificationDetails[chainSlug],
  ];

  fs.writeFileSync(
    getVerificationPath(),
    JSON.stringify(verificationDetails, null, 2)
  );
};

export const createObj = function (obj: any, keys: string[], value: any): any {
  if (keys.length === 1) {
    obj[keys[0]] = value;
  } else {
    const key = keys.shift();
    if (key === undefined) return obj;
    obj[key] = createObj(
      typeof obj[key] === "undefined" ? {} : obj[key],
      keys,
      value
    );
  }
  return obj;
};

export const updateAllAddressesFile = async () => {
  let projects = Object.values(Project);

  for (let project of projects) {
    const projectDeploymentPath = path.join(
      __dirname,
      `/../../deployments/${
        ProjectTypeMap[project]
      }/${getMode()}_${project}_addresses.json`
    );
    let projectAddresses = readJSONFile(projectDeploymentPath);
    if (Object.keys(projectAddresses).length === 0) continue;
    storeAllAddresses(project, projectAddresses);
  }
};

export const updateDetailsFile = async () => {
  let details: SocketPlugsConfig = {
    tokenDecimals: tokenDecimals,
    tokenAddresses: ExistingTokenAddresses,
    tokenSymbols: tokenSymbol,
    projects: Object.values(Project),
    tokens: Object.values(Tokens),
  };

  const detailsFilePath = path.join(
    __dirname,
    `/../../socket-plugs-details.json`
  );
  fs.writeFileSync(detailsFilePath, JSON.stringify(details, null, 2));
};
