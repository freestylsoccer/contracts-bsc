import { iMultiPoolsAssets, IReserveParams, tEthereumAddress } from './types';
import { AaveProtocolDataProvider } from '../types/AaveProtocolDataProvider';
import { chunk, waitForTx } from './misc-utils';
import {
  getATokensAndRatesHelper,
  getLendingPoolAddressesProvider,
  getStableAndVariableTokensHelper,
} from './contracts-getters';
import { rawInsertContractAddressInDb } from './contracts-helpers';
import { BigNumberish } from 'ethers';
import {
  deployDefaultReserveInterestRateStrategy,
  deployDelegationAwareAToken,
  deployStableDebtToken,
  deployVariableDebtToken,
} from './contracts-deployments';
import { ZERO_ADDRESS } from './constants';

export const initReservesByHelper = async (
  reservesParams: iMultiPoolsAssets<IReserveParams>,
  tokenAddresses: { [symbol: string]: tEthereumAddress },
  admin: tEthereumAddress,
  incentivesController: tEthereumAddress,
  verify: boolean
) => {
  const stableAndVariableDeployer = await getStableAndVariableTokensHelper();
  const atokenAndRatesDeployer = await getATokensAndRatesHelper();

  const addressProvider = await getLendingPoolAddressesProvider();
  const poolAddress = await addressProvider.getLendingPool();

  // Set aTokenAndRatesDeployer as temporal admin
  await waitForTx(await addressProvider.setPoolAdmin(atokenAndRatesDeployer.address));

  // CHUNK CONFIGURATION
  const tokensChunks = 4;
  const initChunks = 6;

  // Deploy tokens and rates in chunks
  const reservesChunks = chunk(
    Object.entries(reservesParams) as [string, IReserveParams][],
    tokensChunks
  );
  // Initialize variables for future reserves initialization
  let deployedStableTokens: string[] = [];
  let deployedVariableTokens: string[] = [];
  let deployedATokens: string[] = [];
  let deployedRates: string[] = [];
  let reserveTokens: string[] = [];
  let reserveInitDecimals: string[] = [];
  let reserveSymbols: string[] = [];

  console.log(
    `- Token deployments in ${reservesChunks.length * 2} txs instead of ${
      Object.entries(reservesParams).length * 4
    } txs`
  );
  for (let reservesChunk of reservesChunks) {
    // Prepare data
    const tokens: string[] = [];
    const symbols: string[] = [];
    const strategyRates: [
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish,
      BigNumberish
    ][] = [];
    const reservesDecimals: string[] = [];

    for (let [assetSymbol, { reserveDecimals }] of reservesChunk) {
      // Skip UNI due is aDelegatedToken
      if (assetSymbol === 'UNI') {
        continue;
      }
      const assetAddressIndex = Object.keys(tokenAddresses).findIndex(
        (value) => value === assetSymbol
      );
      const [, tokenAddress] = (Object.entries(tokenAddresses) as [string, string][])[
        assetAddressIndex
      ];

      const reserveParamIndex = Object.keys(reservesParams).findIndex(
        (value) => value === assetSymbol
      );
      const [
        ,
        {
          optimalUtilizationRate,
          baseVariableBorrowRate,
          variableRateSlope1,
          variableRateSlope2,
          stableRateSlope1,
          stableRateSlope2,
        },
      ] = (Object.entries(reservesParams) as [string, IReserveParams][])[reserveParamIndex];
      // Add to lists
      tokens.push(tokenAddress);
      symbols.push(assetSymbol);
      strategyRates.push([
        optimalUtilizationRate,
        baseVariableBorrowRate,
        variableRateSlope1,
        variableRateSlope2,
        stableRateSlope1,
        stableRateSlope2,
      ]);
      reservesDecimals.push(reserveDecimals);
    }

    // Deploy stable and variable deployers and save implementations
    const tx1 = await waitForTx(
      await stableAndVariableDeployer.initDeployment(tokens, symbols, incentivesController)
    );
    tx1.events?.forEach((event, index) => {
      rawInsertContractAddressInDb(`stableDebt${symbols[index]}`, event?.args?.stableToken);
      rawInsertContractAddressInDb(`variableDebt${symbols[index]}`, event?.args?.variableToken);
    });
    // Deploy atokens and rate strategies and save implementations
    const tx2 = await waitForTx(
      await atokenAndRatesDeployer.initDeployment(
        tokens,
        symbols,
        strategyRates,
        incentivesController
      )
    );
    tx2.events?.forEach((event, index) => {
      rawInsertContractAddressInDb(`a${symbols[index]}`, event?.args?.aToken);
      rawInsertContractAddressInDb(`strategy${symbols[index]}`, event?.args?.strategy);
    });

    console.log(`  - Deployed aToken, DebtTokens and Strategy for: ${symbols.join(', ')} `);
    const stableTokens: string[] = tx1.events?.map((e) => e.args?.stableToken) || [];
    const variableTokens: string[] = tx1.events?.map((e) => e.args?.variableToken) || [];
    const aTokens: string[] = tx2.events?.map((e) => e.args?.aToken) || [];
    const strategies: string[] = tx2.events?.map((e) => e.args?.strategy) || [];

    deployedStableTokens = [...deployedStableTokens, ...stableTokens];
    deployedVariableTokens = [...deployedVariableTokens, ...variableTokens];
    deployedATokens = [...deployedATokens, ...aTokens];
    deployedRates = [...deployedRates, ...strategies];
    reserveInitDecimals = [...reserveInitDecimals, ...reservesDecimals];
    reserveTokens = [...reserveTokens, ...tokens];
    reserveSymbols = [...reserveSymbols, ...symbols];
  }

  // Deploy UNI token due is delegated aToken
  if (tokenAddresses.UNI) {
    console.log('  - Deploy UNI delegated aToken, debts tokens, and strategy');
    const {
      baseVariableBorrowRate,
      variableRateSlope1,
      variableRateSlope2,
      stableRateSlope1,
      stableRateSlope2,
    } = reservesParams.UNI;
    const aTokenUNI = await deployDelegationAwareAToken(
      [poolAddress, tokenAddresses.UNI, 'Aave interest bearing UNI', 'aUNI', ZERO_ADDRESS],
      verify
    );
    const stableDebtUNI = await deployStableDebtToken(
      [
        poolAddress,
        tokenAddresses.UNI,
        'Aave stable debt bearing UNI',
        'stableDebtUNI',
        ZERO_ADDRESS,
      ],
      verify
    );
    const variableDebtUNI = await deployVariableDebtToken(
      [
        poolAddress,
        tokenAddresses.UNI,
        'Aave variable debt bearing UNI',
        'variableDebtUNI',
        ZERO_ADDRESS,
      ],
      verify
    );
    const ratesUNI = await deployDefaultReserveInterestRateStrategy(
      [
        tokenAddresses.UNI,
        baseVariableBorrowRate,
        variableRateSlope1,
        variableRateSlope2,
        stableRateSlope1,
        stableRateSlope2,
      ],
      verify
    );

    deployedStableTokens.push(stableDebtUNI.address);
    deployedVariableTokens.push(variableDebtUNI.address);
    deployedATokens.push(aTokenUNI.address);
    deployedRates.push(ratesUNI.address);
    reserveInitDecimals.push(reservesParams.UNI.reserveDecimals);
    reserveTokens.push(tokenAddresses.UNI);
    reserveSymbols.push('UNI');
  }

  // Deploy init reserves per chunks
  const chunkedStableTokens = chunk(deployedStableTokens, initChunks);
  const chunkedVariableTokens = chunk(deployedVariableTokens, initChunks);
  const chunkedAtokens = chunk(deployedATokens, initChunks);
  const chunkedRates = chunk(deployedRates, initChunks);
  const chunkedDecimals = chunk(reserveInitDecimals, initChunks);
  const chunkedSymbols = chunk(reserveSymbols, initChunks);

  console.log(`- Reserves initialization in ${chunkedStableTokens.length} txs`);
  for (let chunkIndex = 0; chunkIndex < chunkedDecimals.length; chunkIndex++) {
    const tx3 = await waitForTx(
      await atokenAndRatesDeployer.initReserve(
        chunkedStableTokens[chunkIndex],
        chunkedVariableTokens[chunkIndex],
        chunkedAtokens[chunkIndex],
        chunkedRates[chunkIndex],
        chunkedDecimals[chunkIndex]
      )
    );
    console.log(`  - Reserve ready for: ${chunkedSymbols[chunkIndex].join(', ')}`);
  }

  // Set deployer back as admin
  await waitForTx(await addressProvider.setPoolAdmin(admin));
};

