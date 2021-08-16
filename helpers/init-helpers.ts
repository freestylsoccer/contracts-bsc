import {
  eContractid,
  eEthereumNetwork,
  eNetwork,
  iMultiPoolsAssets,
  IReserveParams,
  tEthereumAddress,
} from './types';
import { AaveProtocolDataProvider } from '../types/AaveProtocolDataProvider';
import { chunk, DRE, getDb, waitForTx } from './misc-utils';
import {
  getAaveProtocolDataProvider,
  getAToken,
  getATokensAndRatesHelper,
  getFirstSigner,
  getLendingPoolAddressesProvider,
  getLendingPoolConfiguratorProxy,
  getStableAndVariableTokensHelper,
} from './contracts-getters';
import { rawInsertContractAddressInDb } from './contracts-helpers';
import { BigNumber, BigNumberish, Signer } from 'ethers';
import {
  deployDefaultReserveInterestRateStrategy,
  deployDelegationAwareAToken,
  deployDelegationAwareATokenImpl,
  deployGenericAToken,
  deployGenericATokenImpl,
  deployGenericStableDebtToken,
  deployGenericVariableDebtToken,
  deployStableDebtToken,
  deployVariableDebtToken,
} from './contracts-deployments';
import { ZERO_ADDRESS } from './constants';
import { isZeroAddress } from 'ethereumjs-util';
import { DefaultReserveInterestRateStrategy, DelegationAwareAToken } from '../types';
import { config } from 'process';

export const chooseATokenDeployment = (id: eContractid) => {
  switch (id) {
    case eContractid.AToken:
      return deployGenericAToken;
    case eContractid.DelegationAwareAToken:
      return deployDelegationAwareAToken;
    default:
      throw Error(`Missing aToken deployment script for: ${id}`);
  }
};

