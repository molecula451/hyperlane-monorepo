import {
  ChainMap,
  ChainName,
  HyperlaneDeployer,
  serializeContractsMap,
} from '@hyperlane-xyz/sdk';
import { objFilter, objMerge } from '@hyperlane-xyz/utils';

import {
  Modules,
  getAddresses,
  writeAddresses,
} from '../../scripts/agent-utils.js';
import { DeployEnvironment } from '../config/environment.js';
import { readJSONAtPath, writeJsonAtPath } from '../utils/utils.js';

export async function deployWithArtifacts<Config extends object>({
  configMap,
  deployer,
  cache,
  targetNetworks,
}: {
  configMap: ChainMap<Config>;
  deployer: HyperlaneDeployer<Config, any>;
  cache: {
    verification: string;
    read: boolean;
    write: boolean;
    environment: DeployEnvironment;
    module: Modules;
  };
  targetNetworks: ChainName[];
}) {
  if (cache.read) {
    const addressesMap = getAddresses(cache.environment, cache.module);
    deployer.cacheAddressesMap(addressesMap);
  }

  process.on('SIGINT', async () => {
    // Call the post deploy hook to write the addresses and verification
    await postDeploy(deployer, cache);

    console.log('\nCaught (Ctrl+C), gracefully exiting...');
    process.exit(0); // Exit the process
  });

  // Filter the config map to only deploy the target networks
  let targetConfigMap = configMap;
  if (targetNetworks.length > 0) {
    targetConfigMap = objFilter(configMap, (chain, _): _ is Config =>
      targetNetworks.includes(chain),
    );
  }

  // Deploy the contracts
  try {
    await deployer.deploy(targetConfigMap);
  } catch (e: any) {
    if (e?.message.includes('Timed out')) {
      console.warn('Contract deployment exceeding configured timeout', e);
    } else {
      console.error('Contract deployment failed', e);
    }
  }

  await postDeploy(deployer, cache);
}

export async function postDeploy<Config extends object>(
  deployer: HyperlaneDeployer<Config, any>,
  cache: {
    verification: string;
    read: boolean;
    write: boolean;
    environment: DeployEnvironment;
    module: Modules;
  },
) {
  if (cache.write) {
    // TODO: dedupe deployedContracts with cachedAddresses
    const deployedAddresses = serializeContractsMap(deployer.deployedContracts);
    const cachedAddresses = deployer.cachedAddresses;
    const addresses = objMerge(deployedAddresses, cachedAddresses);

    // cache addresses of deployed contracts
    writeAddresses(cache.environment, cache.module, addresses);

    let savedVerification = {};
    try {
      savedVerification = readJSONAtPath(cache.verification);
    } catch (e) {
      console.error('Failed to load cached verification inputs');
    }

    // cache verification inputs
    const inputs =
      deployer.mergeWithExistingVerificationInputs(savedVerification);
    writeJsonAtPath(cache.verification, inputs);
  }
}