export const getPairsTokenAggregator = (
  allAssetsAddresses: {
    [tokenSymbol: string]: tEthereumAddress;
  },
  aggregatorsAddresses: { [tokenSymbol: string]: tEthereumAddress }
): [string[], string[]] => {
  const { ETH, USD, WETH, ...assetsAddressesWithoutEth } = allAssetsAddresses;

  const pairs = Object.entries(assetsAddressesWithoutEth).map(([tokenSymbol, tokenAddress]) => {
    if (tokenSymbol !== 'WETH' && tokenSymbol !== 'ETH') {
      const aggregatorAddressIndex = Object.keys(aggregatorsAddresses).findIndex(
        (value) => value === tokenSymbol
      );
      const [, aggregatorAddress] = (Object.entries(aggregatorsAddresses) as [
        string,
        tEthereumAddress
      ][])[aggregatorAddressIndex];
      return [tokenAddress, aggregatorAddress];
    }
  }) as [string, string][];

  const mappedPairs = pairs.map(([asset]) => asset);
  const mappedAggregators = pairs.map(([, source]) => source);

  return [mappedPairs, mappedAggregators];
};

export const enableReservesToBorrowByHelper = async (
  reservesParams: iMultiPoolsAssets<IReserveParams>,
  tokenAddresses: { [symbol: string]: tEthereumAddress },
  helpers: AaveProtocolDataProvider,
  admin: tEthereumAddress
) => {
  const addressProvider = await getLendingPoolAddressesProvider();
  const atokenAndRatesDeployer = await getATokensAndRatesHelper();
  const tokens: string[] = [];
  const symbols: string[] = [];
  const stableEnabled: boolean[] = [];

  // Prepare data
  for (const [assetSymbol, { borrowingEnabled, stableBorrowRateEnabled }] of Object.entries(
    reservesParams
  ) as [string, IReserveParams][]) {
    if (!borrowingEnabled) continue;
    const assetAddressIndex = Object.keys(tokenAddresses).findIndex(
      (value) => value === assetSymbol
    );
    const [, tokenAddress] = (Object.entries(tokenAddresses) as [string, string][])[
      assetAddressIndex
    ];
    const { borrowingEnabled: borrowingAlreadyEnabled } = await helpers.getReserveConfigurationData(
      tokenAddress
    );

    if (borrowingAlreadyEnabled) {
      console.log(`Reserve ${assetSymbol} is already enabled for borrowing, skipping`);
      continue;
    }
    tokens.push(tokenAddress);
    stableEnabled.push(stableBorrowRateEnabled);
    symbols.push(assetSymbol);
  }
  if (tokens.length) {
    // Set aTokenAndRatesDeployer as temporal admin
    await waitForTx(await addressProvider.setPoolAdmin(atokenAndRatesDeployer.address));

    // Deploy init per chunks
    const stableChunks = 20;
    const chunkedTokens = chunk(tokens, stableChunks);
    const chunkedSymbols = chunk(symbols, stableChunks);
    const chunkedStableEnabled = chunk(stableEnabled, stableChunks);

    console.log(`- Borrow stable initialization in ${chunkedTokens.length} txs`);
    for (let chunkIndex = 0; chunkIndex < chunkedTokens.length; chunkIndex++) {
      try {
        await waitForTx(
          await atokenAndRatesDeployer.enableBorrowingOnReserves(
            chunkedTokens[chunkIndex],
            chunkedStableEnabled[chunkIndex],
            { gasLimit: 12000000 }
          )
        );
      } catch (error) {
        console.error(error);
        throw error;
      }

      console.log(`  - Init for: ${chunkedSymbols[chunkIndex].join(', ')}`);
    }
    // Set deployer back as admin
    await waitForTx(await addressProvider.setPoolAdmin(admin));
  }
};

