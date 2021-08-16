import { ethers, Contract } from 'ethers';
import LendingPoolAddressesProvider from './contracts/protocol/configuration/LendingPoolAddressesProvider.sol/LendingPoolAddressesProvider.json';
import LendingPoolConfigurator from './contracts/protocol/lendingpool/LendingPoolConfigurator.sol/LendingPoolConfigurator.json'
const getBlockchain = () =>
  new Promise((resolve, reject) => {
    window.addEventListener('load', async () => {
      if(window.ethereum) {
        await window.ethereum.enable();
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();        
        const signerAddress = await signer.getAddress();
        
        const address = "0xCDEb7313ef168ea5705B75ED0a55fbCa3B0a8819";
        const lendingPoolConfigurator = new Contract(
          address,
          LendingPoolConfigurator.abi,
          signer
        );

        resolve({signerAddress, lendingPoolConfigurator});
      }
      resolve({signerAddress: undefined, lendingPoolConfigurator: undefined});
    });
  });

export default getBlockchain;