export const initReservesByHelper = async (
  reservesParams: iMultiPoolsAssets<IReserveParams>,
  tokenAddresses: { [symbol: string]: tEthereumAddress },
  aTokenNamePrefix: string,
  stableDebtTokenNamePrefix: string,
  variableDebtTokenNamePrefix: string,
  symbolPrefix: string,
  admin: tEthereumAddress,
  treasuryAddress: tEthereumAddress,
  incentivesController: tEthereumAddress,
  verify: boolean
): Promise<BigNumber> => {
  let gasUsage = BigNumber.from('0');
  const stableAndVariableDeployer = await getStableAndVariableTokensHelper();

  const addressProvider = await getLendingPoolAddressesProvider();

  // CHUNK CONFIGURATION
  const initChunks = 3;

  // Initialize variables for future reserves initialization
  let reserveTokens: string[] = [];
  let reserveInitDecimals: string[] = [];
  let reserveSymbols: string[] = [];

  let initInputParams: {
    aTokenImpl: string;
    stableDebtTokenImpl: string;
    variableDebtTokenImpl: string;
    underlyingAssetDecimals: BigNumberish;
    interestRateStrategyAddress: string;
    underlyingAsset: string;
    treasury: string;
    incentivesController: string;
    underlyingAssetName: string;
    aTokenName: string;
    aTokenSymbol: string;
    variableDebtTokenName: string;
    variableDebtTokenSymbol: string;
    stableDebtTokenName: string;
    stableDebtTokenSymbol: string;
    params: string;
  }[] = [];

  let strategyRates: [
    string, // addresses provider
    string,
    string,
    string,
    string,
    string,
    string
  ];
  let rateStrategies: Record<string, typeof strategyRates> = {};
  let strategyAddresses: Record<string, tEthereumAddress> = {};
  let strategyAddressPerAsset: Record<string, string> = {};
  let aTokenType: Record<string, string> = {};
  let delegationAwareATokenImplementationAddress = '';
  let aTokenImplementationAddress = '';
  let stableDebtTokenImplementationAddress = '';
  let variableDebtTokenImplementationAddress = '';
  /*
  // NOT WORKING ON MATIC, DEPLOYING INDIVIDUAL IMPLs INSTEAD
  // const tx1 = await waitForTx(
  //   await stableAndVariableDeployer.initDeployment([ZERO_ADDRESS], ["1"])
  // );
  // console.log(tx1.events);
  // tx1.events?.forEach((event, index) => {
  //   stableDebtTokenImplementationAddress = event?.args?.stableToken;
  //   variableDebtTokenImplementationAddress = event?.args?.variableToken;
  //   rawInsertContractAddressInDb(`stableDebtTokenImpl`, stableDebtTokenImplementationAddress);
  //   rawInsertContractAddressInDb(`variableDebtTokenImpl`, variableDebtTokenImplementationAddress);
  // });
  //gasUsage = gasUsage.add(tx1.gasUsed);
  
  stableDebtTokenImplementationAddress = await (await deployGenericStableDebtToken()).address;
  variableDebtTokenImplementationAddress = await (await deployGenericVariableDebtToken()).address;

  const aTokenImplementation = await deployGenericATokenImpl(verify);
  aTokenImplementationAddress = aTokenImplementation.address;
  rawInsertContractAddressInDb(`aTokenImpl`, aTokenImplementationAddress);
  
  const delegatedAwareReserves = Object.entries(reservesParams).filter(
    ([_, { aTokenImpl }]) => aTokenImpl === eContractid.DelegationAwareAToken
  ) as [string, IReserveParams][];

  if (delegatedAwareReserves.length > 0) {
    const delegationAwareATokenImplementation = await deployDelegationAwareATokenImpl(verify);
    delegationAwareATokenImplementationAddress = delegationAwareATokenImplementation.address;
    rawInsertContractAddressInDb(
      `delegationAwareATokenImpl`,
      delegationAwareATokenImplementationAddress
    );
  }
  
  const reserves = Object.entries(reservesParams).filter(
    ([_, { aTokenImpl }]) =>
      aTokenImpl === eContractid.DelegationAwareAToken || aTokenImpl === eContractid.AToken
  ) as [string, IReserveParams][];

  for (let [symbol, params] of reserves) {
    if (!tokenAddresses[symbol]) {
      console.log(`- Skipping init of ${symbol} due token address is not set at markets config`);
      continue;
    }
    const { strategy, aTokenImpl, reserveDecimals } = params;
    const {
      optimalUtilizationRate,
      baseVariableBorrowRate,
      variableRateSlope1,
      variableRateSlope2,
      stableRateSlope1,
      stableRateSlope2,
    } = strategy;
    if (!strategyAddresses[strategy.name]) {
      // Strategy does not exist, create a new one
      rateStrategies[strategy.name] = [
        addressProvider.address,
        optimalUtilizationRate,
        baseVariableBorrowRate,
        variableRateSlope1,
        variableRateSlope2,
        stableRateSlope1,
        stableRateSlope2,
      ];
      strategyAddresses[strategy.name] = (
        await deployDefaultReserveInterestRateStrategy(rateStrategies[strategy.name], verify)
      ).address;
      // This causes the last strategy to be printed twice, once under "DefaultReserveInterestRateStrategy"
      // and once under the actual `strategyASSET` key.
      rawInsertContractAddressInDb(strategy.name, strategyAddresses[strategy.name]);
    }
    strategyAddressPerAsset[symbol] = strategyAddresses[strategy.name];
    console.log('Strategy address for asset %s: %s', symbol, strategyAddressPerAsset[symbol]);

    if (aTokenImpl === eContractid.AToken) {
      aTokenType[symbol] = 'generic';
    } else if (aTokenImpl === eContractid.DelegationAwareAToken) {
      aTokenType[symbol] = 'delegation aware';
    }

    reserveInitDecimals.push(reserveDecimals);
    reserveTokens.push(tokenAddresses[symbol]);
    reserveSymbols.push(symbol);
  }

  for (let i = 0; i < reserveSymbols.length; i++) {
    let aTokenToUse: string;
    if (aTokenType[reserveSymbols[i]] === 'generic') {
      aTokenToUse = aTokenImplementationAddress;
    } else {
      aTokenToUse = delegationAwareATokenImplementationAddress;
    }

    initInputParams.push({
      aTokenImpl: aTokenToUse,
      stableDebtTokenImpl: stableDebtTokenImplementationAddress,
      variableDebtTokenImpl: variableDebtTokenImplementationAddress,
      underlyingAssetDecimals: reserveInitDecimals[i],
      interestRateStrategyAddress: strategyAddressPerAsset[reserveSymbols[i]],
      underlyingAsset: reserveTokens[i],
      treasury: treasuryAddress,
      incentivesController,
      underlyingAssetName: reserveSymbols[i],
      aTokenName: `${aTokenNamePrefix} ${reserveSymbols[i]}`,
      aTokenSymbol: `a${symbolPrefix}${reserveSymbols[i]}`,
      variableDebtTokenName: `${variableDebtTokenNamePrefix} ${symbolPrefix}${reserveSymbols[i]}`,
      variableDebtTokenSymbol: `variableDebt${symbolPrefix}${reserveSymbols[i]}`,
      stableDebtTokenName: `${stableDebtTokenNamePrefix} ${reserveSymbols[i]}`,
      stableDebtTokenSymbol: `stableDebt${symbolPrefix}${reserveSymbols[i]}`,
      params: '0x10',
    });
  }
  
  // Deploy init reserves per chunks
  const chunkedSymbols = chunk(reserveSymbols, initChunks);
  const chunkedInitInputParams = chunk(initInputParams, initChunks);
  */
  const configurator = await getLendingPoolConfiguratorProxy();
  //await waitForTx(await addressProvider.setPoolAdmin(admin));
  /*
  const chunkedSymbols = [[ 'AAVE', 'BAT', 'BUSD' ],
  [ 'DAI', 'ENJ', 'KNC' ],
  [ 'LINK', 'MANA', 'MKR' ],
  ['REN', 'SNX', 'SUSD' ],
  [ 'TUSD', 'UNI', 'USDC' ],
  [ 'USDT', 'WBTC', 'WETH' ],
  [ 'YFI', 'ZRX', 'xSUSHI' ]]
  */
  
  const chunkedSymbols = [
  [ 'LINK', 'MANA', 'MKR' ],
  ['REN', 'SNX', 'SUSD' ],
  [ 'TUSD', 'UNI', 'USDC' ],
  [ 'USDT', 'WBTC', 'WETH' ],
  [ 'YFI', 'ZRX', 'xSUSHI' ]]

  const chunkedInitInputParams =  [    
    [    
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x3eB4cdF3719460626c212b57441f63fA55D6e391',
        underlyingAsset: '0x41bdaE53d80F1D94fA77d7eE8F7158A7D4EaE12e',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'LINK',
        aTokenName: 'Aave interest bearing LINK',
        aTokenSymbol: 'aLINK',
        variableDebtTokenName: 'Aave variable debt bearing LINK',
        variableDebtTokenSymbol: 'variableDebtLINK',
        stableDebtTokenName: 'Aave stable debt bearing LINK',
        stableDebtTokenSymbol: 'stableDebtLINK',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x3eB4cdF3719460626c212b57441f63fA55D6e391',
        underlyingAsset: '0x532a45aD46Af063aD7d4D09384b043B489f5f9d3',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'MANA',
        aTokenName: 'Aave interest bearing MANA',
        aTokenSymbol: 'aMANA',
        variableDebtTokenName: 'Aave variable debt bearing MANA',
        variableDebtTokenSymbol: 'variableDebtMANA',
        stableDebtTokenName: 'Aave stable debt bearing MANA',
        stableDebtTokenSymbol: 'stableDebtMANA',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x3eB4cdF3719460626c212b57441f63fA55D6e391',
        underlyingAsset: '0x4169a12dE5447C16e64738BA00333707f9dE90F9',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'MKR',
        aTokenName: 'Aave interest bearing MKR',
        aTokenSymbol: 'aMKR',
        variableDebtTokenName: 'Aave variable debt bearing MKR',
        variableDebtTokenSymbol: 'variableDebtMKR',
        stableDebtTokenName: 'Aave stable debt bearing MKR',
        stableDebtTokenSymbol: 'stableDebtMKR',
        params: '0x10'
      },
    ],
    [    
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x3eB4cdF3719460626c212b57441f63fA55D6e391',
        underlyingAsset: '0x93A93e29CB76F948750d61dEFe554Bb428131470',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'REN',
        aTokenName: 'Aave interest bearing REN',
        aTokenSymbol: 'aREN',
        variableDebtTokenName: 'Aave variable debt bearing REN',
        variableDebtTokenSymbol: 'variableDebtREN',
        stableDebtTokenName: 'Aave stable debt bearing REN',
        stableDebtTokenSymbol: 'stableDebtREN',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0xcB657F3277C1F09a059189B7368103096a5Af2CC',
        underlyingAsset: '0x40bAe2A493Af539C79fc3CD7499c983c303adC1d',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'SNX',
        aTokenName: 'Aave interest bearing SNX',
        aTokenSymbol: 'aSNX',
        variableDebtTokenName: 'Aave variable debt bearing SNX',
        variableDebtTokenSymbol: 'variableDebtSNX',
        stableDebtTokenName: 'Aave stable debt bearing SNX',
        stableDebtTokenSymbol: 'stableDebtSNX',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x5eC7dC87Cda1B32848F74B4094DC73d026C3C204',
        underlyingAsset: '0x40879Fc5c86e9ED5f0523eB7e47D4c80e9173A79',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'SUSD',
        aTokenName: 'Aave interest bearing SUSD',
        aTokenSymbol: 'aSUSD',
        variableDebtTokenName: 'Aave variable debt bearing SUSD',
        variableDebtTokenSymbol: 'variableDebtSUSD',
        stableDebtTokenName: 'Aave stable debt bearing SUSD',
        stableDebtTokenSymbol: 'stableDebtSUSD',
        params: '0x10'
      }
    ],
    [
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x70A30F9b8548B81c6A9153f9b01092c89AD08376',
        underlyingAsset: '0xfd429e5056f3DdA1a795Cd0a2e8a35cc174de62a',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'TUSD',
        aTokenName: 'Aave interest bearing TUSD',
        aTokenSymbol: 'aTUSD',
        variableDebtTokenName: 'Aave variable debt bearing TUSD',
        variableDebtTokenSymbol: 'variableDebtTUSD',
        stableDebtTokenName: 'Aave stable debt bearing TUSD',
        stableDebtTokenSymbol: 'stableDebtTUSD',
        params: '0x10'
      },
      {
        aTokenImpl: '0xd614f19DdaaD57c450123844F49cc4f8d9334760',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0xcB657F3277C1F09a059189B7368103096a5Af2CC',
        underlyingAsset: '0xDB11789cF6D6c0b0dB3e91a9DeC66444fFF10006',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'UNI',
        aTokenName: 'Aave interest bearing UNI',
        aTokenSymbol: 'aUNI',
        variableDebtTokenName: 'Aave variable debt bearing UNI',
        variableDebtTokenSymbol: 'variableDebtUNI',
        stableDebtTokenName: 'Aave stable debt bearing UNI',
        stableDebtTokenSymbol: 'stableDebtUNI',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '6',
        interestRateStrategyAddress: '0x672e81C8bB00cd2D108f52cec3bA8e1A8046e60f',
        underlyingAsset: '0x2B3624B8C9b724dA7f833Af14f9ED019F0460069',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'USDC',
        aTokenName: 'Aave interest bearing USDC',
        aTokenSymbol: 'aUSDC',
        variableDebtTokenName: 'Aave variable debt bearing USDC',
        variableDebtTokenSymbol: 'variableDebtUSDC',
        stableDebtTokenName: 'Aave stable debt bearing USDC',
        stableDebtTokenSymbol: 'stableDebtUSDC',
        params: '0x10'
      }    
    ],
    [
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '6',
        interestRateStrategyAddress: '0x672e81C8bB00cd2D108f52cec3bA8e1A8046e60f',
        underlyingAsset: '0x0cF7BEC3EF406DC9E2F2f09E7146857289ed8AD1',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'USDT',
        aTokenName: 'Aave interest bearing USDT',
        aTokenSymbol: 'aUSDT',
        variableDebtTokenName: 'Aave variable debt bearing USDT',
        variableDebtTokenSymbol: 'variableDebtUSDT',
        stableDebtTokenName: 'Aave stable debt bearing USDT',
        stableDebtTokenSymbol: 'stableDebtUSDT',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '8',
        interestRateStrategyAddress: '0x0bcEAa3530A00aaFf0F6A91c8f2F8aa345694BB2',
        underlyingAsset: '0xb327dd832FE5dcc4a2af977a248E88902288dfca',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'WBTC',
        aTokenName: 'Aave interest bearing WBTC',
        aTokenSymbol: 'aWBTC',
        variableDebtTokenName: 'Aave variable debt bearing WBTC',
        variableDebtTokenSymbol: 'variableDebtWBTC',
        stableDebtTokenName: 'Aave stable debt bearing WBTC',
        stableDebtTokenSymbol: 'stableDebtWBTC',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0xc29D7Ac5231b1649E9Ecbf26f4894225ED46C1DA',
        underlyingAsset: '0x662b358eD1525df242F321F626fA90C6fb2D4284',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'WETH',
        aTokenName: 'Aave interest bearing WETH',
        aTokenSymbol: 'aWETH',
        variableDebtTokenName: 'Aave variable debt bearing WETH',
        variableDebtTokenSymbol: 'variableDebtWETH',
        stableDebtTokenName: 'Aave stable debt bearing WETH',
        stableDebtTokenSymbol: 'stableDebtWETH',
        params: '0x10'
      }    
    ],
    [
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x3eB4cdF3719460626c212b57441f63fA55D6e391',
        underlyingAsset: '0x66141078E00b4793F90a27Ef083E38d6FcA5230a',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'YFI',
        aTokenName: 'Aave interest bearing YFI',
        aTokenSymbol: 'aYFI',
        variableDebtTokenName: 'Aave variable debt bearing YFI',
        variableDebtTokenSymbol: 'variableDebtYFI',
        stableDebtTokenName: 'Aave stable debt bearing YFI',
        stableDebtTokenSymbol: 'stableDebtYFI',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x3eB4cdF3719460626c212b57441f63fA55D6e391',
        underlyingAsset: '0xA7fA274bC43045D31Fc7390a18e0E814d8923be7',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'ZRX',
        aTokenName: 'Aave interest bearing ZRX',
        aTokenSymbol: 'aZRX',
        variableDebtTokenName: 'Aave variable debt bearing ZRX',
        variableDebtTokenSymbol: 'variableDebtZRX',
        stableDebtTokenName: 'Aave stable debt bearing ZRX',
        stableDebtTokenSymbol: 'stableDebtZRX',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x7eb1BF1De68674532CbD30865587e9Eb2cE8C040',
        underlyingAsset: '0xF7AD46bDE006566Eb9Bc502A912FbF279A72621c',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'xSUSHI',
        aTokenName: 'Aave interest bearing xSUSHI',
        aTokenSymbol: 'axSUSHI',
        variableDebtTokenName: 'Aave variable debt bearing xSUSHI',
        variableDebtTokenSymbol: 'variableDebtxSUSHI',
        stableDebtTokenName: 'Aave stable debt bearing xSUSHI',
        stableDebtTokenSymbol: 'stableDebtxSUSHI',
        params: '0x10'
      }
    ]
  ]
  console.log(`- Reserves initialization in ${chunkedInitInputParams.length} txs`);
  for (let chunkIndex = 0; chunkIndex < chunkedInitInputParams.length; chunkIndex++) {
    console.log(chunkedInitInputParams[chunkIndex])
    const tx3 = await waitForTx(
      await configurator.batchInitReserve(chunkedInitInputParams[chunkIndex])
    );

    console.log(`  - Reserve ready for: ${chunkedSymbols[chunkIndex].join(', ')}`);
    console.log('    * gasUsed', tx3.gasUsed.toString());
    //gasUsage = gasUsage.add(tx3.gasUsed);
  }

  return gasUsage; // Deprecated
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

