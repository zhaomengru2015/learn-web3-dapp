import {SwapResult} from '@jup-ag/core';
import {Cluster, clusterApiUrl} from '@solana/web3.js';
import {Keypair, TransactionError} from '@solana/web3.js';
import axios from 'axios';
import bs58 from 'bs58';
import _ from 'lodash';
import {useEffect, useState} from 'react';
import useSWR from 'swr';
import {SwapClient} from './swap';

interface WalletBalance {
  sol_balance: number;
  usdc_balance: number;
}

interface Order {
  side: 'buy' | 'sell';
  size: number;
  price: number;
  fromToken: string;
  toToken: string;
}

const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const useExtendedWallet = (useMock = false, cluster: Cluster) => {
  const [secretKey, setSecretKey] = useState<string | undefined>(undefined);
  const [keyPair, setKeyPair] = useState<Keypair | undefined>(undefined);
  useEffect(() => {
    if (secretKey) {
      let arr = Uint8Array.from(bs58.decode(secretKey));
      const key = Keypair.fromSecretKey(arr);
      setKeyPair(key);
    }
  }, [secretKey]);

  const [balance, setBalance] = useState<WalletBalance>({
    sol_balance: 100,
    usdc_balance: 10000,
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
        'data[1].result.value[0]account.data.parsed.info.tokenAmount.uiAmount',
      );
      setBalance({sol_balance, usdc_balance});
    }
  }, [data]);

  const [swapClient, setSwapClient] = useState<SwapClient | null>(null);

  const addOrder = async (order: Order) => {
    const extendedOrder: any = {
      ...order,
    };
    if (useMock) {
      const routes = await swapClient?.getRoutes({
        inputToken:
          order.side === 'buy' ? swapClient.tokenA : swapClient.tokenB,
        outputToken:
          order.side === 'buy' ? swapClient.tokenA : swapClient.tokenB,
        inputAmount: order.size,
        slippage: 1,
      });
      const bestRoute = routes?.routesInfos[0];
      console.log(bestRoute);
      extendedOrder['inAmount'] = bestRoute?.inAmount;
      extendedOrder['outAmount'] = bestRoute?.outAmount;
      extendedOrder['mock'] = true;
    } else {
      let result;
      if (order.side === 'buy') {
        result = await swapClient?.buy(order.size);
      } else if (order.side === 'sell') {
        result = await swapClient?.sell(order.size);
      }
      extendedOrder['mock'] = false;
    }
    // extendedOrder.txId = result?.txId;

    setOrderbook((_orderBook) => [extendedOrder, ..._orderBook]);
  };

  const resetWallet = (params = {sol_balance: 10, usdc_balance: 1400}) => {
    if (!useMock) {
      setSecretKey(undefined);
    } else {
      setBalance({
        sol_balance: params.sol_balance,
        usdc_balance: params.usdc_balance,
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
    swapClient,
    setSwapClient,
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
        id: 1,
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
            mint: USDC_MINT_ADDRESS,
          },
          {
            encoding: 'jsonParsed',
          },
        ],
      },
    ],
  });