export const enableReservesAsCollateralByHelper = async (
  reservesParams: iMultiPoolsAssets<IReserveParams>,
  tokenAddresses: { [symbol: string]: tEthereumAddress },
  helpers: AaveProtocolDataProvider,
  admin: tEthereumAddress
) => {
  const addressProvider = await getLendingPoolAddressesProvider();
  const atokenAndRatesDeployer = await getATokensAndRatesHelper();
  const tokens: string[] = [];
  const symbols: string[] = [];
  const baseLTVA: string[] = [];
  const liquidationThresholds: string[] = [];
  const liquidationBonuses: string[] = [];

  for (const [
    assetSymbol,
    { baseLTVAsCollateral, liquidationBonus, liquidationThreshold },
  ] of Object.entries(reservesParams) as [string, IReserveParams][]) {
    if (baseLTVAsCollateral === '-1') continue;

    const assetAddressIndex = Object.keys(tokenAddresses).findIndex(
      (value) => value === assetSymbol
    );
    const [, tokenAddress] = (Object.entries(tokenAddresses) as [string, string][])[
      assetAddressIndex
    ];
    const { usageAsCollateralEnabled: alreadyEnabled } = await helpers.getReserveConfigurationData(
      tokenAddress
    );

    if (alreadyEnabled) {
      console.log(`- Reserve ${assetSymbol} is already enabled as collateral, skipping`);
      continue;
    }
    // Push data
    tokens.push(tokenAddress);
    symbols.push(assetSymbol);
    baseLTVA.push(baseLTVAsCollateral);
    liquidationThresholds.push(liquidationThreshold);
    liquidationBonuses.push(liquidationBonus);
  }
  if (tokens.length) {
    // Set aTokenAndRatesDeployer as temporal admin
    await waitForTx(await addressProvider.setPoolAdmin(atokenAndRatesDeployer.address));

    // Deploy init per chunks
    const enableChunks = 20;
    const chunkedTokens = chunk(tokens, enableChunks);
    const chunkedSymbols = chunk(symbols, enableChunks);
    const chunkedBase = chunk(baseLTVA, enableChunks);
    const chunkedliquidationThresholds = chunk(liquidationThresholds, enableChunks);
    const chunkedliquidationBonuses = chunk(liquidationBonuses, enableChunks);

    console.log(`- Enable reserve as collateral in ${chunkedTokens.length} txs`);
    for (let chunkIndex = 0; chunkIndex < chunkedTokens.length; chunkIndex++) {
      await waitForTx(
        await atokenAndRatesDeployer.enableReservesAsCollateral(
          chunkedTokens[chunkIndex],
          chunkedBase[chunkIndex],
          chunkedliquidationThresholds[chunkIndex],
          chunkedliquidationBonuses[chunkIndex],
          { gasLimit: 12000000 }
        )
      );
      console.log(`  - Init for: ${chunkedSymbols[chunkIndex].join(', ')}`);
    }
    // Set deployer back as admin
    await waitForTx(await addressProvider.setPoolAdmin(admin));
  }
};
