import { Contract, Wallet } from "ethers";

import {
  ChainSlug,
  IntegrationTypes,
  getAddresses,
} from "@socket.tech/dl-core";

import { getSignerFromChainSlug } from "../helpers/networks";
import {
  getInstance,
  getProjectAddresses,
  getSocket,
  execute,
  printExecSummary,
} from "../helpers";
import { getTokenConstants } from "../helpers/projectConstants";
import {
  SuperBridgeContracts,
  ConnectorAddresses,
  Connectors,
  ProjectType,
  TokenContracts,
  TokenConstants,
  SBAddresses,
  STAddresses,
  SBTokenAddresses,
  STTokenAddresses,
  AppChainAddresses,
  NonAppChainAddresses,
} from "../../src";
import {
  getConfigs,
  getMode,
  isSuperBridge,
  isSuperToken,
} from "../constants/config";
import {
  CONTROLLER_ROLE,
  MINTER_ROLE,
  RESCUE_ROLE,
  SOCKET_RELAYER_ROLE,
} from "../constants/roles";
import { verifyConstants } from "../helpers/verifyConstants";
import {
  checkAndGrantRole,
  checkAndRevokeRole,
  getBridgeContract,
  updateConnectorStatus,
} from "../helpers/common";
import { configureHooks } from "./configureHook";
import { Tokens } from "../../src/enums";
import { ethers } from "hardhat";

let projectType: ProjectType;
let pc: { [token: string]: TokenConstants } = {};
let projectName: string;
let tokens: Tokens[];

let socketSignerAddress: string;

export const configure = async (allAddresses: SBAddresses | STAddresses) => {
  await verifyConstants();
  ({ projectName, projectType, tokens } = getConfigs());
  let allConfigured = false;
  while (!allConfigured) {
    for (let token of tokens) {
      console.log(`\nConfiguring ${token}...`);
      pc[token] = getTokenConstants(token);
      // console.log(pc[token]);
      let addresses: SBAddresses | STAddresses;
      try {
        addresses = allAddresses ?? getProjectAddresses();
        // console.log(addresses);
      } catch (error) {
        addresses = {} as SBAddresses | STAddresses;
      }
      let allChains: ChainSlug[] = [
        ...pc[token].controllerChains,
        ...pc[token].vaultChains,
      ];

      await Promise.all(
        allChains.map(async (chain) => {
          let addr: SBTokenAddresses | STTokenAddresses = (addresses[chain]?.[
            token
          ] ?? {}) as SBTokenAddresses | STTokenAddresses;

          const connectors: Connectors | undefined = addr.connectors;
          if (!addr || !connectors) return;

          const socketSigner = getSignerFromChainSlug(chain);
          socketSignerAddress = await socketSigner.getAddress();

          let siblingSlugs: ChainSlug[] = Object.keys(connectors).map((k) =>
            parseInt(k)
          ) as ChainSlug[];

          let bridgeContract: Contract = await getBridgeContract(
            chain,
            token,
            addr
          );

          const abi = [
            "function revokeRole(bytes32 role, address account)",
            "function grantRole(bytes32 role, address account)",
            "function hasRole(bytes32 role, address account) view returns (bool)",
          ];

          // revoke RESCUE_ROLE from Controller
          if (chain === ChainSlug.KINTO) {
            const a = addr as AppChainAddresses;

            const instance = new ethers.Contract(
              a.Controller,
              abi,
              socketSigner
            );

            await checkAndRevokeRole(
              chain,
              instance,
              "Rescue",
              RESCUE_ROLE,
              socketSignerAddress
            );
          }

          // revoke RESCUE_ROLE from Vaults
          if (chain !== ChainSlug.KINTO) {
            const a = addr as NonAppChainAddresses;

            const instance = new ethers.Contract(a.Vault, abi, socketSigner);

            await checkAndRevokeRole(
              chain,
              instance,
              "Rescue",
              RESCUE_ROLE,
              socketSignerAddress
            );
          }

          // revoke RESCUE_ROLE from each connector
          const connectorsAddresses = Object.values(connectors)
            .map((connector) => Object.values(connector))
            .flat();

          for (const connector of connectorsAddresses) {
            const instance = new ethers.Contract(connector, abi, socketSigner);

            await checkAndRevokeRole(
              chain,
              instance,
              "Rescue",
              RESCUE_ROLE,
              socketSignerAddress
            );
          }

          // revoke RESCUE_ROLE from Hooks

          // await configureHooks(
          //   chain,
          //   token,
          //   bridgeContract,
          //   socketSigner,
          //   siblingSlugs,
          //   connectors,
          //   addr
          // );
        })
      );
    }

    allConfigured = true;
  }

  printExecSummary();
};

const setControllerRole = async (
  chain: ChainSlug,
  superTokenContract: Contract,
  controllerAddress: string
) => {
  await checkAndGrantRole(
    chain,
    superTokenContract,
    "controller",
    CONTROLLER_ROLE,
    controllerAddress
  );
};

const connect = async (
  addr: SBTokenAddresses | STTokenAddresses,
  addresses: SBAddresses | STAddresses,
  chain: ChainSlug,
  token: Tokens,
  siblingSlugs: ChainSlug[],
  socketSigner: Wallet
) => {
  try {
    console.log(
      `-   Checking connection for chain ${chain}, siblings ${siblingSlugs}`
    );

    for (let sibling of siblingSlugs) {
      const localConnectorAddresses: ConnectorAddresses | undefined =
        addr.connectors?.[sibling];
      const siblingConnectorAddresses: ConnectorAddresses | undefined =
        addresses?.[sibling]?.[token]?.connectors?.[chain];
      if (!localConnectorAddresses || !siblingConnectorAddresses) {
        throw new Error(
          `connector addresses not found for chain: ${chain},sibling: ${sibling}`
        );
      }

      const integrationTypes: IntegrationTypes[] = Object.keys(
        localConnectorAddresses
      ) as unknown as IntegrationTypes[];

      const socketContract: Contract = await getSocket(chain, socketSigner);
      for (let integration of integrationTypes) {
        const siblingConnectorPlug = siblingConnectorAddresses[integration];
        const localConnectorPlug = localConnectorAddresses[integration];
        if (!localConnectorPlug || !siblingConnectorPlug) {
          throw Error("Cant find plug addresses");
        }

        const switchboard = getAddresses(chain, getMode())?.integrations?.[
          sibling
        ]?.[integration]?.switchboard;

        if (!switchboard) {
          console.log(
            `switchboard not found for ${chain}, ${sibling}, ${integration}`
          );
        } else {
          console.log(
            `✔   Switchboard found for ${chain}, ${sibling}, ${integration}`
          );
        }
        // console.log(
        //   { localConnectorPlug, sibling, switchboard },
        //   socketContract.address
        // );
        let config = await socketContract.callStatic.getPlugConfig(
          localConnectorPlug,
          sibling
        );
        if (config[0].toLowerCase() === siblingConnectorPlug.toLowerCase()) {
          console.log(`✔   Already connected ${chain}, ${sibling}`);
          continue;
        }

        const connectorContract = (
          await getInstance(
            SuperBridgeContracts.ConnectorPlug,
            localConnectorPlug
          )
        ).connect(socketSigner);

        await execute(
          connectorContract,
          "connect",
          [siblingConnectorPlug, switchboard],
          chain
        );
      }
    }
  } catch (error) {
    console.error("error while connecting: ", error);
    throw error;
  }
};
