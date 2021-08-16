import React, { useState, useEffect } from 'react';
import getBlockchain from './ethereum.js';

function App() {
  const [lendingPoolConfigurator, setLendingPoolConfigurator] = useState(undefined);
  const [accounts, setAccounts] = useState(undefined);
  const [batchInitReserve, setBatchInitReserve] = useState(undefined);
  useEffect(() => {
    const init = async () => {
      const { lendingPoolConfigurator, signerAddress } = await getBlockchain();
      setLendingPoolConfigurator(lendingPoolConfigurator);
      setAccounts(signerAddress);
    };
    init();
  }, []);

  if(
    typeof lendingPoolConfigurator === 'undefined'
  ) {
    return 'Loading...';
  }
 
  const setValue = async () => {
    await lendingPoolConfigurator.batchInitReserve([
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0xe059BE892Ce9E179C3Eb17e37Aa0fAbA5eD6d267',
        underlyingAsset: '0xE31a6f4E46bf569592BD8Bbf2b3361e20993fa28',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'AAVE',
        aTokenName: 'Aave interest bearing AAVE',
        aTokenSymbol: 'aAAVE',
        variableDebtTokenName: 'Aave variable debt bearing AAVE',
        variableDebtTokenSymbol: 'variableDebtAAVE',
        stableDebtTokenName: 'Aave stable debt bearing AAVE',
        stableDebtTokenSymbol: 'stableDebtAAVE',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x3eB4cdF3719460626c212b57441f63fA55D6e391',
        underlyingAsset: '0x6ec5Ea6042107431f8ed90c7cEA8Aaa04Dc28110',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'BAT',
        aTokenName: 'Aave interest bearing BAT',
        aTokenSymbol: 'aBAT',
        variableDebtTokenName: 'Aave variable debt bearing BAT',
        variableDebtTokenSymbol: 'variableDebtBAT',
        stableDebtTokenName: 'Aave stable debt bearing BAT',
        stableDebtTokenSymbol: 'stableDebtBAT',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x5eC7dC87Cda1B32848F74B4094DC73d026C3C204',
        underlyingAsset: '0x1dA2FC879a2426c1AeA20c444E55Bc368f686B1a',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'BUSD',
        aTokenName: 'Aave interest bearing BUSD',
        aTokenSymbol: 'aBUSD',
        variableDebtTokenName: 'Aave variable debt bearing BUSD',
        variableDebtTokenSymbol: 'variableDebtBUSD',
        stableDebtTokenName: 'Aave stable debt bearing BUSD',
        stableDebtTokenSymbol: 'stableDebtBUSD',
        params: '0x10'
      },
      {
        aTokenImpl: '0x36E844f47fA43E9369F6B0C8CB4Af231c4fE09e1',
        stableDebtTokenImpl: '0xE0d6e5401F188a0411b7F864249Bb0ef73c49049',
        variableDebtTokenImpl: '0xA86733a15810301F4209eEa33F86D84C0DFecb4E',
        underlyingAssetDecimals: '18',
        interestRateStrategyAddress: '0x70A30F9b8548B81c6A9153f9b01092c89AD08376',
        underlyingAsset: '0x3e850d998C708554a55838174cA615B189327d21',
        treasury: '0x464c71f6c2f760dda6093dcb91c24c39e5d6e18c',
        incentivesController: '0x0000000000000000000000000000000000000000',
        underlyingAssetName: 'DAI',
        aTokenName: 'Aave interest bearing DAI',
        aTokenSymbol: 'aDAI',
        variableDebtTokenName: 'Aave variable debt bearing DAI',
        variableDebtTokenSymbol: 'variableDebtDAI',
        stableDebtTokenName: 'Aave stable debt bearing DAI',
        stableDebtTokenSymbol: 'stableDebtDAI',
        params: '0x10'
      }
    ]).send({from: accounts});
    console.log("done");
  }

  return (
    <div className="App">
      {lendingPoolConfigurator.address.toString()}
      <div>
        <button type="button" onClick={setValue}>set</button>
      </div>
    </div>
  );
}

export default App;
