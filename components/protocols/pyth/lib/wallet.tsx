import {Cluster, clusterApiUrl, Connection} from '@solana/web3.js';
import {Keypair} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import _ from 'lodash';
import {useEffect, useState} from 'react';
import useSWR from 'swr';
import {SOLANA_NETWORKS} from 'types';
import {JupiterSwapClient, OrcaSwapClient} from './swap';

interface WalletBalance {
  sol_balance: number;
  usdc_balance: number;
  orca_balance: number;
}

interface Order {
  side: 'buy' | 'sell';
  size: number;
  price: number;
  fromToken: string;
  toToken: string;
}

const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ORCA_MINT_ADDRESS = 'orcarKHSqC5CDDsGbho8GKvwExejWHxTqGzXgcewB9L';

export const SOL_DECIMAL = 10 ** 9;
export const USDC_DECIMAL = 10 ** 6;

export const useExtendedWallet = (
  useMock = false,
  cluster: Cluster,
  price: number = 0,
) => {
  const [secretKey, setSecretKey] = useState<string | undefined>(undefined);

  const [keyPair, setKeyPair] = useState<Keypair>(Keypair.generate());
  useEffect(() => {
    if (secretKey) {
      let arr = Uint8Array.from(bs58.decode(secretKey));
      const key = Keypair.fromSecretKey(arr);
      setKeyPair(key);
    } else {
      const temp = Keypair.generate(); // we use random keypair for mock to be able to get real market data.
      setKeyPair(temp);
    }
  }, [secretKey]);

  const [balance, setBalance] = useState<WalletBalance>({
    sol_balance: 10 * SOL_DECIMAL,
    usdc_balance: 1400 * USDC_DECIMAL,
    orca_balance: 0,
  });

  const [orderBook, setOrderbook] = useState<Order[]>([]);

  const {data, mutate} = useSWR(
    () => `/balance/${keyPair?.publicKey}`,
    balanceFetcher(keyPair!, cluster),
    {
      refreshInterval: 5000,
    },
  );

  useEffect(() => {
    mutate(); // refresh balance
  }, [cluster]);

  useEffect(() => {
    if (data && !useMock) {
      const sol_balance = _.get(data, 'data[0].result.value') / 10 ** 9;
      const usdc_balance = _.get(
        data,
        'data[1].result.value[0]account.data.parsed.info.tokenAmount.amount',
      );
      const orca_balance = _.get(
        data,
        'data[2].result.value[0]account.data.parsed.info.tokenAmount.amount',
      );
      setBalance({sol_balance, usdc_balance, orca_balance});
    }
  }, [data]);

  const [jupiterSwapClient, setJupiterSwapClient] =
    useState<JupiterSwapClient | null>(null);

  const [orcaSwapClient, setOrcaSwapClient] = useState<OrcaSwapClient | null>(
    null,
  );

  useEffect(() => {
    (async function _init(): Promise<void> {
      console.log('Keypair changed to: ', keyPair?.publicKey.toBase58());
      console.log('setting up clients');
      setJupiterSwapClient(null);
      setOrcaSwapClient(null);
      await getOrcaSwapClient();
      await getJupiterSwapClient();
      console.log('clients initialized');
    })();
  }, [keyPair]);

  const getOrcaSwapClient = async () => {
    if (orcaSwapClient) return orcaSwapClient;
    const _orcaSwapClient = new OrcaSwapClient(
      keyPair,
      new Connection(clusterApiUrl('devnet'), 'confirmed'),
    );
    setOrcaSwapClient((c) => _orcaSwapClient);
  };

  const getJupiterSwapClient = async () => {
    if (jupiterSwapClient) return jupiterSwapClient;
    const _jupiterSwapClient = await JupiterSwapClient.initialize(
      new Connection('https://solana-api.projectserum.com/', 'confirmed'),
      SOLANA_NETWORKS.MAINNET,
      keyPair,
      SOL_MINT_ADDRESS,
      USDC_MINT_ADDRESS,
    );
    setJupiterSwapClient((c) => _jupiterSwapClient);
    return _jupiterSwapClient;
  };

  const addOrder = async (order: Order) => {
    const extendedOrder: any = {
      ...order,
    };
    console.log('addOrder', extendedOrder, useMock, price);
    if (useMock) {
      const _jupiterSwapClient = await getJupiterSwapClient();
      console.log(jupiterSwapClient?.tokenA);

      // TokenA === SOL
      // TokenB === USDC
      const routes = await _jupiterSwapClient?.getRoutes({
        inputToken:
          order.side === 'buy'
            ? _jupiterSwapClient.tokenB
            : _jupiterSwapClient.tokenA,
        outputToken:
          order.side === 'buy'
            ? _jupiterSwapClient.tokenA
            : _jupiterSwapClient.tokenB,
        inputAmount: order.size,
        slippage: 1,
      });
      const bestRoute = routes?.routesInfos[0];
      console.log(bestRoute);
      extendedOrder['inAmount'] = bestRoute?.inAmount;
      extendedOrder['outAmount'] = bestRoute?.outAmount;
      extendedOrder['mock'] = true;

      // fake the transaction change.
      setBalance((previousBalance) => ({
        ...previousBalance,
        usdc_balance:
          order.side === 'buy'
            ? previousBalance.usdc_balance - extendedOrder.inAmount
            : previousBalance.usdc_balance + extendedOrder.outAmount,
        sol_balance:
          order.side === 'buy'
            ? previousBalance.sol_balance + extendedOrder.outAmount
            : previousBalance.sol_balance - extendedOrder.inAmount,
      }));
    } else {
      // let result;
      // if (order.side === 'buy') {
      //   result = await jupiterSwapClient?.buy(order.size);
      // } else if (order.side === 'sell') {
      //   result = await jupiterSwapClient?.sell(order.size);
      // }
      // extendedOrder['mock'] = false;
    }

    // extendedOrder.txId = result?.txId;

    setOrderbook((_orderBook) => [extendedOrder, ..._orderBook]);
  };

  const resetWallet = (params = {sol_balance: 10, usdc_balance: 1400}) => {
    if (!useMock) {
      setSecretKey(undefined);
    } else {
      setBalance({
        sol_balance: params.sol_balance * SOL_DECIMAL,
        usdc_balance: params.usdc_balance * USDC_DECIMAL,
        orca_balance: 0,
      });
    }
  };

  return {
    balance,
    resetWallet,
    keyPair,
    setSecretKey,
    addOrder,
    orderBook,
  };
};

const balanceFetcher = (keyPair: Keypair, cluster: Cluster) => () =>
  axios({
    url: clusterApiUrl(cluster),
    method: 'post',
    headers: {'Content-Type': 'application/json'},
    data: [
      {
        jsonrpc: '2.0',
        id: 0,
        method: 'getBalance',
        params: [keyPair?.publicKey.toBase58()],
      },
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          keyPair?.publicKey.toBase58(),
          {
            mint:
              cluster === 'mainnet-beta'
                ? USDC_MINT_ADDRESS
                : 'EmXq3Ni9gfudTiyNKzzYvpnQqnJEMRw2ttnVXoJXjLo1', // orca devnet pool USDC equivelent token mint address.
          },
          {
            encoding: 'jsonParsed',
          },
        ],
      },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'getTokenAccountsByOwner',
        params: [
          keyPair?.publicKey.toBase58(),
          {
            mint: ORCA_MINT_ADDRESS,
          },
          {
            encoding: 'jsonParsed',
          },
        ],
      },
    ],
  });