export const configureReservesByHelper = async (
  reservesParams: iMultiPoolsAssets<IReserveParams>,
  tokenAddresses: { [symbol: string]: tEthereumAddress },
  helpers: AaveProtocolDataProvider,
  admin: tEthereumAddress
) => {
  const addressProvider = await getLendingPoolAddressesProvider();
  const atokenAndRatesDeployer = await getATokensAndRatesHelper();
  const tokens: string[] = [];
  const symbols: string[] = [];

  const inputParams: {
    asset: string;
    baseLTV: BigNumberish;
    liquidationThreshold: BigNumberish;
    liquidationBonus: BigNumberish;
    reserveFactor: BigNumberish;
    stableBorrowingEnabled: boolean;
    borrowingEnabled: boolean;
  }[] = [];

  for (const [
    assetSymbol,
    {
      baseLTVAsCollateral,
      liquidationBonus,
      liquidationThreshold,
      reserveFactor,
      stableBorrowRateEnabled,
      borrowingEnabled,
    },
  ] of Object.entries(reservesParams) as [string, IReserveParams][]) {
    if (!tokenAddresses[assetSymbol]) {
      console.log(
        `- Skipping init of ${assetSymbol} due token address is not set at markets config`
      );
      continue;
    }
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

    inputParams.push({
      asset: tokenAddress,
      baseLTV: baseLTVAsCollateral,
      liquidationThreshold: liquidationThreshold,
      liquidationBonus: liquidationBonus,
      reserveFactor: reserveFactor,
      stableBorrowingEnabled: stableBorrowRateEnabled,
      borrowingEnabled: borrowingEnabled,
    });

    tokens.push(tokenAddress);
    symbols.push(assetSymbol);
  }
  if (tokens.length) {
    // Set aTokenAndRatesDeployer as temporal admin
    await waitForTx(await addressProvider.setPoolAdmin(atokenAndRatesDeployer.address));

    // Deploy init per chunks
    const enableChunks = 20;
    const chunkedSymbols = chunk(symbols, enableChunks);
    const chunkedInputParams = chunk(inputParams, enableChunks);

    console.log(`- Configure reserves in ${chunkedInputParams.length} txs`);
    for (let chunkIndex = 0; chunkIndex < chunkedInputParams.length; chunkIndex++) {
      await waitForTx(
        await atokenAndRatesDeployer.configureReserves(chunkedInputParams[chunkIndex], {
          gasLimit: 12000000,
        })
      );
      console.log(`  - Init for: ${chunkedSymbols[chunkIndex].join(', ')}`);
    }
    // Set deployer back as admin
    await waitForTx(await addressProvider.setPoolAdmin(admin));
  }
};

const getAddressById = async (
  id: string,
  network: eNetwork
): Promise<tEthereumAddress | undefined> =>
  (await getDb().get(`${id}.${network}`).value())?.address || undefined;

// Function deprecated
const isErc20SymbolCorrect = async (token: tEthereumAddress, symbol: string) => {
  const erc20 = await getAToken(token); // using aToken for ERC20 interface
  const erc20Symbol = await erc20.symbol();
  return symbol === erc20Symbol;
};
